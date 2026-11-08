import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { caseFromAlert, caseKey, isWorkflowUpdate, transition } from '../src/engine/workflow.ts'
import type { WorkflowEntry, WorkflowUpdate } from '../src/engine/workflow.ts'
import { personFor, withinScope } from '../src/engine/personnel.ts'
import type { Person } from '../src/engine/personnel.ts'
import { requestBody, send } from './http.ts'
import { activeAlerts } from '../src/engine/incidents.ts'
import { fieldResponse } from '../src/engine/field-response.ts'
import { scenarioAt } from '../src/engine/simulate.ts'
import { optimize } from '../src/engine/optimize.ts'
import type { RecordingRegistry } from './datasets.ts'
import type { SessionAuth } from './auth.ts'
import type { PushService } from './push.ts'
import type { State, WorkspaceStore } from './store.ts'

export function canRead(person: Person, entry: WorkflowEntry) {
  if (person.role === 'control') return true
  if (!entry.assignment || !withinScope(person, entry.incident)) return false
  return person.role === 'foreman' || entry.assignment.recipient.id === person.id
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
  const recipientRole = update.action === 'assign' ? update.recipientRole ?? 'foreman' : 'lease'
  const isAllocation = update.action === 'assign' || update.action === 'handoff'
  const recipient = isAllocation ? personFor(update.incident, recipientRole) : undefined
  const recorded = current?.history[update.revision]
  if (current && recorded?.person?.id === person.id && recorded.action === update.action &&
      recorded.note === update.note.trim() && recorded.recipient?.id === recipient?.id) {
    return { status: 200, entry: visible(current, state) }
  }
  if (current && update.action === 'acknowledge' && current.assignment?.recipient.id === person.id &&
      ['acknowledged', 'in_progress', 'resolved'].includes(current.stage)) return { status: 200, entry: visible(current, state) }

  if (update.action === 'confirm' && !update.note.trim()) return { status: 400, error: 'Enter a reason for confirming the incident.' }
  let entry: WorkflowEntry
  try { entry = transition(current, update, now) }
  catch (error) { return { status: 409, error: (error as Error).message } }

  const event = entry.history.at(-1)!
  event.person = person
  event.recipient = recipient
  let deliveryId: string | undefined
  if (recipient) {
    if (update.action === 'assign') entry.incident = update.incident
    entry.assignment = {
      id: current?.assignment?.id ?? randomUUID(), recipient, assignedAt: now,
      briefing: update.note.trim() || current?.assignment?.briefing || '',
      response: update.response?.trim() || current?.assignment?.response ||
        (update.incident.category === 'pump_failure' ? 'Inspect the failed pump and coordinate the simulated response with control.' : 'Perform a field inspection and report findings.'),
    }
    deliveryId = randomUUID()
    state.deliveries.push({
      id: deliveryId, assignmentId: entry.assignment.id, recipientId: recipient.id, status: 'queued', at: now, accepted: 0, failed: 0,
    })
  }
  if (index < 0) state.entries.push(entry)
  else state.entries[index] = entry
  return { status: 200, entry: visible(entry, state), deliveryId }
}

export function workflowHandler(store: WorkspaceStore, auth: SessionAuth, push: PushService, recordings: RecordingRegistry, publicOrigin?: string) {
  return async (request: IncomingMessage, response: ServerResponse, pathname: string) => {
    const session = auth.session(request)
    if (!session) { send(response, 401, { error: 'Sign in to view or change assignments.' }); return }
    const { person } = session
    if (pathname === '/api/workflow/invite' && request.method === 'POST') {
      if (person.role !== 'control') { send(response, 403, { error: 'Only the control room can enroll field personnel.' }); return }
      const input = await requestBody(request, 8192, publicOrigin) as { key?: string; role?: unknown } | null
      const entry = store.read().entries.find((item) => caseKey(item.incident) === input?.key)
      if (!entry || (input?.role !== 'foreman' && input?.role !== 'lease')) { send(response, 400, { error: 'Select a reviewed incident and a field role.' }); return }
      send(response, 200, auth.invite(entry.incident, input.role))
      return
    }
    const detail = /^\/api\/workflow\/assignments\/([0-9a-f-]{36})$/.exec(pathname)
    if (request.method === 'GET' && (pathname === '/api/workflow' || detail)) {
      const state = store.read()
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
      const alerts = activeAlerts(data, incidents, data.now)
      const alert = alerts.find((item) => caseKey(caseFromAlert(data, item, data.now)) === caseKey(input.incident))
      if (!alert || input.incident.observedAt !== data.now) {
        send(response, 422, { error: 'Only active incidents at the latest recorded timestamp can be changed.' }); return
      }
      input.incident = caseFromAlert(data, alert, data.now)
      if (input.action === 'assign') {
        const scenario = scenarioAt(data, alerts.filter((item) => item.levelPct !== undefined), alert.systemId, data.now)
        const outcome = alert.category === 'pump_failure' ? optimize(scenario).best : undefined
        input.response = fieldResponse(alert, data.facilities.get(alert.facilityId)!, outcome)
      }
    } else {
      delete input.response
    }
    const result = store.update((state) => applyChange(state, person, input, Date.now()))
    send(response, result.status, result.entry ?? { error: result.error })
    if (result.deliveryId) push.schedule(result.deliveryId)
  }
}
