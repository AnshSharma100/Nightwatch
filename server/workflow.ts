import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { caseFromAlert, caseKey, isWorkflowUpdate, transition } from '../packages/domain/workflow.ts'
import type { WorkflowEntry, WorkflowUpdate } from '../packages/domain/workflow.ts'
import { personFor, withinScope } from '../packages/domain/personnel.ts'
import type { Person } from '../packages/domain/personnel.ts'
import { requestBody, send } from './http.ts'
import { activeAlerts } from '../packages/domain/incidents.ts'
import { prepareApproval } from './approval.ts'
import type { RecordingRegistry } from './datasets.ts'
import type { SessionAuth } from './auth.ts'
import type { PushService } from './push.ts'
import type { State, WorkspaceStore } from './store.ts'
import { roster } from './shifts.ts'

export function canRead(person: Person, entry: WorkflowEntry) {
  if (person.role === 'control') return true
  if (!entry.assignment || !withinScope(person, entry.incident)) return false
  return entry.assignment.recipient.id === person.id
}

function visible(entry: WorkflowEntry, state: State) {
  if (!entry.assignment) return entry
  const row = state.deliveries.findLast((item) => item.assignmentId === entry.assignment!.id && item.recipientId === entry.assignment!.recipient.id)
  if (!row) return entry
  return { ...entry, assignment: { ...entry.assignment, delivery: { status: row.status, at: row.at, accepted: row.accepted, failed: row.failed } } }
}

export function applyChange(state: State, person: Person, update: WorkflowUpdate, now: number) {
  const index = state.entries.findIndex((entry) => caseKey(entry.incident) === caseKey(update.incident))
  const current = state.entries[index]
  if (person.role !== update.actor || !withinScope(person, update.incident) ||
      (person.role !== 'control' && current?.assignment?.recipient.id !== person.id)) {
    return { status: 403, error: 'This action is outside your assignment permissions.' }
  }
  const allocating = update.action === 'assign' || update.action === 'handoff'
  const fallbackRole = update.action === 'handoff' ? 'lease' : update.recipientRole
  const recipientId = allocating ? update.recipientId ?? (fallbackRole ? personFor(update.incident, fallbackRole).id : undefined) : undefined
  const recorded = current?.history[update.revision]
  if (current && recorded?.person?.id === person.id && recorded.action === update.action &&
      recorded.note === update.note.trim() && recorded.recipient?.id === recipientId &&
      JSON.stringify(recorded.approvalPlan) === JSON.stringify(update.approvalPlan)) {
    return { status: 200, entry: visible(current, state) }
  }
  if (current && update.action === 'acknowledge' && current.assignment?.recipient.id === person.id &&
      ['acknowledged', 'in_progress', 'resolved'].includes(current.stage)) return { status: 200, entry: visible(current, state) }

  if (update.action === 'confirm' && !update.note.trim()) return { status: 400, error: 'Enter a reason for confirming the incident.' }
  if (update.action === 'assign' && current?.stage !== 'confirmed') return { status: 409, error: 'Confirm the incident before sending it to Field.' }
  if (update.action === 'assign' && !update.note.trim()) return { status: 400, error: 'Enter field instructions before sending.' }
  const recipient = allocating ? roster(state, update.incident, now)
    .find((engineer) => engineer.person.id === recipientId && engineer.shift.status === 'available')?.person : undefined
  if (allocating && (!recipient || (update.action === 'handoff' && recipient.role !== 'lease'))) {
    return { status: 409, error: 'Choose an available engineer who covers this incident.' }
  }

  let entry: WorkflowEntry
  try { entry = transition(current, { ...update, recipientRole: recipient?.role === 'control' ? undefined : recipient?.role }, now) }
  catch (error) { return { status: 409, error: (error as Error).message } }

  const event = entry.history.at(-1)!
  event.person = person
  event.recipient = recipient
  if (update.action === 'assign') event.approvalPlan = update.approvalPlan
  let deliveryId: string | undefined
  if (recipient) {
    if (update.action === 'assign') entry.incident = update.incident
    entry.assignment = {
      id: current?.assignment?.id ?? randomUUID(), recipient, assignedAt: now,
      briefing: update.note.trim() || current?.assignment?.briefing || '',
      approvalPlan: update.action === 'assign' ? update.approvalPlan : current?.assignment?.approvalPlan,
      response: update.response?.trim() || current?.assignment?.response ||
        (update.incident.category === 'pump_failure' ? 'Inspect the failed pump and coordinate the simulated response with control.' : 'Perform a field inspection and report findings.'),
    }
    deliveryId = randomUUID()
    state.deliveries.push({
      id: deliveryId, assignmentId: entry.assignment.id, recipientId: recipient.id, status: 'queued', at: now,
      accepted: 0, failed: 0, requiresAvailable: true,
    })
  }
  if (index < 0) state.entries.push(entry)
  else state.entries[index] = entry
  return { status: 200, entry: visible(entry, state), deliveryId }
}

