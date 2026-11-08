import { useState } from 'react'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import { assigneeName, caseKey, stageLabel } from '../engine/workflow.ts'
import type { Actor } from '../engine/workflow.ts'
import { WorkflowActions, WorkflowHistory } from './IncidentWorkflow.tsx'
import { useWorkflow } from './useWorkflow.ts'
import { stamp, titleFor } from './format.ts'
import './workspace.css'

export function FieldDesk() {
  const [role, setRole] = useState<Exclude<Actor, 'control'>>('foreman')
  const { entries, available, update } = useWorkflow()
  const assignments = entries.filter((entry) => entry.assignee === role)
  return <div className="field-shell">
    <header><div><ClipboardList size={21} /><h1>Field desk</h1></div><a className="soft-btn" href={import.meta.env.BASE_URL}><ArrowLeft size={15} /> Control room</a></header>
    <main>
      <div className="field-intro"><p>Approved assignments · Synthetic personnel</p>
        <label>View as<select value={role} onChange={(event) => setRole(event.target.value as Exclude<Actor, 'control'>)}><option value="foreman">System foreman</option><option value="lease">Facility lease operator</option></select></label></div>
      {available === false && <p className="notice error-notice" role="alert">Workflow server unavailable.</p>}
      {available === true && assignments.length === 0 && <p className="field-empty">No approved assignments for this role.</p>}
      {assignments.map((entry) => <article className="field-assignment" key={caseKey(entry.incident)}>
        <header><div><p>{titleFor[entry.incident.category]}</p><h2>{entry.incident.assetId}</h2></div><span className="tag">{stageLabel[entry.stage]}</span></header>
        <p>{assigneeName(role, entry.incident)}</p>
        <p>Recorded evidence from {stamp(entry.incident.observedAt)}</p>
        <ul>{entry.incident.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
        {entry.history.findLast((event) => event.note && (event.action === 'assign' || event.action === 'handoff'))?.note && <p className="field-note">Briefing · {entry.history.findLast((event) => event.note && (event.action === 'assign' || event.action === 'handoff'))?.note}</p>}
        <WorkflowActions key={role + entry.history.length} actor={role} incident={entry.incident} entry={entry} onUpdate={update} />
        <WorkflowHistory entry={entry} />
      </article>)}
    </main>
  </div>
}
