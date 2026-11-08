import { noAction, runFacility, scheduleJob, simulate } from './simulate.ts'
import type { Failure, Outcome, Plan, Scenario, ScheduledJob, ShutIn } from './simulate.ts'
import type { Well } from './model.ts'

interface Candidate { plan: Plan; cost: number }
interface LocalPlan { cost: number; shutIns: ShutIn[] }

function wellGroups(wells: Well[]) {
  if (wells.length <= 7) {
    return wells.reduce<Well[][]>((sets, well) => [...sets, ...sets.map((set) => [...set, well])], [[]]).slice(1)
  }
  const ranked = [...wells].sort((a, b) =>
    a.revenuePerHour / (a.baselineWaterBpd || Number.EPSILON) -
    b.revenuePerHour / (b.baselineWaterBpd || Number.EPSILON))
  return [...wells.map((well) => [well]), ...ranked.slice(1).map((_, index) => ranked.slice(0, index + 2))]
}

function bestLocal(scenario: Scenario, failure: Failure, arrivals: number[], groups: Well[][]): LocalPlan | null {
  const untreated = runFacility(scenario, failure, arrivals, [])
  if (!untreated) return null
  const best: LocalPlan = { cost: untreated.costs.total, shutIns: [] }
  if (untreated.autoAt === null || failure.alreadyShut) return best
  for (const group of groups) {
    const hourly = group.reduce((total, well) => total + well.revenuePerHour, 0)
    for (let minute = Math.floor((untreated.autoAt - 1e-7) / 5) * 5; minute >= 0; minute -= 5) {
      if (hourly * (failure.repairMin - minute) / 60 + untreated.costs.trucking >= best.cost - 1e-7) break
      const shutIns = group.map((well) => ({ wellId: well.id, startMin: minute }))
      const trial = runFacility(scenario, failure, arrivals, shutIns)
      if (trial && trial.costs.total < best.cost - 1e-7) {
        best.cost = trial.costs.total
        best.shutIns = shutIns
      }
      if (trial?.autoAt === null) break
    }
  }
  return best
}

export interface Optimization {
  baseline: Outcome
  best: Outcome
  alternative: Outcome | null
  evaluated: number
  limited: boolean
}

export function optimize(scenario: Scenario): Optimization {
  const baseline = simulate(scenario, noAction)
  const ranked: Candidate[] = [{ plan: noAction, cost: baseline.costs.total }]
  const candidates = new Set<string>([JSON.stringify(noAction)])
  const cache = new Map<string, LocalPlan | null>()
  const failures = scenario.failures.filter((failure) => !failure.alreadyShut && failure.repairMin > 0)
  const groups = new Map(scenario.failures.map((failure) => [failure.facility.id, wellGroups(failure.facility.wells)]))
  let evaluated = 0
  let limited = false

  function consider(jobs: ScheduledJob[]) {
    evaluated++
    const plan: Plan = { jobs: jobs.map(({ truck, facilityId, dispatchMin, trips }) => ({ truck, facilityId, dispatchMin, trips })), shutIns: [] }
    let cost = 0
    for (const failure of scenario.failures) {
      const arrivals = jobs.filter((job) => job.facilityId === failure.facility.id).flatMap((job) => job.arrivals).sort((a, b) => a - b)
      const key = JSON.stringify([failure.facility.id, arrivals])
      if (!cache.has(key)) cache.set(key, bestLocal(scenario, failure, arrivals, groups.get(failure.facility.id)!))
      const local = cache.get(key)
      if (!local) return
      cost += local.cost
      plan.shutIns.push(...local.shutIns)
    }
    const assignments = plan.jobs.map(({ facilityId, dispatchMin, trips }) => JSON.stringify([facilityId, dispatchMin, trips])).sort()
    const key = plan.jobs.length || plan.shutIns.length ? JSON.stringify([assignments, plan.shutIns]) : JSON.stringify(noAction)
    if (candidates.has(key)) return
    candidates.add(key)
    ranked.push({ plan, cost })
    ranked.sort((a, b) => a.cost - b.cost || a.plan.jobs.length - b.plan.jobs.length)
    if (ranked.length > 2) ranked.pop()
  }

  const budget = 1800
  const horizon = Math.max(0, ...failures.map((failure) => failure.repairMin))
  const shortestCycle = Math.min(...failures.map((failure) => failure.facility.trucking.cycleMin))
  const usefulFleet = Math.min(scenario.system.fleetSize, failures.length * Math.ceil(horizon / shortestCycle) + failures.length)
  const queue: { jobs: ScheduledJob[]; available: number[]; dispatchFloor: number; truckFloor: number }[] = [
    { jobs: [], available: Array(Math.min(usefulFleet, 24)).fill(0), dispatchFloor: 0, truckFloor: 0 },
  ]
  limited = usefulFleet > 24
  for (let index = 0; index < queue.length && index < budget; index++) {
    const { jobs, available, dispatchFloor, truckFloor } = queue[index]
    consider(jobs)
    if (jobs.reduce((sum, job) => sum + job.trips, 0) * scenario.tripCost >= ranked[0].cost - 1e-7) continue
    const seenSlots = new Set<number>()
    for (let slot = 0; slot < available.length; slot++) {
      const dispatchMin = available[slot]
      if (dispatchMin < dispatchFloor || (dispatchMin === dispatchFloor && slot < truckFloor) || seenSlots.has(dispatchMin)) continue
      seenSlots.add(dispatchMin)
      for (const failure of failures) {
        const { responseMin, cycleMin } = failure.facility.trucking
        for (let trips = 1; dispatchMin + responseMin + (trips - 1) * cycleMin < failure.repairMin - 1e-8; trips++) {
          if (queue.length >= budget) { limited = true; break }
          const job = scheduleJob(scenario, failure, { truck: slot + 1, facilityId: failure.facility.id, dispatchMin, trips })
          const free = [...available]
          free[slot] = job.freeMin
          queue.push({ jobs: [...jobs, job], available: free, dispatchFloor: dispatchMin, truckFloor: slot })
        }
      }
    }
  }
  return {
    baseline, best: simulate(scenario, ranked[0].plan), alternative: ranked[1] ? simulate(scenario, ranked[1].plan) : null,
    evaluated, limited: limited || scenario.failures.some((failure) => failure.facility.wells.length > 7),
  }
}