export function workflowHandler(store: WorkspaceStore, auth: SessionAuth, push: PushService, recordings: RecordingRegistry, publicOrigin?: string) {
  return async (request: IncomingMessage, response: ServerResponse, pathname: string) => {
    const session = await auth.session(request)
    if (!session) { send(response, 401, { error: 'Sign in to view or change assignments.' }); return }
    const { person } = session
    if (pathname === '/api/workflow/invite' && request.method === 'POST') {
      if (person.role !== 'control') { send(response, 403, { error: 'Only the control room can enroll field personnel.' }); return }
      const input = await requestBody(request, 8192, publicOrigin) as { key?: string; role?: unknown } | null
      const entry = (await store.read()).entries.find((item) => caseKey(item.incident) === input?.key)
      if (!entry || (input?.role !== 'foreman' && input?.role !== 'lease')) { send(response, 400, { error: 'Select a reviewed incident and a field role.' }); return }
      send(response, 200, { ...await auth.invite(entry.incident, input.role), publicOrigin: publicOrigin ?? null })
      return
    }
    const detail = /^\/api\/workflow\/assignments\/([0-9a-f-]{36})$/.exec(pathname)
    if (request.method === 'GET' && (pathname === '/api/workflow' || detail)) {
      const state = await store.read()
      const entries = state.entries.filter((item) => canRead(person, item))
      if (detail) {
        const entry = entries.find((item) => item.assignment?.id === detail[1])
        send(response, entry ? 200 : 404, entry ? visible(entry, state) : { error: 'Assignment not found for this account.' })
      } else send(response, 200, entries.map((entry) => visible(entry, state)))
      return
    }
    if (pathname !== '/api/workflow' || request.method !== 'POST') { send(response, 405, { error: 'Unsupported workflow request.' }); return }
    const input = await requestBody(request, 32_000, publicOrigin)
    if (!isWorkflowUpdate(input)) { send(response, 400, { error: 'Invalid workflow update.' }); return }
    if (person.role === 'control') {
      const recording = recordings.find(input.recordingId, session.digest)
      if (!recording) { send(response, 404, { error: 'Reload the recorded dataset before changing this incident.' }); return }
      const { data, incidents } = recording
      const at = input.incident.observedAt
      if (!data.times.includes(at)) {
        send(response, 422, { error: 'Choose a timestamp in this recording before reviewing field work.' }); return
      }
      const alerts = activeAlerts(data, incidents, at)
      const alert = alerts.find((item) => caseKey(caseFromAlert(data, item, at)) === caseKey(input.incident))
      if (!alert) {
        send(response, 422, { error: 'This incident is not active at the selected recorded timestamp.' }); return
      }
      input.incident = caseFromAlert(data, alert, at)
      if (input.action === 'assign') {
        try { Object.assign(input, prepareApproval(data, alerts, alert, input.approvalPlan, at)) }
        catch (error) { send(response, 422, { error: (error as Error).message }); return }
      }
    } else {
      delete input.response
      delete input.approvalPlan
    }
    const result = await store.update((state) => {
      const now = Date.now()
      if (!state.sessions.some((item) => item.digest === session.digest && item.expires > now)) {
        return { status: 401, error: 'This session has ended.' }
      }
      return applyChange(state, person, input, now)
    })
    send(response, result.status, result.entry ?? { error: result.error })
    if (result.deliveryId) push.schedule(result.deliveryId)
  }
}
