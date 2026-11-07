import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeAlerts, detectIncidents } from '../src/engine/incidents.ts'
import { optimize } from '../src/engine/optimize.ts'
import { noAction, scenarioAt, simulate } from '../src/engine/simulate.ts'
import { sampleDataset } from './fixture.ts'

function failures(level = 80) {
  const data = sampleDataset((id, metric, _step, value) => id.endsWith('/tank') ? level
    : id.endsWith('/pump') && metric === 'status' ? 2 : value)
  const alerts = activeAlerts(data, detectIncidents(data), data.now)
  return scenarioAt(data, alerts, data.systems[0].id, data.now)
}

test('no action latches shut-in and computes exact oil and gas losses to repair', () => {
  const scenario = failures()
  const result = simulate(scenario, noAction)
  assert.equal(result.facilities[0].autoAt, 72)
  assert.equal(result.facilities[0].costs.oil, 465)
  assert.equal(result.facilities[0].costs.gas, 0)
  assert.equal(result.facilities[0].frames.at(-1)?.producing, 1)
  assert.equal(result.facilities[0].frames.at(-1)?.bbl, 552)
})

test('a trip after automatic shut-in removes water without restarting wells', () => {
  const scenario = failures()
  const result = simulate(scenario, { jobs: [{ truck: 1, facilityId: 'A', dispatchMin: 60, trips: 1 }], shutIns: [] })
  assert.equal(result.facilities[0].autoAt, 72)
  assert.equal(result.facilities[0].costs.total, 565)
  assert.equal(result.facilities[0].frames.find((frame) => frame.minute === 80)?.producing, 0)
})

test('truck slots enforce departure, arrival, full-trip capacity and return time', () => {
  const scenario = failures()
  const first = { truck: 1, facilityId: 'A', dispatchMin: 0, trips: 2 }
  const second = { truck: 1, facilityId: 'B', dispatchMin: 110, trips: 1 }
  const trial = simulate(scenario, { jobs: [first, second], shutIns: [] })
  assert.deepEqual(trial.jobs.map((job) => job.arrivals), [[20, 65], [130]])
  assert.equal(trial.jobs[0].freeMin, 110)
  assert.throws(() => simulate(scenario, { jobs: [first, { ...second, dispatchMin: 109 }], shutIns: [] }), /still assigned/)
  assert.throws(() => simulate(scenario, { jobs: [{ ...first, trips: 5 }], shutIns: [] }), /before repair/)
  assert.throws(() => simulate(scenario, { jobs: [{ ...first, truck: 3 }], shutIns: [] }), /available fleet slot/)
  assert.throws(() => simulate(failures(3), { jobs: [first], shutIns: [] }), /enough water/)
})

test('search shares two trucks across three failures and beats the baseline', () => {
  const scenario = failures()
  const result = optimize(scenario)
  assert.ok(result.best.costs.total < result.baseline.costs.total)
  assert.deepEqual(result.best, simulate(scenario, result.best.plan))
  assert.ok(result.best.jobs.every((job) => job.truck <= 2))
  assert.equal(optimize(failures(10)).best.costs.total, 0)
})
