import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { Pool, PoolClient } from 'pg'
import type { Assignment, Person } from '../packages/domain/personnel.ts'
import { caseKey } from '../packages/domain/workflow.ts'
import type { WorkflowEntry, WorkflowEvent } from '../packages/domain/workflow.ts'
import { workspaceStore } from './store.ts'
import type { State, WorkspaceStore } from './store.ts'
import type { RecordingCatalog } from './datasets.ts'

const migration = new URL('./migrations/001-workspace.sql', import.meta.url)
const lockId = 0x4e574154

const tables = {
  nw_people: ['id', 'role', 'network_key', 'system_id', 'facility_id', 'payload'],
  nw_incidents: ['id', 'network_key', 'system_id', 'facility_id', 'stage', 'payload'],
  nw_assignments: ['id', 'case_id', 'recipient_id', 'payload'],
  nw_transitions: ['id', 'case_id', 'revision', 'action', 'actor_id', 'recipient_id', 'happened_at', 'payload'],
  nw_sessions: ['id', 'person_id', 'expires_at', 'payload'],
  nw_invites: ['id', 'person_id', 'expires_at', 'payload'],
  nw_shifts: ['id', 'status', 'expires_at', 'payload'],
  nw_subscriptions: ['id', 'person_id', 'endpoint_key', 'payload'],
  nw_push_attempts: ['id', 'assignment_id', 'recipient_id', 'status', 'payload'],
}
type Table = keyof typeof tables
type Row = [id: string, ...values: unknown[]]
type Rows = Record<Table, Row[]>
const tableOrder = Object.keys(tables) as Table[]
const deleteOrder = [...tableOrder].reverse().filter((table) => table !== 'nw_people')

function rowsFor(state: State): Rows {
  const people = new Map<string, Person>()
  function personId(person?: Person) {
    if (person) people.set(person.id, person)
    return person?.id ?? null
  }

  const cases: Row[] = []
  const assignments: Row[] = []
  const transitions: Row[] = []
  for (const { history, assignment, ...entry } of state.entries) {
    const { incident, stage } = entry
    const id = caseKey(incident)
    cases.push([id, incident.network, incident.systemId, incident.facilityId, stage, { id, entry }])
    if (assignment) assignments.push([assignment.id, id, personId(assignment.recipient), { id, assignment }])
    for (const [revision, event] of history.entries()) {
      transitions.push([JSON.stringify([id, revision]), id, revision, event.action, personId(event.person), personId(event.recipient), event.at, { id, event }])
    }
  }
  const sessions: Row[] = state.sessions.map((session) => [session.digest, personId(session.person), session.expires, session])
  const invites: Row[] = state.invites.map((invite) => [invite.digest, personId(invite.person), invite.expires, invite])
  return {
    nw_people: [...people.values()].map((person) => [person.id, person.role, person.network ?? null, person.systemId ?? null, person.facilityId ?? null, person]),
    nw_incidents: cases,
    nw_assignments: assignments,
    nw_transitions: transitions,
    nw_sessions: sessions,
    nw_invites: invites,
    nw_shifts: state.shifts.map((shift) => [shift.session, shift.status, shift.expiresAt, shift]),
    nw_subscriptions: state.subscriptions.map((sub) => [sub.session, sub.personId, createHash('sha256').update(sub.value.endpoint).digest('hex'), sub]),
    nw_push_attempts: state.deliveries.map((delivery) => [delivery.id, delivery.assignmentId, delivery.recipientId, delivery.status, delivery]),
  }
}

interface StoredSnapshot extends Omit<State, 'entries'> {
  cases: { id: string; entry: Omit<WorkflowEntry, 'history' | 'assignment'> }[]
  assignments: { id: string; assignment: Assignment }[]
  transitions: { id: string; event: WorkflowEvent }[]
}

