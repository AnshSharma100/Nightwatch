import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isExposureInput, summarizeOperations } from '../packages/domain/operations.ts'
import type { FailureExposure } from '../packages/domain/operations.ts'

test('revenue exposure excludes repaired and already shut-in facilities', () => {
  const facility = (id: string, countdownMin: number | null, repairMin: number | null, automatic = false): FailureExposure =>
    ({ assetId: id + '/pump', facilityId: id, countdownMin, repairMin, revenuePerHour: 600, automatic })
  const summary = summarizeOperations([
    facility('already-off', 0, 30, true),
    facility('later', 60, 120),
    facility('first', 25, 85),
    facility('repair-first', 120, 30),
  ])
  assert.deepEqual(summary, {
    urgent: 2, active: 4, shutIn: 1, next: { assetId: 'first/pump', facilityId: 'first', minutes: 25 },
    atRiskPerHour: 1200, projectedLoss: 1500,
  })
  assert.equal(summarizeOperations([facility('unmeasured', null, 30)]).projectedLoss, null)
  assert.equal(isExposureInput(facility('valid', 45, 50)), true)
  assert.equal(isExposureInput(facility('invalid', -5, 50)), false)
})
