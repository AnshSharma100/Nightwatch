import type { AuditEntry, PlanSummary } from './investigate.ts'

const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)

function planFacts(label: string, plan?: PlanSummary): string[] {
  if (!plan) return []
  const facts = [
    `${label}: ${dollars(plan.costs_usd.total)} estimated total — ${dollars(plan.costs_usd.trucking)} trucking and ${dollars(plan.costs_usd.oil + plan.costs_usd.gas)} lost oil/gas revenue.`,
    ...plan.trucks.map((job) => `${label}: truck ${job.truck} makes ${job.trips} trip(s) to ${job.facilityId}, leaving at minute ${number(job.dispatchMin)}, arriving at minute(s) ${job.arrivals.map(number).join(', ')}, and becoming available again at minute ${number(job.freeMin)} after the selected recording.`),
    ...plan.well_shut_ins.map((stop) => `${label}: selectively shut in ${stop.wellId} at minute ${number(stop.startMin)} after the selected recording.`),
    ...plan.facilities.map((site) => site.auto_shut_in_after_min === null
      ? `${label}: ${site.facility_id} avoids automatic shut-in through its simulated repair horizon.`
      : `${label}: ${site.facility_id} ${site.auto_shut_in_after_min === 0 ? 'is already automatically shut in at the decision time' : 'automatically shuts in after ' + number(site.auto_shut_in_after_min) + ' minutes'}; projected lost production revenue is ${dollars(site.costs_usd.oil + site.costs_usd.gas)}.`),
  ]
  if (!plan.facilities.length) facts.push(`${label}: no active pump failures with sufficient readings are included in this simulation; inspection incidents are not assigned pump-failure savings.`)
  return facts
}

/** Complete statements, not interchangeable numbers: a citation cannot turn a
 * baseline cost into a recommendation or swap the destination of a truck. */
