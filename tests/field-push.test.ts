import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs'

import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { applyChange, canRead } from '../server/workflow.ts'
import { workspaceStore } from '../server/store.ts'
import { pushService } from '../server/push.ts'
import { controlPerson, personFor } from '../src/engine/personnel.ts'
import type { Person } from '../src/engine/personnel.ts'
import type { Action, WorkflowCase } from '../src/engine/workflow.ts'

const incident: WorkflowCase = { network: 'first-network', systemId: 'S7', facilityId: 'New site', assetId: 'Pump 8',
  category: 'pump_failure', onset: 300, observedAt: 600, evidence: ['Pump status recorded'] }
const foreman = personFor(incident, 'foreman')
const other = personFor({ ...incident, network: 'different-network' }, 'foreman')
const lease = personFor(incident, 'lease')
const change = (person: Person, action: Action, revision: number, note = '') => ({ incident, actor: person.role, action, revision, note })

test('explicit allocation queues one push and only the enrolled recipient receives it', async () => {
  const testRoot = join(process.cwd(), '.nightwatch')
  mkdirSync(testRoot, { recursive: true })
  const temp = mkdtempSync(join(testRoot, 'test-push-'))
  const file = join(temp, 'state.json')
  const store = workspaceStore(file)
  const mutate = (person: Person, action: Action, revision: number, note?: string) =>
    store.update((state) => applyChange(state, person, change(person, action, revision, note), Date.now()))
  const sent: string[] = []
  const push = pushService(store, { publicKey: 'public', privateKey: 'private', subject: 'mailto:demo@example.com' }, undefined, async (target, payload) => {
    sent.push(target.endpoint)
    assert.ok(!payload.includes(incident.assetId))
    if (target.endpoint.endsWith('/expired')) throw { statusCode: 410 }
  })
  try {
    assert.equal(store.read().deliveries.length, 0)
    assert.equal(mutate(lease, 'confirm', 0).status, 403)
    assert.equal(mutate(controlPerson, 'assign', 0).status, 409)
    assert.equal(mutate(controlPerson, 'review', 0).status, 200)
    assert.equal(mutate(controlPerson, 'confirm', 1, 'The recorded fault persisted.').status, 200)
    assert.equal(store.read().deliveries.length, 0)
    store.update((state) => {
      for (const [person, id] of [[foreman, 'first'], [foreman, 'expired'], [other, 'other'], [lease, 'lease']] as const) {
        state.sessions.push({ digest: id, person, expires: Date.now() + 100_000 })
        state.subscriptions.push({ session: id, personId: person.id, value: { endpoint: 'https://fcm.googleapis.com/' + id, keys: { p256dh: '', auth: '' } } })
      }
    })
    const allocated = mutate(controlPerson, 'assign', 2, 'Inspect the fault.')
    assert.ok(allocated.deliveryId)
    assert.equal(mutate(controlPerson, 'assign', 2, 'Inspect the fault.').deliveryId, undefined)
    assert.equal(store.read().deliveries.length, 1)
    await push.dispatch(allocated.deliveryId)
    await push.dispatch(allocated.deliveryId)
    assert.deepEqual(sent.sort(), ['https://fcm.googleapis.com/expired', 'https://fcm.googleapis.com/first'])
    const state = store.read()
    assert.deepEqual(state.deliveries.map(({ status, accepted, failed }) => ({ status, accepted, failed })), [
      { status: 'accepted', accepted: 1, failed: 1 },
    ])
    assert.equal(state.subscriptions.some((item) => item.session === 'expired'), false)
    assert.equal(canRead(other, allocated.entry!), false)
    assert.equal(canRead(lease, allocated.entry!), false)
    assert.equal(mutate(other, 'acknowledge', 3).status, 403)
    assert.equal(mutate(foreman, 'acknowledge', 3).entry?.stage, 'acknowledged')
    assert.equal(mutate(foreman, 'acknowledge', 4).entry?.history.length, 4)
    const handedOff = mutate(foreman, 'handoff', 4)
    assert.equal(handedOff.entry?.assignment?.id, allocated.entry?.assignment?.id)
    assert.equal(handedOff.entry?.assignment?.recipient.id, lease.id)
    assert.equal(canRead(lease, handedOff.entry!), true)
    await push.dispatch(handedOff.deliveryId!)
    assert.equal(sent.at(-1), 'https://fcm.googleapis.com/lease')
    assert.equal(mutate(lease, 'acknowledge', 5).status, 200)
    assert.equal(mutate(lease, 'start', 6).status, 200)
    assert.equal(mutate(lease, 'progress', 7, 'Inspection underway.').entry?.stage, 'in_progress')
    assert.equal(mutate(lease, 'resolve', 8, 'Inspection complete.').entry?.stage, 'resolved')
    assert.deepEqual(store.read().entries[0].incident, incident)
  } finally {
    rmSync(file, { force: true })
    rmSync(file + '.' + process.pid + '.tmp', { force: true })
    rmdirSync(temp)
  }
})

test('service worker opens only an authorized route shape on its own origin', async () => {
  const listeners = new Map<string, (event: any) => void>()
  const opened: string[] = []
  const id = '2d523a23-115d-42d6-9904-4ac1164c2ef8'
  runInNewContext(readFileSync('public/field-sw.js', 'utf8'), {
    URL, self: {
      location: { origin: 'https://nightwatch.example' },
      clients: { matchAll: async () => [], openWindow: async (url: string) => opened.push(url) },
      addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener),
    },
  })
  for (const assignmentId of [id, 'https://unrelated.example/']) {
    let work: Promise<void> | undefined
    listeners.get('notificationclick')!({
      notification: { close() {}, data: { assignmentId } }, waitUntil: (promise: Promise<void>) => { work = promise },
    })
    await work
  }
  assert.deepEqual(opened, ['https://nightwatch.example/field/assignments/' + id, 'https://nightwatch.example/field'])
})

test('the installed Web Push library encrypts the payload and signs the provider request', async () => {
  const { createRequire } = await import('node:module')
  const { createECDH, randomBytes } = await import('node:crypto')
  const library = createRequire(import.meta.url)('web-push') as typeof import('web-push')
  const client = createECDH('prime256v1')
  client.generateKeys()
  const keys = library.generateVAPIDKeys()
  const payload = 'synthetic assignment data'
  const request = library.generateRequestDetails({
    endpoint: 'https://fcm.googleapis.com/test-token',
    keys: { p256dh: client.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  }, payload, { vapidDetails: { ...keys, subject: 'mailto:field@example.com' }, TTL: 3600 })
  assert.match(String(request.headers.Authorization), /^vapid t=/)
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm')
  assert.equal(request.body?.includes(payload), false)
})
