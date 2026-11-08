export const STEP_SECONDS = 300

export interface Well {
  id: string
  baselineWaterBpd: number
  oilBpd: number
  gasMcfd: number
  revenuePerHour: number
}

export interface Facility {
  id: string
  systemId: string
  location: [lat: number, lon: number]
  wells: Well[]
  tank: { id: string; capacityBbl: number }
  pump: { id: string; maxFlowBpd: number; startPct: number; stopPct: number }
  pipeline: { id: string; maxBpd: number; maxPressurePsi: number }
  trucking: { responseMin: number; cycleMin: number }
}

export interface System {
  id: string
  center: [lat: number, lon: number]
  truckYard: [lat: number, lon: number]
  disposal: { id: string; location: [lat: number, lon: number]; pressurePsi: number }
  fleetSize: number
  facilities: Facility[]
}

export type AssetKind = 'system' | 'facility' | 'tank' | 'pump' | 'pipeline' | 'well' | 'disposal' | 'yard'
export type Metric = 'status' | 'water_bpd' | 'inflow_bpd' | 'level_pct' | 'flow_bpd' | 'discharge_psi' | 'receive_flow_bpd' | 'pressure_psi'
export interface Asset {
  id: string
  kind: AssetKind
  systemId: string
  facilityId?: string
}
export const sensorMetrics: Partial<Record<AssetKind, readonly Metric[]>> = {
  facility: ['inflow_bpd'],
  well: ['water_bpd', 'status'],
  tank: ['level_pct'],
  pump: ['status', 'flow_bpd', 'discharge_psi'],
  pipeline: ['receive_flow_bpd', 'pressure_psi'],
}
export interface Point { at: number; value: number }
export interface Dataset {
  name: string
  networkKey: string
  systems: System[]
  facilities: Map<string, Facility>
  assets: Map<string, Asset>
  telemetry: Map<string, Map<Metric, Point[]>>
  times: number[]
  start: number
  now: number
  warningPct: number
  shutdownPct: number
  repairHours: number
  truckCapacityBbl: number
  truckCost: number
  prices: { oil: number; gas: number }
}

export function series(data: Dataset, id: string, metric: Metric): readonly Point[] {
  return data.telemetry.get(id)?.get(metric) ?? []
}

function upperBound(points: readonly Point[], at: number) {
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid].at <= at) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function read(data: Dataset, id: string, metric: Metric, at: number): number | undefined {
  const points = series(data, id, metric)
  const point = points[upperBound(points, at) - 1]
  return point?.at === at ? point.value : undefined
}

export function windowed(data: Dataset, id: string, metric: Metric, start: number, end: number) {
  const points = series(data, id, metric)
  return points.slice(upperBound(points, start - 1), upperBound(points, end))
}

export function yardId(systemId: string) {
  return JSON.stringify(['truck-yard', systemId])
}
