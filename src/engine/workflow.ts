import type { Category, Alert } from './incidents.ts'
import type { Dataset } from './model.ts'

export type Actor = 'control' | 'foreman' | 'lease'
export type Stage = 'detected' | 'under_review' | 'monitoring' | 'dismissed' | 'confirmed' | 'assigned' | 'acknowledged' | 'in_progress' | 'resolved'
export type Action = 'review' | 'monitor' | 'dismiss' | 'confirm' | 'assign' | 'acknowledge' | 'start' | 'handoff' | 'resolve'

export interface WorkflowCase {
  network: string
  assetId: string
  facilityId: string
  systemId: string
  category: Category
  onset: number
  observedAt: number
  evidence: string[]
}

export interface WorkflowEvent { action: Action; actor: Actor; at: number; note: string }
export interface WorkflowEntry {
  incident: WorkflowCase
  stage: Stage
  assignee: Exclude<Actor, 'control'> | null
  history: WorkflowEvent[]
}
export interface WorkflowUpdate {
  incident: WorkflowCase
  actor: Actor
  action: Action
  revision: number
  note: string
}

export function caseKey(incident: WorkflowCase) {
  return JSON.stringify([incident.network, incident.systemId, incident.facilityId, incident.assetId, incident.category, incident.onset])
}

export function caseFromAlert(data: Dataset, alert: Alert, observedAt: number): WorkflowCase {
  return {
    network: data.networkKey, assetId: alert.assetId, facilityId: alert.facilityId, systemId: alert.systemId,
    category: alert.category, onset: alert.onset, observedAt, evidence: alert.evidence,
  }
}

export const stageLabel: Record<Stage, string> = {
  detected: 'Detected', under_review: 'Under review', monitoring: 'Monitoring', dismissed: 'Dismissed',
  confirmed: 'Confirmed', assigned: 'Assigned', acknowledged: 'Acknowledged', in_progress: 'In progress', resolved: 'Resolved',
}

export const actionLabel: Record<Action, string> = {
  review: 'Begin review', monitor: 'Keep monitoring', dismiss: 'Dismiss', confirm: 'Confirm incident',
  assign: 'Assign to foreman', acknowledge: 'Acknowledge', start: 'Start work', handoff: 'Assign to lease operator', resolve: 'Mark resolved',
}

export function assigneeName(actor: Actor, incident: WorkflowCase) {
  return actor === 'control' ? 'Control room' : actor === 'foreman' ? incident.systemId + ' · System foreman' : incident.facilityId + ' · Lease operator'
}

export function availableActions(entry: WorkflowEntry | undefined, actor: Actor): Action[] {
  const stage = entry?.stage ?? 'detected'
  if (actor === 'control') {
    switch (stage) {
      case 'detected': return ['review', 'monitor', 'dismiss']
      case 'under_review': return ['confirm', 'monitor', 'dismiss']
      case 'monitoring': return ['review', 'dismiss']
      case 'dismissed': return ['review']
      case 'confirmed': return ['assign']
      default: return []
    }
  }
  if (entry?.assignee !== actor) return []
  if (stage === 'assigned') return ['acknowledge']
  if (stage === 'acknowledged') return actor === 'foreman' ? ['start', 'handoff'] : ['start']
  if (stage === 'in_progress') return actor === 'foreman' ? ['resolve', 'handoff'] : ['resolve']
  return []
}

const destination: Record<Action, Stage> = {
  review: 'under_review', monitor: 'monitoring', dismiss: 'dismissed', confirm: 'confirmed',
  assign: 'assigned', acknowledge: 'acknowledged', start: 'in_progress', handoff: 'assigned', resolve: 'resolved',
}

export function transition(entry: WorkflowEntry | undefined, update: WorkflowUpdate, at: number): WorkflowEntry {
  if ((entry?.history.length ?? 0) !== update.revision) throw new Error('This incident changed. Refresh and review its current state.')
  if (!availableActions(entry, update.actor).includes(update.action)) throw new Error('This action is unavailable in the current incident state.')
  if (update.action === 'resolve' && !update.note.trim()) throw new Error('Enter a brief resolution note.')
  const assignee = update.action === 'assign' ? 'foreman' : update.action === 'handoff' ? 'lease' : entry?.assignee ?? null
  return {
    incident: entry?.incident ?? update.incident, stage: destination[update.action], assignee,
    history: [...(entry?.history ?? []), { action: update.action, actor: update.actor, at, note: update.note.trim() }],
  }
}

export function isWorkflowUpdate(value: unknown): value is WorkflowUpdate {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<WorkflowUpdate>
  const incident = row.incident
  const id = (text: unknown) => typeof text === 'string' && text.trim().length > 0 && text.length <= 512
  return Boolean(incident && id(incident.network) && id(incident.assetId) && id(incident.systemId) && id(incident.facilityId) &&
    ['pump_failure', 'pipeline_leak', 'pump_degradation'].includes(incident.category) &&
    Number.isSafeInteger(incident.onset) && Number.isSafeInteger(incident.observedAt) && incident.observedAt >= incident.onset &&
    Array.isArray(incident.evidence) && incident.evidence.length <= 8 && incident.evidence.every(id) &&
    ['control', 'foreman', 'lease'].includes(row.actor ?? '') && typeof row.action === 'string' && Object.hasOwn(destination, row.action) &&
    Number.isSafeInteger(row.revision) && (row.revision ?? -1) >= 0 && typeof row.note === 'string' && row.note.length <= 500)
}
