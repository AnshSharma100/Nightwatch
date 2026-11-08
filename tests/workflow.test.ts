import assert from 'node:assert/strict'
import { test } from 'node:test'
import { caseKey, isWorkflowUpdate, transition } from '../src/engine/workflow.ts'
import type { Action, Actor, WorkflowCase, WorkflowEntry } from '../src/engine/workflow.ts'

const incident: WorkflowCase = {
  network: 'network-a', assetId: 'pump-a', facilityId: 'facility-a', systemId: 'system-a',
  category: 'pump_failure', onset: 300, observedAt: 900, evidence: ['Fault status recorded'],
}
function act(entry: WorkflowEntry | undefined, actor: Actor, action: Action, note = '', revision = entry?.history.length ?? 0) {
  return transition(entry, { incident, actor, action, note, revision }, 1000)
}

test('a field assignment requires operator review and confirmation', () => {
  assert.throws(() => act(undefined, 'control', 'assign'), /unavailable/)
  const review = act(undefined, 'control', 'review')
  assert.throws(() => act(review, 'foreman', 'confirm'), /unavailable/)
  const confirmed = act(review, 'control', 'confirm')
  assert.equal(confirmed.assignee, null)
  assert.throws(() => act(confirmed, 'control', 'assign', '', 1), /Refresh/)
  const assigned = act(confirmed, 'control', 'assign', 'Inspect the recorded fault.')
  assert.equal(assigned.assignee, 'foreman')
  assert.equal(assigned.history.length, 3)
  assert.throws(() => act(assigned, 'lease', 'acknowledge'), /unavailable/)
  const foreman = act(assigned, 'foreman', 'acknowledge')
  const delegated = act(foreman, 'foreman', 'handoff')
  assert.equal(delegated.assignee, 'lease')
  const started = act(act(delegated, 'lease', 'acknowledge'), 'lease', 'start')
  assert.throws(() => act(started, 'lease', 'resolve'), /resolution note/)
  const resolved = act(started, 'lease', 'resolve', 'Inspection complete.')
  assert.equal(resolved.stage, 'resolved')
  assert.equal(resolved.history.at(-1)?.note, 'Inspection complete.')
})

test('monitor and dismiss preserve the detection and support review again', () => {
  const watched = act(undefined, 'control', 'monitor')
  const dismissed = act(watched, 'control', 'dismiss')
  assert.equal(dismissed.stage, 'dismissed')
  assert.deepEqual(dismissed.incident, incident)
  assert.equal(act(dismissed, 'control', 'review').stage, 'under_review')
  assert.notEqual(caseKey(incident), caseKey({ ...incident, network: 'network-b' }))
  assert.equal(isWorkflowUpdate({ incident, actor: 'control', action: 'review', note: '', revision: 0 }), true)
  assert.equal(isWorkflowUpdate({ incident, actor: 'lease', action: 'approve_everything', note: '', revision: 0 }), false)
})
