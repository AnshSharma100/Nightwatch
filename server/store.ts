import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { personFor } from '../packages/domain/personnel.ts'
import { caseKey } from '../packages/domain/workflow.ts'
import type { PushSubscription } from 'web-push'
import type { DeliveryView, Person } from '../packages/domain/personnel.ts'
import type { WorkflowEntry } from '../packages/domain/workflow.ts'

export interface Session { digest: string; person: Person; expires: number }
export interface Invite { digest: string; person: Person; expires: number }
export interface Subscription { session: string; personId: string; value: PushSubscription }
export interface Delivery extends DeliveryView { id: string; assignmentId: string; recipientId: string }
export interface State {
  entries: WorkflowEntry[]
  sessions: Session[]
  invites: Invite[]
  subscriptions: Subscription[]
  deliveries: Delivery[]
}

function migrate(entry: WorkflowEntry): WorkflowEntry {
  if (entry.assignment || !entry.assignee) return entry
  const allocation = entry.history.findLast((event) => event.action === 'assign' || event.action === 'handoff')
  if (!allocation) return entry
  const hash = createHash('sha256').update(caseKey(entry.incident)).digest('hex')
  const id = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-')
  return { ...entry, assignment: {
    id, recipient: personFor(entry.incident, entry.assignee), assignedAt: allocation.at,
    briefing: entry.history.findLast((event) => event.note && (event.action === 'assign' || event.action === 'handoff'))?.note ?? '',
    response: 'Inspect the affected equipment and report findings.',
  } }
}

export function workspaceStore(path: string) {
  const file = resolve(path)
  function read(): State {
    const parsed = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
    if (Array.isArray(parsed)) return { entries: parsed.map(migrate), sessions: [], invites: [], subscriptions: [], deliveries: [] }
    return parsed as State
  }
  function update<T>(apply: (state: State) => T): T {
    const state = read()
    const result = apply(state)
    mkdirSync(dirname(file), { recursive: true })
    const temporary = file + '.' + process.pid + '.tmp'
    writeFileSync(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
    try {
      const wait = new Int32Array(new SharedArrayBuffer(4))
      for (let attempt = 0; ; attempt++) {
        try { renameSync(temporary, file); break }
        catch (error) {
          if (process.platform !== 'win32' || attempt === 5 ||
              !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
          Atomics.wait(wait, 0, 0, 10 * (attempt + 1))
        }
      }
    } finally {
      rmSync(temporary, { force: true })
    }
    return result
  }
  return { read, update }
}

export type WorkspaceStore = ReturnType<typeof workspaceStore>