async function readState(db: Pick<Pool, 'query'>): Promise<State> {
  const { rows: [row] } = await db.query<StoredSnapshot>(`
    SELECT
      coalesce((SELECT jsonb_agg(payload ORDER BY id) FROM nw_incidents), '[]') AS cases,
      coalesce((SELECT jsonb_agg(payload ORDER BY id) FROM nw_assignments), '[]') AS assignments,
      coalesce((SELECT jsonb_agg(payload ORDER BY case_id, revision) FROM nw_transitions), '[]') AS transitions,
      coalesce((SELECT jsonb_agg(payload ORDER BY id) FROM nw_sessions), '[]') AS sessions,
      coalesce((SELECT jsonb_agg(payload ORDER BY id) FROM nw_invites), '[]') AS invites,
      coalesce((SELECT jsonb_agg(payload ORDER BY id) FROM nw_shifts), '[]') AS shifts,
      coalesce((SELECT jsonb_agg(payload ORDER BY id) FROM nw_subscriptions), '[]') AS subscriptions,
      coalesce((SELECT jsonb_agg(payload ORDER BY ordinal) FROM nw_push_attempts), '[]') AS deliveries
  `)
  const { cases, assignments, transitions, ...state } = row
  const entries = new Map(cases.map(({ id, entry }) => [id, { ...entry, history: [] } satisfies WorkflowEntry] as [string, WorkflowEntry]))
  for (const { id, assignment } of assignments) entries.get(id)!.assignment = assignment
  for (const { id, event } of transitions) entries.get(id)!.history.push(event)
  return { ...state, entries: [...entries.values()] }
}

function upsertSql(table: Table) {
  const columns = tables[table]
  const placeholders = columns.map((_, index) => '$' + (index + 1))
  return 'INSERT INTO ' + table + ' (' + columns.join(', ') + ') VALUES (' + placeholders.join(', ') +
    ') ON CONFLICT (id) DO UPDATE SET ' + columns.slice(1).map((column) => column + ' = EXCLUDED.' + column).join(', ')
}

async function saveChanges(client: PoolClient, before: Rows, after: Rows) {
  // Free unique subscription keys before reattaching an endpoint to another device session.
  for (const table of deleteOrder) {
    const keep = new Set(after[table].map(([id]) => id))
    const removed = before[table].map(([id]) => id).filter((id) => !keep.has(id))
    if (removed.length) await client.query('DELETE FROM ' + table + ' WHERE id = ANY($1::text[])', [removed])
  }
  for (const table of tableOrder) {
    const previous = new Map(before[table].map((row) => [row[0], JSON.stringify(row)]))
    for (const row of after[table]) {
      if (previous.get(row[0]) !== JSON.stringify(row)) await client.query(upsertSql(table), row)
    }
  }
}

async function transaction<T>(pool: Pool, apply: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockId])
    const result = await apply(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export function postgresStore(pool: Pool, legacyFile?: string): WorkspaceStore & { catalog: RecordingCatalog } {
  let initialized: Promise<void> | undefined
  const initialize = () => initialized ??= transaction(pool, async (client) => {
    await client.query('CREATE TABLE IF NOT EXISTS nw_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const { rowCount } = await client.query('SELECT 1 FROM nw_migrations WHERE version = 1')
    if (rowCount) return
    await client.query(readFileSync(migration, 'utf8'))
    if (legacyFile && existsSync(legacyFile)) {
      const baseline = rowsFor(await readState(client))
      await saveChanges(client, baseline, rowsFor(workspaceStore(legacyFile).read()))
    }
    await client.query('INSERT INTO nw_migrations (version) VALUES (1)')
  }).catch((error) => { initialized = undefined; throw error })

  return {
    async read() { await initialize(); return readState(pool) },
    async update(apply) {
      await initialize()
      return transaction(pool, async (client) => {
        const state = await readState(client)
        const before = rowsFor(state)
        // Snapshot row values before application logic mutates nested delivery and workflow records.
        const baseline = structuredClone(before)
        const result = apply(state)
        await saveChanges(client, baseline, rowsFor(state))
        return result
      })
    },
    async ready() { await initialize(); await pool.query('SELECT 1') },
    close: () => pool.end(),
    catalog: {
      async record(item) {
        await initialize()
        await pool.query(`INSERT INTO nw_recordings
          (id, owner_hash, network_key, title, recorded_from, recorded_through, file_ref, checksum)
          VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($6), $7, $8)`,
        [item.id, item.owner, item.network, item.name, item.start, item.end, item.file, item.checksum])
      },
      async checksum(id, owner) {
        await initialize()
        const { rows } = await pool.query<{ checksum: string }>('SELECT checksum FROM nw_recordings WHERE id = $1 AND owner_hash = $2', [id, owner])
        return rows[0]?.checksum
      },
    },
  }
}
