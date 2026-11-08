import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { sampleDataset } from './fixture.ts'
import { activeAlerts, detectIncidents } from '../packages/domain/incidents.ts'
import { caseFromAlert, isWorkflowUpdate } from '../packages/domain/workflow.ts'
import { controlPerson, personFor } from '../packages/domain/personnel.ts'
import { prepareApproval } from '../server/approval.ts'
import { applyChange } from '../server/workflow.ts'
import { workspaceStore } from '../server/store.ts'
import { changeShift } from '../server/shifts.ts'

test('selected plans are scoped, simulated, persisted and never replaced by a recommendation', () => {
  const data = sampleDataset((asset, metric, _step, value) => asset === 'A/pump' && metric === 'status' ? 2 : value)
  const before = structuredClone(data.telemetry)
  const alerts = activeAlerts(data, detectIncidents(data), data.now)
  const alert = alerts.find((item) => item.assetId === 'A/pump')!
  const incident = caseFromAlert(data, alert, data.now)
  const selection = { network: data.networkKey, at: data.now, systemId: alert.systemId,
    plan: { jobs: [{ truck: 2, facilityId: 'A', dispatchMin: 7, trips: 1 }], shutIns: [] } }
  const prepared = prepareApproval(data, alerts, alert, selection)
  assert.match(prepared.response, /Selected Butterfly plan/)
  assert.match(prepared.response, /Truck 2, 1 trip\(s\), first arrival after 27 min/)
  assert.deepEqual(prepared.approvalPlan, selection)
  for (const changed of [{ network: 'other' }, { at: data.now - 300 }, { systemId: 'other' }]) {
    assert.throws(() => prepareApproval(data, alerts, alert, { ...selection, ...changed }), /different recording or system/)
  }
  assert.throws(() => prepareApproval(data, alerts, alert, { ...selection, plan: {
    ...selection.plan, jobs: [...selection.plan.jobs, ...selection.plan.jobs],
  } }), /still assigned/)
  assert.throws(() => prepareApproval(data, alerts, alert, { ...selection, plan: {
    ...selection.plan, jobs: [{ ...selection.plan.jobs[0], facilityId: 'unrelated' }],
  } }))
  const root = join(process.cwd(), '.nightwatch')
  mkdirSync(root, { recursive: true })
  const temp = mkdtempSync(join(root, 'test-approval-'))
  const file = join(temp, 'state.json')
  try {
    const store = workspaceStore(file)
    const now = Date.now()
    for (const [action, revision] of [['review', 0], ['confirm', 1]] as const) {
      assert.equal(store.update((state) => applyChange(state, controlPerson, {
        incident, actor: 'control', action, revision, note: 'Verified recorded fault.',
      }, now)).status, 200)
    }
    assert.equal(store.read().deliveries.length, 0)
    const person = personFor(incident, 'lease')
    store.update((state) => {
      const session = { digest: 'test-engineer', person, expires: now + 100000 }
      state.sessions.push(session)
      changeShift(state, session, 'available', now)
    })
    const update = { incident, actor: 'control' as const, action: 'assign' as const, revision: 2,
      note: 'Inspect and report; coordinate the chosen simulation with control.', recipientId: person.id, ...prepared }
    assert.ok(isWorkflowUpdate(update))
    assert.equal(isWorkflowUpdate({ ...update, approvalPlan: null }), false)
    assert.equal(isWorkflowUpdate({ ...update, approvalPlan: { ...selection, plan: { jobs: 'invalid', shutIns: [] } } }), false)
    const first = store.update((state) => applyChange(state, controlPerson, update, now))
    assert.equal(first.status, 200)
    assert.ok(first.deliveryId)
    assert.equal(store.update((state) => applyChange(state, controlPerson, update, now)).deliveryId, undefined)
    const changed = { ...update, approvalPlan: { ...selection, plan: { jobs: [], shutIns: [] } } }
    assert.equal(store.update((state) => applyChange(state, controlPerson, changed, now)).status, 409)
    const restored = workspaceStore(file).read()
    assert.deepEqual(restored.entries[0].assignment?.approvalPlan, selection)
    assert.deepEqual(restored.entries[0].history.at(-1)?.approvalPlan, selection)
    assert.equal(restored.deliveries.length, 1)
    assert.deepEqual(data.telemetry, before)
  } finally {
    rmSync(file, { force: true })
    rmdirSync(temp)
  }
})
