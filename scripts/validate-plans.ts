import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDataset } from '../src/engine/load.ts'
import { activeAlerts, detectIncidents } from '../src/engine/incidents.ts'
import { optimize } from '../src/engine/optimize.ts'
import { noAction, scenarioAt, simulate } from '../src/engine/simulate.ts'

const history = join(process.argv[2] ?? (existsSync('../.eog-reference') ? '../.eog-reference' : '.eog-reference'), 'history')
const load = (folder: string) => {
  const files = ['network.json', 'ops.json', 'telemetry.csv'].map((file) => readFileSync(join(history, folder, file), 'utf8'))
  return parseDataset(folder, files[0], files[1], files[2])
}
const full = load('full_week')
const event = JSON.parse(readFileSync(join(history, 'full_week', 'answer_key.json'), 'utf8')).find((row) => row.id === 'EVENT_9')
const at = event.onset_unix
const case9 = scenarioAt(full, activeAlerts(full, detectIncidents(full), at), event.system, at)
const baseline = simulate(case9, noAction)
const well = simulate(case9, { jobs: [], shutIns: [{ wellId: 'S1_WELL_C2', startMin: 125 }] })
const truck = simulate(case9, { jobs: [{ truck: 1, facilityId: event.facility, dispatchMin: 0, trips: 1 }], shutIns: [] })
const documented = {
  ...case9,
  failures: case9.failures.map((failure) => ({ ...failure, initialBbl: event.level_pct / 100 * failure.facility.tank.capacityBbl })),
}
assert.ok(Math.abs(simulate(documented, noAction).costs.total - 5016) <= .01)
assert.ok(Math.abs(baseline.costs.total - 5016) <= 25)
assert.ok(Math.abs(well.costs.total - 1958) <= 1)
assert.equal(truck.costs.total, 905)
assert.equal(well.facilities[0].autoAt, null)
assert.equal(truck.facilities[0].autoAt, null)
assert.equal(optimize(case9).best.costs.total, 905)
console.log('EVENT_9:', [baseline, well, truck].map((result) => '$' + result.costs.total.toFixed(2)).join(' / '), '· reference 50% fill: $' + simulate(documented, noAction).costs.total.toFixed(2))

for (const [folder, system] of [['snapshot_2026-10-08T1200', 'S2'], ['snapshot_2026-10-10T0900', 'S4']]) {
  const data = load(folder)
  const alerts = activeAlerts(data, detectIncidents(data), data.now)
  const scenario = scenarioAt(data, alerts, system, data.now)
  const result = optimize(scenario)
  assert.equal(scenario.failures.length, 3)
  assert.equal(scenario.system.fleetSize, 2)
  assert.ok(result.best.costs.total < result.baseline.costs.total)
  assert.deepEqual(result.best, simulate(scenario, result.best.plan))
  assert.ok(result.best.jobs.every((job) => job.truck <= scenario.system.fleetSize))
  console.log(system + ': $' + result.baseline.costs.total.toFixed(2) + ' baseline → $' + result.best.costs.total.toFixed(2) + ' best of ' + result.evaluated + ' schedules', result.best.plan)
}
