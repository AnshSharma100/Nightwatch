import type { Alert } from '../packages/domain/incidents.ts'
import type { Dataset } from '../packages/domain/model.ts'
import type { ApprovalPlan } from '../packages/domain/workflow.ts'
import { fieldResponse } from '../packages/domain/field-response.ts'
import { isPlan } from '../packages/contracts/operations.ts'
import { scenarioAt, simulate } from '../packages/domain/simulate.ts'
import { optimize } from '../packages/domain/optimize.ts'

/** Recalculate from session-owned evidence. Never accept client costs or instructions as calculated facts. */
export function prepareApproval(data: Dataset, alerts: Alert[], alert: Alert, selected?: ApprovalPlan) {
  const failures = alerts.filter((item) => item.category === 'pump_failure' && item.systemId === alert.systemId)
  const canCompare = alert.category === 'pump_failure' && failures.every((item) => item.levelPct !== undefined)
  if (selected && (!canCompare || selected.network !== data.networkKey || selected.at !== data.now ||
      selected.systemId !== alert.systemId || !isPlan(selected.plan))) {
    throw new Error('This plan belongs to a different recording or system. Reopen Butterfly Effect at the latest recording and simulate again.')
  }
  const scenario = canCompare ? scenarioAt(data, failures, alert.systemId, data.now) : undefined
  const outcome = scenario ? selected ? simulate(scenario, selected.plan) : optimize(scenario).best : undefined
  const approvalPlan: ApprovalPlan | undefined = selected && outcome ? {
    network: data.networkKey, at: data.now, systemId: alert.systemId,
    plan: { jobs: outcome.plan.jobs.map(({ truck, facilityId, dispatchMin, trips }) => ({ truck, facilityId, dispatchMin, trips })),
      shutIns: outcome.plan.shutIns.map(({ wellId, startMin }) => ({ wellId, startMin })) },
  } : undefined
  return { response: (approvalPlan ? 'Selected Butterfly plan. ' : '') + fieldResponse(alert, data.facilities.get(alert.facilityId)!, outcome), approvalPlan }
}
