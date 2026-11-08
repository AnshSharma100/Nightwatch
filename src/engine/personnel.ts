import type { Actor, WorkflowCase } from './workflow.ts'

export interface Person {
  id: string
  role: Actor
  name: string
  network?: string
  systemId?: string
  facilityId?: string
}

export const controlPerson: Person = { id: 'demo-control', role: 'control', name: 'Demo control-room operator' }

export function personFor(incident: WorkflowCase, role: 'foreman' | 'lease'): Person {
  const { network, systemId, facilityId } = incident
  return {
    id: JSON.stringify(role === 'foreman' ? [role, network, systemId] : [role, network, systemId, facilityId]),
    role, network, systemId, facilityId: role === 'lease' ? facilityId : undefined,
    name: role === 'foreman' ? 'Demo foreman · ' + systemId : 'Demo lease operator · ' + facilityId,
  }
}

export function withinScope(person: Person, incident: WorkflowCase) {
  return person.role === 'control' || (person.network === incident.network && person.systemId === incident.systemId &&
    (person.role === 'foreman' || person.facilityId === incident.facilityId))
}

export type PushStatus = 'queued' | 'requested' | 'accepted' | 'failed' | 'no_subscription' | 'disabled' | 'superseded'

export interface DeliveryView { status: PushStatus; at: number; accepted: number; failed: number }
export interface Assignment {
  id: string
  recipient: Person
  assignedAt: number
  briefing: string
  response: string
  delivery?: DeliveryView
}

export const deliveryLabel: Record<PushStatus, string> = {
  queued: 'Push queued', requested: 'Push requested · acceptance unconfirmed', accepted: 'Accepted by push service',
  failed: 'Push failed', no_subscription: 'Inbox only · no subscribed device', disabled: 'Inbox only · push not configured',
  superseded: 'Push cancelled · assignment changed',
}
