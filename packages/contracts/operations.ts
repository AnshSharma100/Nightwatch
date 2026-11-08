import type { Alert, Incident } from '../domain/incidents.ts'
import type { Asset, Dataset, Metric } from '../domain/model.ts'
import type { OperationsSummary } from '../domain/operations.ts'
import type { Optimization } from '../domain/optimize.ts'
import type { Outcome, Plan, Scenario } from '../domain/simulate.ts'

export interface RecordingView extends Omit<Dataset, 'assets' | 'facilities' | 'telemetry'> {
  assets: Asset[]
  series: [id: string, metric: Metric, samples: [time: number, value: number][]][]
}

export interface RecordedSnapshot { at: number; alerts: Alert[]; summary: OperationsSummary }
export interface OpenRecording {
  id: string
  data: RecordingView
  incidents: Incident[]
  latest: RecordedSnapshot
}
export interface ComparisonRequest { at: number; systemId: string; plan?: Plan; demo?: boolean }
export interface PlanComparison { scenario: Scenario; search: Optimization; operator: Outcome | null }

export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const minutes = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function isPlan(value: unknown): value is Plan {
  return isObject(value) && Array.isArray(value.jobs) && value.jobs.length <= 60 &&
    Array.isArray(value.shutIns) && value.shutIns.length <= 60 &&
    value.jobs.every((job) => isObject(job) && isIdentifier(job.facilityId) && minutes(job.dispatchMin) &&
      Number.isSafeInteger(job.truck) && Number(job.truck) >= 1 &&
      Number.isSafeInteger(job.trips) && Number(job.trips) >= 1 && Number(job.trips) <= 100) &&
    value.shutIns.every((stop) => isObject(stop) && isIdentifier(stop.wellId) && minutes(stop.startMin))
}

export function isComparison(value: unknown): value is ComparisonRequest {
  return isObject(value) && Number.isSafeInteger(value.at) && isIdentifier(value.systemId) &&
    (value.plan === undefined || isPlan(value.plan)) && (value.demo === undefined || typeof value.demo === 'boolean')
}

export interface DatasetUpload { name?: string; network: string; ops: string; telemetry: string }
export function isDatasetUpload(value: unknown): value is DatasetUpload {
  return isObject(value) && (value.name === undefined || typeof value.name === 'string' && value.name.length <= 120) &&
    typeof value.network === 'string' && value.network.length <= 1_000_000 &&
    typeof value.ops === 'string' && value.ops.length <= 1_000_000 &&
    typeof value.telemetry === 'string' && value.telemetry.length <= 60_000_000
}

export function recordingView(data: Dataset): RecordingView {
  const { facilities, assets, telemetry, ...metadata } = data
  const series: RecordingView['series'] = []
  for (const [id, metrics] of telemetry) {
    for (const [metric, points] of metrics) {
      series.push([id, metric, points.map(({ at, value }) => [at, value])])
    }
  }
  return { ...metadata, assets: [...assets.values()], series }
}

export function hydrateRecording(view: RecordingView): Dataset {
  const { assets, series, ...metadata } = view
  const telemetry: Dataset['telemetry'] = new Map()
  for (const [id, metric, points] of series) {
    if (!telemetry.has(id)) telemetry.set(id, new Map())
    telemetry.get(id)!.set(metric, points.map(([at, value]) => ({ at, value })))
  }
  return {
    ...metadata, telemetry,
    facilities: new Map(view.systems.flatMap((system) => system.facilities.map((facility) => [facility.id, facility]))),
    assets: new Map(assets.map((asset) => [asset.id, asset])),
  }
}
