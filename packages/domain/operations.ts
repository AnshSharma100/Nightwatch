import type { Alert } from './incidents.ts'
import type { Dataset } from './model.ts'

export interface FailureExposure {
  assetId: string
  facilityId: string
  countdownMin: number | null
  repairMin: number | null
  revenuePerHour: number
  automatic: boolean
}

export interface OperationsSummary {
  urgent: number
  active: number
  shutIn: number
  next: { assetId: string; facilityId: string; minutes: number } | null
  atRiskPerHour: number
  projectedLoss: number | null
}

export function exposureInputs(data: Dataset, alerts: readonly Alert[]): FailureExposure[] {
  return alerts.filter((alert) => alert.category === 'pump_failure').map((alert) => ({
    assetId: alert.assetId,
    facilityId: data.facilities.get(alert.facilityId)!.id,
    countdownMin: alert.minutesToLimit,
    repairMin: alert.repairMinutes,
    revenuePerHour: alert.revenuePerHour,
    automatic: alert.automatic,
  }))
}

export function summarizeOperations(failures: readonly FailureExposure[]): OperationsSummary {
  const summary: OperationsSummary = { urgent: 0, active: failures.length, shutIn: 0, next: null, atRiskPerHour: 0, projectedLoss: 0 }
  let projectedLoss = 0
  let complete = true
  for (const failure of failures) {
    const { automatic, countdownMin, repairMin, revenuePerHour } = failure
    if (automatic) {
      summary.shutIn++
      if (repairMin === null) complete = false
      else projectedLoss += repairMin / 60 * revenuePerHour
    } else if (countdownMin === null || repairMin === null) {
      complete = false
    } else if (countdownMin < repairMin) {
      summary.urgent++
      summary.atRiskPerHour += revenuePerHour
      projectedLoss += (repairMin - countdownMin) / 60 * revenuePerHour
      if (!summary.next || countdownMin < summary.next.minutes) {
        summary.next = { assetId: failure.assetId, facilityId: failure.facilityId, minutes: countdownMin }
      }
    }
  }
  summary.projectedLoss = complete ? projectedLoss : null
  return summary
}

export function isExposureInput(value: unknown): value is FailureExposure {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<FailureExposure>
  const positive = (number: unknown) => typeof number === 'number' && Number.isFinite(number) && number >= 0
  return typeof row.assetId === 'string' && typeof row.facilityId === 'string' && typeof row.automatic === 'boolean' &&
    positive(row.revenuePerHour) && (row.countdownMin === null || positive(row.countdownMin)) &&
    (row.repairMin === null || positive(row.repairMin))
}
