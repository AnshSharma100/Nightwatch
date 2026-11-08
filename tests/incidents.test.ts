import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeAlerts, detectIncidents } from '../packages/domain/incidents.ts'
import { sampleDataset } from './fixture.ts'

test('normal cycling never raises an incident', () => {
  assert.deepEqual(detectIncidents(sampleDataset()), [])
})

test('fault status fires immediately and does not leak into earlier playback', () => {
  const data = sampleDataset((id, metric, step, value) => id === 'A/pump' && step === 2
    ? metric === 'status' ? 2 : metric === 'flow_bpd' ? 0 : value
    : value)
  const incidents = detectIncidents(data)
  assert.equal(incidents.length, 1)
  assert.equal(incidents[0].category, 'pump_failure')
  assert.equal(activeAlerts(data, incidents, data.start + 300).length, 0)
  const [alert] = activeAlerts(data, incidents, data.start + 600)
  assert.equal(alert.minutesToLimit, 133.20000000000002)
  assert.equal(alert.repairMinutes, 180)
  assert.equal(alert.clearedAt, null)
  assert.equal(activeAlerts(data, incidents, data.now).length, 0)
})

test('requires sustained running evidence for degradation and leaks', () => {
  const data = sampleDataset((id, metric, step, value) => {
    if (!step) return value
    if (id === 'A/pump' && metric === 'flow_bpd') return 2280
    if (id === 'B/line' && metric === 'receive_flow_bpd') return 2200
    if (id === 'B/line' && metric === 'pressure_psi') return 1005
    if (id === 'C/line' && metric === 'pressure_psi' && step === 3) return 1000
    return value
  })
  const incidents = detectIncidents(data)
  assert.equal(activeAlerts(data, incidents, data.now - 300).length, 0)
  assert.deepEqual(activeAlerts(data, incidents, data.now).map((a) => a.category), ['pump_degradation', 'pipeline_leak'])
})
