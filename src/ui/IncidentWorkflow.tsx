import { useState } from 'react'
import { BadgeCheck, ClipboardList } from 'lucide-react'
import { actionLabel, assigneeName, availableActions, stageLabel } from '../engine/workflow.ts'
import type { Action, Actor, WorkflowCase, WorkflowEntry, WorkflowUpdate } from '../engine/workflow.ts'
import { stamp } from './format.ts'

export function WorkflowActions({ actor, incident, entry, onUpdate }: {
  actor: Actor; incident: WorkflowCase; entry?: WorkflowEntry; onUpdate: (change: WorkflowUpdate) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const actions = availableActions(entry, actor)
  if (!actions.length) return null

  async function submit(action: Action) {
    setPending(true)
    setError('')
    try {
      await onUpdate({ actor, action, incident, revision: entry?.history.length ?? 0, note })
      setNote('')
    } catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }

  return <div className="workflow-actions">
    {(actor !== 'control' || entry?.stage === 'confirmed') && <label>Work note{actions.includes('resolve') ? ' · required to resolve' : ' · optional'}
      <textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>}
    <div>{actions.map((action, index) => <button key={action} className={index === 0 ? 'primary-btn' : 'small-btn'} disabled={pending || (action === 'resolve' && !note.trim())}
      onClick={() => void submit(action)}>{actionLabel[action]}</button>)}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>
}

export function WorkflowHistory({ entry }: { entry: WorkflowEntry }) {
  return <details className="workflow-history"><summary>Workflow history · {entry.history.length}</summary>
    <ol>{entry.history.map((event, index) => <li key={index}><strong>{actionLabel[event.action]}</strong>
      <span>{assigneeName(event.actor, entry.incident)} · {stamp(event.at / 1000)}</span>{event.note && <p>{event.note}</p>}</li>)}</ol>
  </details>
}

export function IncidentWorkflow({ incident, entry, available, editable, onUpdate }: {
  incident: WorkflowCase; entry?: WorkflowEntry; available: boolean | null; editable: boolean; onUpdate: (change: WorkflowUpdate) => Promise<void>
}) {
  return <details className="inspector-fold workflow-fold">
    <summary><ClipboardList size={15} /> Incident workflow <span className="tag">{stageLabel[entry?.stage ?? 'detected']}</span></summary>
    <div className="inspector-section">
      {entry?.assignee && <p><BadgeCheck size={14} /> {assigneeName(entry.assignee, incident)}</p>}
      {editable && available ? <WorkflowActions actor="control" incident={incident} entry={entry} onUpdate={onUpdate} /> :
        <p>{!editable ? 'Review and assignment are available at the latest recording.' : available === false ? 'Workflow server unavailable.' : 'Connecting to the workflow server…'}</p>}
      {entry && <WorkflowHistory entry={entry} />}
    </div>
  </details>
}
