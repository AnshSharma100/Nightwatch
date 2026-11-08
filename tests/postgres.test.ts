import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import pg from 'pg'
import { controlPerson, personFor } from '../packages/domain/personnel.ts'
import type { Action, WorkflowCase } from '../packages/domain/workflow.ts'
import { postgresStore } from '../server/postgres.ts'
import { changeShift } from '../server/shifts.ts'
import { workspaceStore } from '../server/store.ts'
import { applyChange } from '../server/workflow.ts'

const database = process.env.NIGHTWATCH_TEST_DATABASE_URL

test('PostgreSQL migrates local state and preserves a single audited dispatch across concurrent API stores', { skip: !database }, async () => {
  const schema = 'nw_test_' + randomUUID().replaceAll('-', '')
  const admin = new pg.Pool({ connectionString: database })
  const root = join(process.cwd(), '.nightwatch')
  mkdirSync(root, { recursive: true })
  const temp = mkdtempSync(join(root, 'test-pg-'))
  const legacy = join(temp, 'workflow.json')
  const incident: WorkflowCase = {
    network: 'private-sample', systemId: 'North / 9', facilityId: 'Unseen site', assetId: 'Pump 8',
    category: 'pump_failure', onset: 300, observedAt: 600, evidence: ['Fault status 2'],
  }
  const field = personFor(incident, 'lease')
  const now = Date.now()
  const command = (action: Action, revision: number, note: string) => ({ incident, actor: 'control' as const, action, revision, note })
  workspaceStore(legacy).update((state) => {
    applyChange(state, controlPerson, command('review', 0, ''), now)
    applyChange(state, controlPerson, command('confirm', 1, 'Recorded fault verified.'), now)
    const session = { digest: 'device-session', person: field, expires: now + 90_000 }
    state.sessions.push(session)
    changeShift(state, session, 'available', now)
    state.subscriptions.push({ session: session.digest, personId: field.id,
      value: { endpoint: 'https://fcm.googleapis.com/example', keys: { p256dh: 'test', auth: 'test' } } })
  })

  await admin.query('CREATE SCHEMA ' + schema)
  const open = () => postgresStore(new pg.Pool({ connectionString: database, options: '-c search_path=' + schema }), legacy)
  const a = open(), b = open()
  let restart: ReturnType<typeof open> | undefined
  try {
    await Promise.all([a.ready(), b.ready()])
    assert.equal((await a.read()).entries[0].stage, 'confirmed')
    const dispatch = { ...command('assign', 2, 'Inspect the confirmed fault.'), recipientId: field.id }
    const sent = await Promise.all([a, b].map((store) => store.update((state) => applyChange(state, controlPerson, dispatch, now + 1))))
    assert.equal(sent.filter((result) => result.deliveryId).length, 1)
    assert.equal(sent[0].entry?.assignment?.id, sent[1].entry?.assignment?.id)
    assert.equal((await b.read()).deliveries.length, 1)

    await assert.rejects(a.update((state) => {
      state.entries[0].stage = 'resolved'
      throw new Error('intentional rollback')
    }), /intentional rollback/)
    const acknowledged = await b.update((state) => applyChange(state, field, {
      incident, actor: 'lease', action: 'acknowledge', revision: 3, note: '',
    }, now + 2))
    assert.equal(acknowledged.entry?.stage, 'acknowledged')

    const id = randomUUID()
    await a.catalog.record({ id, owner: 'recording-owner', network: incident.network, name: 'Test', start: 300, end: 600, file: id + '.json', checksum: 'known-checksum' })
    restart = open()
    const persisted = await restart.read()
    assert.equal(persisted.entries[0].stage, 'acknowledged')
    assert.equal(persisted.entries[0].history.length, 4)
    assert.equal(persisted.shifts[0].status, 'available')
    assert.equal(persisted.subscriptions.length, 1)
    assert.equal(persisted.deliveries[0].status, 'queued')
    assert.equal(await restart.catalog.checksum(id, 'recording-owner'), 'known-checksum')
    assert.equal(await restart.catalog.checksum(id, 'other-browser'), undefined)
  } finally {
    await Promise.all([a.close(), b.close(), restart?.close()])
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE')
    await admin.end()
    rmSync(legacy, { force: true })
    rmdirSync(temp)
  }
});
