import type { IncomingMessage, ServerResponse } from 'node:http'
import { isShiftStatus } from '../packages/contracts/shifts.ts'
import type { EngineerOnShift, Shift, ShiftStatus } from '../packages/contracts/shifts.ts'
import { withinScope } from '../packages/domain/personnel.ts'
import { caseKey } from '../packages/domain/workflow.ts'
import type { WorkflowCase } from '../packages/domain/workflow.ts'
import type { SessionAuth } from './auth.ts'
import { requestBody, send } from './http.ts'
import type { Session, State, WorkspaceStore } from './store.ts'

export interface ShiftRecord extends Shift { session: string }
const shiftLength = 8 * 60 * 60 * 1000

export function deviceShift(state: State, session: string, now: number): Shift {
  const row = state.shifts.find((item) => item.session === session)
  if (!row) return { status: 'off', clockedInAt: null, changedAt: null, expiresAt: null }
  const { status, clockedInAt, changedAt, expiresAt } = row
  if (status !== 'off' && expiresAt !== null && expiresAt <= now) {
    return { status: 'off', clockedInAt, changedAt: expiresAt, expiresAt: null }
  }
  return { status, clockedInAt, changedAt, expiresAt }
}

export function roster(state: State, incident: WorkflowCase, now: number): EngineerOnShift[] {
  const people = new Map<string, EngineerOnShift>()
  for (const { digest, person, expires } of state.sessions) {
    if (expires <= now || person.role === 'control' || !withinScope(person, incident)) continue
    const shift = deviceShift(state, digest, now)
    if (shift.status === 'off') continue
    const current = people.get(person.id)
    if (!current || (current.shift.status === 'busy' && shift.status === 'available')) people.set(person.id, { person, shift })
  }
  return [...people.values()].sort((a, b) => a.person.name.localeCompare(b.person.name))
}

export function changeShift(state: State, session: Session, status: ShiftStatus, now: number) {
  const previous = deviceShift(state, session.digest, now)
  if (previous.status === status) return previous
  if (previous.status === 'off' && status === 'busy') return null
  const starting = previous.status === 'off'
  const shift: Shift = {
    status, changedAt: now,
    clockedInAt: starting ? now : previous.clockedInAt,
    expiresAt: status === 'off' ? null : starting ? Math.min(session.expires, now + shiftLength) : previous.expiresAt,
  }
  state.shifts = state.shifts.filter((item) => item.session !== session.digest)
  state.shifts.push({ session: session.digest, ...shift })
  return shift
}

export function shiftHandler(store: WorkspaceStore, auth: SessionAuth, origin?: string) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const session = await auth.session(request)
    if (!session) { send(response, 401, { error: 'Sign in to use field shifts.' }); return }
    if (url.pathname === '/api/shift/engineers' && request.method === 'GET') {
      if (session.person.role !== 'control') { send(response, 403, { error: 'Only control can view the dispatch roster.' }); return }
      const state = await store.read()
      const key = url.searchParams.get('case')
      const entry = state.entries.find((item) => caseKey(item.incident) === key)
      if (entry?.stage !== 'confirmed') { send(response, 409, { error: 'Confirm the incident to view eligible engineers.' }); return }
      send(response, 200, roster(state, entry.incident, Date.now()))
      return
    }
    if (url.pathname !== '/api/shift') { send(response, 404, { error: 'Unknown shift request.' }); return }
    if (session.person.role === 'control') { send(response, 403, { error: 'An enrolled field device is required.' }); return }
    if (request.method === 'GET') {
      send(response, 200, deviceShift(await store.read(), session.digest, Date.now()))
      return
    }
    if (request.method !== 'POST') { send(response, 405, { error: 'Expected GET or POST.' }); return }
    const input = await requestBody(request, 1024, origin) as { status?: unknown } | null
    const status = input?.status
    if (!isShiftStatus(status)) { send(response, 400, { error: 'Choose a valid shift status.' }); return }
    const shift = await store.update((state) => {
      const now = Date.now()
      if (!state.sessions.some((item) => item.digest === session.digest && item.expires > now)) return undefined
      return changeShift(state, session, status, now)
    })
    if (shift === undefined) { send(response, 401, { error: 'This field session has ended.' }); return }
    send(response, shift ? 200 : 409, shift ?? { error: 'Clock in before setting your status to Busy.' })
  }
}
