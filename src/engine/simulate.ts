import type { Alert } from './incidents.ts'
import type { Dataset, Facility, System } from './model.ts'

export interface Failure {
  facility: Facility
  initialBbl: number
  limitBbl: number
  repairMin: number
  alreadyShut: boolean
}

export interface Scenario {
  system: System
  at: number
  failures: Failure[]
  truckBbl: number
  tripCost: number
  oilPrice: number
  gasPrice: number
}
export interface Job { truck: number; facilityId: string; dispatchMin: number; trips: number }
export interface ShutIn { wellId: string; startMin: number }
export interface Plan { jobs: Job[]; shutIns: ShutIn[] }
export const noAction: Plan = { jobs: [], shutIns: [] }

export interface ScheduledJob extends Job { arrivals: number[]; freeMin: number }
export interface Cost { oil: number; gas: number; trucking: number; total: number }
export interface Frame { minute: number; bbl: number; producing: number; automatic: boolean; repaired: boolean }
export interface FacilityResult {
  facilityId: string
  autoAt: number | null
  costs: Cost
  frames: Frame[]
}
export interface Outcome {
  plan: Plan
  facilities: FacilityResult[]
  jobs: ScheduledJob[]
  costs: Cost
  duration: number
}

export function scenarioAt(data: Dataset, alerts: readonly Alert[], systemId: string, at: number): Scenario {
  const system = data.systems.find((system) => system.id === systemId)
  if (!system) throw new Error('Unknown system')
  const failures = alerts.filter((alert) => alert.category === 'pump_failure' && alert.systemId === systemId).map((alert) => {
    const facility = data.facilities.get(alert.facilityId)!
    if (alert.levelPct === undefined || alert.repairMinutes === null) throw new Error('Missing tank or repair reading for ' + facility.id)
    return {
      facility,
      initialBbl: Math.min(facility.tank.capacityBbl, Math.max(0, alert.levelPct / 100 * facility.tank.capacityBbl)),
      limitBbl: data.shutdownPct / 100 * facility.tank.capacityBbl,
      repairMin: alert.repairMinutes,
      alreadyShut: alert.automatic,
    }
  })
  return { system, at, failures, truckBbl: data.truckCapacityBbl, tripCost: data.truckCost, oilPrice: data.prices.oil, gasPrice: data.prices.gas }
}

const epsilon = 1e-8

export function scheduleJob(scenario: Scenario, failure: Failure, job: Job): ScheduledJob {
  const { responseMin, cycleMin } = failure.facility.trucking
  const first = job.dispatchMin + responseMin
  if (!Number.isSafeInteger(job.truck) || job.truck < 1 || job.truck > scenario.system.fleetSize ||
      !Number.isFinite(job.dispatchMin) || job.dispatchMin < 0 || !Number.isSafeInteger(job.trips) || job.trips < 1 ||
      first + (job.trips - 1) * cycleMin >= failure.repairMin - epsilon) {
    throw new Error('Truck jobs must use an available fleet slot and arrive before repair at ' + failure.facility.id)
  }
  const arrivals = Array.from({ length: job.trips }, (_, index) => first + index * cycleMin)
  return { ...job, arrivals, freeMin: first + job.trips * cycleMin }
}

