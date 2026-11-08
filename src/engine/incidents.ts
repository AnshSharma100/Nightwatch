import { read, STEP_SECONDS } from './model.ts'
import type { Dataset, Facility, System } from './model.ts'

export type Category = 'pipeline_leak' | 'pump_degradation' | 'pump_failure'

export interface Incident {
  category: Category
  assetId: string
  facilityId: string
  systemId: string
  onset: number
  detectedAt: number
  clearedAt: number | null
}

export interface Alert extends Incident {
  evidence: string[]
  levelPct: number | undefined
  minutesToLimit: number | null
  repairMinutes: number | null
  revenuePerHour: number
  automatic: boolean
  verified: boolean
}

interface Pattern {
  candidate: number | null
  hits: number
  healthy: number
  active?: Incident
}

export function detectIncidents(data: Dataset): Incident[] {
  const incidents: Incident[] = []
  for (const system of data.systems) {
    for (const facility of system.facilities) {
      const fresh = (): Pattern => ({ candidate: null, hits: 0, healthy: 0 })
      const leak = fresh()
      const wear = fresh()
      let failure: Incident | undefined
      const close = (pattern: Pattern, at: number) => {
        if (pattern.active) pattern.active.clearedAt = at
        Object.assign(pattern, fresh(), { active: undefined })
      }
      const record = (category: Category, at: number, onset = at) => {
        const incident: Incident = {
          category, assetId: category === 'pipeline_leak' ? facility.pipeline.id : facility.pump.id,
          facilityId: facility.id, systemId: system.id, onset, detectedAt: at, clearedAt: null,
        }
        incidents.push(incident)
        return incident
      }
      const update = (pattern: Pattern, category: Category, at: number, abnormal: boolean, normal: boolean) => {
        if (abnormal) {
          pattern.healthy = 0
          pattern.candidate ??= at
          pattern.hits++
          if (!pattern.active && pattern.hits >= 3) pattern.active = record(category, at, pattern.candidate)
        } else {
          pattern.hits = 0
          pattern.candidate = null
          pattern.healthy = normal ? pattern.healthy + 1 : 0
          if (pattern.active && pattern.healthy >= 3) close(pattern, at)
        }
      }

      let previous = -Infinity
      for (const at of data.times) {
        const status = read(data, facility.pump.id, 'status', at)
        const flow = read(data, facility.pump.id, 'flow_bpd', at)
        if (status === 2) {
          failure ??= record('pump_failure', at)
          close(wear, at)
        } else if (status !== undefined && failure) {
          failure.clearedAt = at
          failure = undefined
        }
        if (status !== 1 || flow === undefined || at - previous > STEP_SECONDS) {
          for (const pattern of [wear, leak]) {
            pattern.candidate = null
            pattern.hits = 0
            pattern.healthy = 0
          }
        }
        previous = at
        if (status !== 1 || flow === undefined || flow <= 0) continue
        const ratio = flow / facility.pump.maxFlowBpd
        update(wear, 'pump_degradation', at, ratio <= 0.975, ratio >= 0.988)
        const receive = read(data, facility.pipeline.id, 'receive_flow_bpd', at)
        const pressure = read(data, facility.pipeline.id, 'pressure_psi', at)
        if (receive === undefined || pressure === undefined) {
          leak.candidate = null
          leak.hits = leak.healthy = 0
          continue
        }
        const deficit = system.disposal.pressurePsi + 50 - pressure
        const loss = (flow - receive) / flow
        update(leak, 'pipeline_leak', at, loss >= 0.012 && deficit >= 12, loss < 0.012 && deficit < 12)
      }
    }
  }
  return incidents.sort((a, b) => a.detectedAt - b.detectedAt)
}

const rounded = (value: number, digits = 1) => value.toLocaleString('en-US', { maximumFractionDigits: digits })

