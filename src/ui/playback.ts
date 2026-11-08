import type { Frame, Outcome, Scenario, ScheduledJob } from '../../packages/domain/simulate.ts'

export function frameAt(frames: readonly Frame[], minute: number): Frame | undefined {
  let low = 0
  let high = frames.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (frames[mid].minute <= minute) low = mid + 1
    else high = mid
  }
  return frames[Math.max(0, low - 1)]
}

export function truckFraction(job: ScheduledJob, minute: number) {
  const index = job.arrivals.findIndex((arrival) => minute < arrival)
  const first = job.arrivals[0]
  if (minute < first) return (minute - job.dispatchMin) / (first - job.dispatchMin)
  if (index !== -1) {
    const previous = job.arrivals[index - 1]
    return Math.abs(1 - 2 * (minute - previous) / (job.arrivals[index] - previous))
  }
  const last = job.arrivals.at(-1)!
  return 1 - (minute - last) / (job.freeMin - last)
}

export interface ProjectedSite {
  fill: number
  repaired: boolean
  automatic: boolean
  stoppedWells: ReadonlySet<string>
}
export interface ProjectedNetwork {
  systemId: string
  sites: ReadonlyMap<string, ProjectedSite>
  trucks: { slot: number; facilityId: string; fraction: number; returning: boolean }[]
}

export function projectNetwork(scenario: Scenario, outcome: Outcome, minute: number): ProjectedNetwork {
  const sites = new Map<string, ProjectedSite>()
  for (const result of outcome.facilities) {
    const frame = frameAt(result.frames, minute)
    const facility = scenario.failures.find((failure) => failure.facility.id === result.facilityId)?.facility
    if (!frame || !facility) continue
    const stopped = frame.repaired ? [] : frame.automatic ? facility.wells.map((well) => well.id) :
      outcome.plan.shutIns.filter((stop) => stop.startMin <= minute && facility.wells.some((well) => well.id === stop.wellId))
        .map((stop) => stop.wellId)
    sites.set(facility.id, { fill: frame.bbl / facility.tank.capacityBbl * 100, repaired: frame.repaired,
      automatic: frame.automatic, stoppedWells: new Set(stopped) })
  }
  const trucks = outcome.jobs.filter((job) => job.dispatchMin <= minute && minute < job.freeMin).map((job) => {
    const fraction = truckFraction(job, minute)
    return { slot: job.truck, facilityId: job.facilityId, fraction, returning: truckFraction(job, minute + .001) < fraction }
  })
  return { systemId: scenario.system.id, sites, trucks }
}