export function runFacility(
  scenario: Scenario, failure: Failure, arrivals: readonly number[], stops: readonly ShutIn[], frames = false,
): FacilityResult | null {
  const { facility, limitBbl, repairMin } = failure
  const stopTimes = new Map(stops.map((stop) => [stop.wellId, stop.startMin]))
  const events = new Map<number, { trips: number; stop: boolean }>()
  const eventAt = (minute: number) => {
    let event = events.get(minute)
    if (!event) { event = { trips: 0, stop: false }; events.set(minute, event) }
    return event
  }
  for (const arrival of arrivals) eventAt(arrival).trips++
  for (const stop of stops) eventAt(stop.startMin).stop = true
  eventAt(0)
  eventAt(repairMin)
  const step = Math.max(5, Math.ceil(repairMin / 10_000) * 5)
  if (frames) for (let minute = step; minute < repairMin; minute += step) eventAt(minute)
  const costs = { oil: 0, gas: 0, trucking: arrivals.length * scenario.tripCost, total: 0 }
  const records: Frame[] = []
  let autoAt = failure.alreadyShut ? 0 : null
  let bbl = failure.initialBbl
  let previous = 0
  let water = 0
  let oil = 0
  let gas = 0
  let producing = facility.wells.length
  const initialRates = () => {
    for (const well of facility.wells) {
      water += well.baselineWaterBpd / 1440
      oil += well.oilBpd * scenario.oilPrice / 1440
      gas += well.gasMcfd * scenario.gasPrice / 1440
    }
  }
  initialRates()
  let oilLoss = 0
  let gasLoss = 0
  for (const minute of [...events.keys()].sort((a, b) => a - b)) {
    const event = events.get(minute)!
    let run = minute - previous
    if (autoAt === null) {
      const untilLimit = bbl >= limitBbl - epsilon ? 0 : water > 0 ? (limitBbl - bbl) / water : Infinity
      if (untilLimit <= run + epsilon && previous + untilLimit < repairMin - epsilon) {
        run = Math.min(run, untilLimit)
        autoAt = previous + run
      }
      bbl = Math.min(limitBbl, bbl + water * run)
      if (frames && autoAt !== null && autoAt < minute) {
        records.push({ minute: autoAt, bbl, producing: 0, automatic: true, repaired: false })
      }
    } else {
      run = 0
    }
    costs.oil += oilLoss * run + oil * (minute - previous - run)
    costs.gas += gasLoss * run + gas * (minute - previous - run)
    if (event.trips) {
      const removal = scenario.truckBbl * event.trips
      if (removal > bbl + epsilon) return null
      if (frames && minute > 0) records.push({ minute, bbl, producing: autoAt === null ? producing : 0, automatic: autoAt !== null, repaired: false })
      bbl = Math.max(0, bbl - removal)
    }
    if (event.stop) {
      producing = 0
      water = oilLoss = gasLoss = 0
      for (const well of facility.wells) {
        if ((stopTimes.get(well.id) ?? Infinity) <= minute) {
          oilLoss += well.oilBpd * scenario.oilPrice / 1440
          gasLoss += well.gasMcfd * scenario.gasPrice / 1440
        } else {
          water += well.baselineWaterBpd / 1440
          producing++
        }
      }
    }
    if (frames) records.push({
      minute, bbl, producing: minute === repairMin ? facility.wells.length : autoAt === null ? producing : 0,
      automatic: autoAt !== null && minute < repairMin, repaired: minute === repairMin,
    })
    previous = minute
  }
  costs.total = costs.oil + costs.gas + costs.trucking
  return { facilityId: facility.id, autoAt, costs, frames: records }
}

export function simulate(scenario: Scenario, plan: Plan): Outcome {
  const failures = new Map(scenario.failures.map((failure) => [failure.facility.id, failure]))
  const repairs = new Map(scenario.failures.flatMap((failure) => failure.facility.wells.map((well) => [well.id, failure.repairMin] as const)))
  const shutWells = new Set<string>()
  for (const stop of plan.shutIns) {
    if (shutWells.has(stop.wellId) || !Number.isFinite(stop.startMin) || stop.startMin < 0 ||
        stop.startMin >= (repairs.get(stop.wellId) ?? 0)) throw new Error('Invalid well shut-in: ' + stop.wellId)
    shutWells.add(stop.wellId)
  }
  const jobs = plan.jobs.map((job) => {
    const failure = failures.get(job.facilityId)
    if (!failure) throw new Error('Truck destination must have an ongoing pump failure')
    return scheduleJob(scenario, failure, job)
  }).sort((a, b) => a.dispatchMin - b.dispatchMin)
  const busy = new Map<number, number>()
  for (const job of jobs) {
    if (job.dispatchMin < (busy.get(job.truck) ?? 0) - epsilon) throw new Error('Truck ' + job.truck + ' is still assigned to another job')
    busy.set(job.truck, job.freeMin)
  }
  const facilities = scenario.failures.map((failure) => {
    const arrivals = jobs.filter((job) => job.facilityId === failure.facility.id).flatMap((job) => job.arrivals)
    const wells = new Set(failure.facility.wells.map((well) => well.id))
    const result = runFacility(scenario, failure, arrivals, plan.shutIns.filter((stop) => wells.has(stop.wellId)), true)
    if (!result) throw new Error('A truck would arrive before there is enough water for a full trip at ' + failure.facility.id)
    return result
  })
  const costs: Cost = { oil: 0, gas: 0, trucking: 0, total: 0 }
  for (const result of facilities) {
    costs.oil += result.costs.oil
    costs.gas += result.costs.gas
    costs.trucking += result.costs.trucking
    costs.total += result.costs.total
  }
  return { plan, jobs, facilities, costs, duration: Math.max(0, ...scenario.failures.map((failure) => failure.repairMin)) }
}

export function frameAt(frames: readonly Frame[], minute: number): Frame | undefined {
  const nextIndex = frames.findIndex((frame) => frame.minute > minute)
  if (nextIndex === -1) return frames.at(-1)
  return frames[Math.max(0, nextIndex - 1)]
}