function lastRunning(data: Dataset, facility: Facility, at: number, since: number) {
  for (let time = at; time >= since; time -= STEP_SECONDS) {
    if (read(data, facility.pump.id, 'status', time) === 1) return time
  }
  return since
}

function evidence(data: Dataset, incident: Incident, facility: Facility, system: System, at: number): string[] {
  if (incident.category === 'pump_failure') {
    const flow = read(data, facility.pump.id, 'flow_bpd', at)
    const inflow = read(data, facility.id, 'inflow_bpd', at)
    return [
      'Pump status reports fault (2). A normal off-cycle reports stopped (0).',
      flow === undefined ? 'Pump discharge flow is missing at this timestamp.' : 'Recorded pump discharge is ' + rounded(flow) + ' bbl/day.',
      inflow === undefined ? 'Facility inflow is missing at this timestamp.' : 'Recorded facility inflow is ' + rounded(inflow) + ' bbl/day.',
    ]
  }
  const sampleAt = lastRunning(data, facility, at, incident.detectedAt)
  const flow = read(data, facility.pump.id, 'flow_bpd', sampleAt)
  const receive = read(data, facility.pipeline.id, 'receive_flow_bpd', sampleAt)
  const pressure = read(data, facility.pipeline.id, 'pressure_psi', sampleAt)
  const label = new Date(sampleAt * 1000).toISOString().slice(11, 16) + ' UTC'
  if (incident.category === 'pump_degradation') return [
    'Three successive running samples delivered at least 2.5% less than rated flow.',
    flow === undefined ? 'Running flow sample unavailable.' : label + ' running flow was ' + rounded(flow) + ' bbl/day versus ' + rounded(facility.pump.maxFlowBpd) + ' rated.',
  ]
  return [
    'Three successive running samples showed at least 1.2% flow loss and a 12 psi receiving-pressure deficit.',
    flow === undefined || receive === undefined ? 'Flow sample unavailable.' : label + ' discharge / receive was ' + rounded(flow) + ' / ' + rounded(receive) + ' bbl/day.',
    pressure === undefined ? 'Pressure sample unavailable.' : 'Receiving pressure was ' + rounded(pressure) + ' psi versus ' + rounded(system.disposal.pressurePsi + 50) + ' psi expected while running.',
  ]
}

export function activeAlerts(data: Dataset, incidents: readonly Incident[], at: number): Alert[] {
  return incidents
    .filter((item) => item.detectedAt <= at && (item.clearedAt === null || at < item.clearedAt))
    .map((item) => {
      const facility = data.facilities.get(item.facilityId)!
      const system = data.systems.find((system) => system.id === item.systemId)!
      const levelPct = read(data, facility.tank.id, 'level_pct', at)
      const failed = item.category === 'pump_failure'
      const automatic = failed && levelPct !== undefined && levelPct >= data.shutdownPct - 0.1 &&
        facility.wells.every((well) => read(data, well.id, 'status', at) === 0)
      const water = facility.wells.reduce((sum, well) => sum + well.baselineWaterBpd, 0)
      const minutesToLimit = !failed || levelPct === undefined ? null :
        automatic ? 0 : water === 0 ? null : Math.max(0, data.shutdownPct - levelPct) / 100 * facility.tank.capacityBbl / water * 1440
      return {
        ...item, clearedAt: null,
        evidence: evidence(data, item, facility, system, at),
        levelPct, automatic, minutesToLimit,
        verified: item.category !== 'pipeline_leak' || at - lastRunning(data, facility, at, item.detectedAt) <= 7200,
        repairMinutes: failed ? Math.max(0, data.repairHours * 60 - (at - item.onset) / 60) : null,
        revenuePerHour: facility.wells.reduce((sum, well) => sum + well.revenuePerHour, 0),
      }
    })
    .sort((a, b) => Number(b.category === 'pump_failure') - Number(a.category === 'pump_failure') ||
      (a.minutesToLimit ?? Infinity) - (b.minutesToLimit ?? Infinity) || b.revenuePerHour - a.revenuePerHour)
}