export function toolFacts(entry: AuditEntry): string[] {
  if (!entry.ok) return []
  const result = entry.result
  switch (entry.name) {
    case 'get_incidents': {
      const value = result as { system_id: string; incidents: { asset_id: string; category: string; evidence: string[] }[] }
      return value.incidents.length ? value.incidents.map((incident) =>
        `${incident.asset_id}: recorded ${incident.category.replaceAll('_', ' ')}. ${incident.evidence.join(' ')}`
      ) : [`No active incidents were detected in ${value.system_id} at the selected recording.`]
    }
    case 'forecast_shutdown':
      return (result as { facility_id: string; measured_fill_pct?: number; shutdown_limit_pct: number; minutes_to_limit_if_rate_holds: number | null; minutes_to_repair: number | null; already_shut_in: boolean }[]).map((site) =>
        `${site.facility_id}: recorded tank fill ${site.measured_fill_pct == null ? 'unavailable' : number(site.measured_fill_pct) + '%'}, automatic shut-in threshold ${number(site.shutdown_limit_pct)}%. ${site.already_shut_in ? 'Wells are already automatically shut in.' : site.minutes_to_limit_if_rate_holds == null || !Number.isFinite(site.minutes_to_limit_if_rate_holds) ? 'A tank-limit countdown is unavailable.' : 'Without intervention, the tank reaches the threshold in ' + number(site.minutes_to_limit_if_rate_holds) + ' minutes if the observed rate holds.'} Remaining repair time ${site.minutes_to_repair == null ? 'unavailable' : number(site.minutes_to_repair) + ' minutes'}.`)
    case 'inspect_fleet': {
      const value = result as { available_at_decision: number; truck_capacity_bbl: number; cost_per_trip_usd: number; actual_dispatches: string }
      return [`The system has ${value.available_at_decision} shared trucks, each carrying ${number(value.truck_capacity_bbl)} bbl per trip at ${dollars(value.cost_per_trip_usd)} per trip. ${value.actual_dispatches}`]
    }
    case 'compare_plans': {
      const value = result as { baseline: PlanSummary; manual: PlanSummary; recommended: PlanSummary; alternative?: PlanSummary }
      const facts = [...planFacts('No action', value.baseline), ...planFacts('Recommended plan (lowest cost found)', value.recommended),
        ...(JSON.stringify(value.manual) === JSON.stringify(value.baseline) ? [] : planFacts('Current manual plan', value.manual)), ...planFacts('Proposed alternative', value.alternative)]
      facts.push(`The recommended plan reduces estimated cost by ${dollars(value.baseline.costs_usd.total - value.recommended.costs_usd.total)} compared with no action.`)
      if (value.alternative) {
        const difference = value.alternative.costs_usd.total - value.recommended.costs_usd.total
        facts.push(`The proposed alternative costs ${dollars(Math.abs(difference))} ${difference < 0 ? 'less' : 'more'} than the recommended plan in the same simulation.`)
        const protectedSites = value.alternative.facilities.filter((site) => site.auto_shut_in_after_min === null && value.recommended.facilities.some((other) => other.facility_id === site.facility_id && other.auto_shut_in_after_min !== null)).map((site) => site.facility_id)
        const lostSites = value.alternative.facilities.filter((site) => site.auto_shut_in_after_min !== null && value.recommended.facilities.some((other) => other.facility_id === site.facility_id && other.auto_shut_in_after_min === null)).map((site) => site.facility_id)
        facts.push(`Compared with the recommended plan, the proposed alternative ${protectedSites.length ? 'prevents automatic shut-in at ' + protectedSites.join(', ') : 'does not prevent automatic shut-in at any additional facility'}${lostSites.length ? ', but allows automatic shut-in at ' + lostSites.join(', ') : ', with no additional facility automatically shutting in'}. These are simulated outcomes through repair, not actions already taken.`)
      }
      return facts
    }
    case 'simulate_alternative': {
      const value = result as { alternative_id: string; outcome: PlanSummary }
      return planFacts('Proposed alternative', value.outcome)
    }
    case 'optimize_interventions': {
      const value = result as { schedules_evaluated: number; search_limited: boolean; best_found: PlanSummary }
      return [`The optimizer evaluated ${value.schedules_evaluated} schedules${value.search_limited ? ' and reached its search limit' : ' within its candidate search'}. This is the lowest cost found, not a proof of a global optimum.`, ...planFacts('Best plan found by optimizer', value.best_found)]
    }
    case 'get_equipment': {
      const value = result as { asset: { id: string }; recorded: Record<string, number | null> }
      return Object.entries(value.recorded).map(([metric, reading]) => `${value.asset.id} recorded ${metric}: ${reading == null ? 'unavailable' : number(reading)}.`)
    }
    case 'get_sensor_window': {
      const input = JSON.parse(entry.input) as { asset_id: string; metric: string }
      const values = result as { timestamp: string; value: number }[]
      if (!values.length) return [`No recorded ${input.metric} samples are available for ${input.asset_id} in the requested window.`]
      return [`${input.asset_id} ${input.metric}: ${values.length} recorded samples from ${values[0].timestamp} to ${values.at(-1)!.timestamp}, ranging from ${number(Math.min(...values.map((p) => p.value)))} to ${number(Math.max(...values.map((p) => p.value)))}; latest value ${number(values.at(-1)!.value)}.`]
    }
    case 'draft_briefing': {
      const value = result as { instructions: string[]; incidents: { assetId: string; evidence: string[] }[]; recommended: PlanSummary }
      return [...value.instructions, ...value.incidents.flatMap((incident) => incident.evidence.map((evidence) => `${incident.assetId}: ${evidence}`)), ...planFacts('Proposed response for operator review', value.recommended), 'This is a draft for operator review. No assignment has been sent and no physical equipment has been operated.']
    }
    default: return []
  }
}

export function resolveEvidence(prose: string, facts: Map<string, string>, assetIds: string[]) {
  const references = [...prose.matchAll(/\[\[(F\d+)\]\]/g)]
  if (!references.length) throw new Error('Cite relevant answer_facts using [[F1]] references to support the answer.')
  if (references.some((match) => !facts.has(match[1]))) throw new Error('Use only fact IDs returned by successful tools in this investigation.')
  const explanation = prose.replace(/\[\[F\d+\]\]/g, '').replace(/^[ \t]*\d+[.)][ \t]+/gm, '• ')
  const withoutIds = [...assetIds].sort((a, b) => b.length - a.length).reduce((value, id) => value.replaceAll(id, ''), explanation)
  if (/[\p{N}$€£]|\[\[/u.test(withoutIds) || /\b(?:shut(?:s|ting)?[\s\u2010-\u2014-]*(?:in|down)s?|stop(?:s|ping)? production|wells? (?:stop|restart|continue))\b/i.test(withoutIds)) {
    throw new Error('Use complete answer_facts references for quantities, costs, truck schedules and shutdown outcomes; explain the practical reasoning in your own words around those facts.')
  }
  return prose.replace(/\[\[(F\d+)\]\]/g, (_match, id: string) => facts.get(id)!)
}
