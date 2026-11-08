import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, ClipboardList } from 'lucide-react'
import { stageLabel } from '../engine/workflow.ts'
import type { WorkflowEntry } from '../engine/workflow.ts'
import { SignIn, WorkflowActions, WorkflowHistory } from './IncidentWorkflow.tsx'
import { useWorkflow } from './useWorkflow.ts'
import { duration, stamp, titleFor } from './format.ts'
import { FieldPush } from './FieldPush.tsx'
import './workspace.css'
import './field.css'

const fieldUrl = '/field'

function urgent(entry: WorkflowEntry) {
  const { category, forecastMin, repairMin, automatic } = entry.incident
  return category === 'pipeline_leak' || (category === 'pump_failure' &&
    (automatic || (forecastMin != null && repairMin != null && forecastMin < repairMin)))
}

function AssignmentCard({ entry }: { entry: WorkflowEntry }) {
  const assignment = entry.assignment!
  return <a className="field-job" href={fieldUrl + '/assignments/' + assignment.id}>
    <div className="field-job-head"><span>{entry.incident.facilityId}</span><span className="tag">{stageLabel[entry.stage]}</span></div>
    <h3>{titleFor[entry.incident.category]}{urgent(entry) && entry.stage !== 'resolved' && <span className="field-urgent">Urgent</span>}</h3>
    <p>{assignment.response}</p><footer><span>{stamp(assignment.assignedAt / 1000)}</span><ArrowUpRight size={17} /></footer>
  </a>
}

function AssignmentDetails({ entry, workflow }: { entry: WorkflowEntry; workflow: ReturnType<typeof useWorkflow> }) {
  const { incident, assignment } = entry
  if (!assignment) return null
  const confirmation = entry.history.findLast((event) => event.action === 'confirm')
  return <article className="field-detail">
    <a className="field-back" href={fieldUrl}><ArrowLeft size={17} /> My assignments</a>
    <div className="field-detail-head"><div><p>{incident.facilityId}</p><h2>{titleFor[incident.category]}</h2></div><span className="tag">{stageLabel[entry.stage]}</span></div>
    <p className="field-assignee">{assignment.recipient.name} · Assigned {stamp(assignment.assignedAt / 1000)}</p>
    <section className="field-instructions"><h3>Approved response</h3><p>{assignment.response}</p>
      {assignment.briefing && <><h3>Field instructions</h3><p>{assignment.briefing}</p></>}</section>
    {workflow.person?.role !== 'control' && workflow.person?.id === assignment.recipient.id &&
      <WorkflowActions actor={workflow.person.role} incident={incident} entry={entry} onUpdate={workflow.update} />}
    <section className="field-facts">
      <h3>Confirmed incident</h3>
      {confirmation && <p>{confirmation.person?.name ?? 'Control room'} · {stamp(confirmation.at / 1000)}</p>}
      {confirmation?.note && <p>{confirmation.note}</p>}
      {incident.category === 'pump_failure' && <p>{incident.automatic ? 'Wells were already shut in at the recorded timestamp.' :
        incident.forecastMin != null ? 'Forecast at assignment review · ' + duration(incident.forecastMin) + ' to shut-in threshold.' : 'Shutdown forecast was unavailable.'}</p>}
      <details><summary>Equipment and recorded evidence</summary>
        <p>Equipment ID · <strong>{incident.assetId}</strong></p>
        <p>Recorded snapshot · {stamp(incident.observedAt)}</p>
        <ul>{[...incident.evidence, ...(incident.readings ?? [])].map((item, index) => <li key={index}>{item}</li>)}</ul>
      </details>
      <WorkflowHistory entry={entry} />
    </section>
  </article>
}

export function FieldDesk({ assignmentId }: { assignmentId?: string }) {
  const workflow = useWorkflow(assignmentId)
  const [signOutError, setSignOutError] = useState('')
  const { entries, person, available, loadError } = workflow
  const assigned = entries.filter((entry) => entry.assignment).sort((a, b) =>
    Number(urgent(b)) - Number(urgent(a)) || b.assignment!.assignedAt - a.assignment!.assignedAt)
  const groups = [
    { label: 'New', entries: assigned.filter((entry) => entry.stage === 'assigned') },
    { label: 'Acknowledged and in progress', entries: assigned.filter((entry) => entry.stage === 'acknowledged' || entry.stage === 'in_progress') },
    { label: 'Completed', entries: assigned.filter((entry) => entry.stage === 'resolved') },
  ]

  useEffect(() => {
    document.title = 'NIGHTWATCH Field'
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = '/field.webmanifest'
    document.head.append(link)
    if ('serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register('/field-sw.js', { scope: '/field' }).catch(() => {})
    }
    return () => link.remove()
  }, [])

  return <div className="field-shell nightwatch-field">
    <header><div><ClipboardList size={22} /><h1>NIGHTWATCH Field</h1></div>
      {person ? <button className="soft-btn" onClick={() => void workflow.signOut().catch((error) => setSignOutError(error.message))}>Sign out</button> :
        <a className="soft-btn" href="/"><ArrowLeft size={15} /> Control room</a>}</header>
    <main>
      {signOutError && <p className="form-error" role="alert">{signOutError}</p>}
      {!person ? <section className="field-welcome"><h2>{assignmentId ? 'Sign in to open this assignment' : 'Field sign-in'}</h2>
        <p>Use the one-time code from the control room. Accounts represent synthetic demo personnel.</p>
        <SignIn label="Field sign-in code" configured={workflow.configured} onSignIn={workflow.signIn} />
        {available === false && <p role="alert">The workflow server is unavailable.</p>}</section> : person.role === 'control' ?
        <p className="field-empty">Sign out of the control room and enter a field sign-in code on this device.</p> :
        <>
          <p className="field-account">{person.name} <span className="tag">Synthetic demo</span></p>
          {loadError && <p className="form-error" role="alert">{loadError} {assignmentId && <a href={fieldUrl}>My assignments</a>}</p>}
          {assignmentId ? assigned[0] && <AssignmentDetails entry={assigned[0]} workflow={workflow} /> : <>
            <FieldPush />
            <h2>My assignments</h2>
            {available === true && !assigned.length && <p className="field-empty">No approved assignments in your scope.</p>}
            {groups.map((group) => group.entries.length > 0 && <section key={group.label} className="field-inbox-group"><h3>{group.label}</h3>
              {group.entries.map((entry) => <AssignmentCard key={entry.assignment!.id} entry={entry} />)}</section>)}
          </>}
        </>}
    </main>
  </div>
}
