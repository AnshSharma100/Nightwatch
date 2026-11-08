import type { Alert } from './incidents.ts'
import type { Facility } from './model.ts'
import type { Outcome } from './simulate.ts'

export function fieldResponse(alert: Alert, facility: Facility, outcome?: Outcome) {
  if (alert.category === 'pipeline_leak') return 'Inspect the pipeline for a leak and report findings.'
  if (alert.category === 'pump_degradation') return 'Inspect the pump for degradation and report findings.'
  const jobs = outcome?.jobs.filter((job) => job.facilityId === facility.id) ?? []
  const stops = outcome?.plan.shutIns.filter((stop) => facility.wells.some((well) => well.id === stop.wellId)) ?? []
  const actions = [
    ...jobs.map((job) => 'Truck ' + job.truck + ', ' + job.trips + ' trip(s), first arrival after ' + job.arrivals[0] + ' min'),
    ...stops.map((stop) => 'Shut in ' + stop.wellId + ' after ' + stop.startMin + ' min'),
  ]
  return 'Inspect the failed pump and coordinate with control.' + (actions.length ?
    ' Approved simulation · ' + actions.join('. ') + '.' : ' Monitor the facility through repair.')
}
