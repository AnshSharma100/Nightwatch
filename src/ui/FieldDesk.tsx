import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, ClipboardList, Radio } from 'lucide-react'
import { stageLabel } from '../../packages/domain/workflow.ts'
import type { WorkflowEntry } from '../../packages/domain/workflow.ts'
import { SignIn, WorkflowActions, WorkflowHistory } from './IncidentWorkflow.tsx'
import { useWorkflow } from './useWorkflow.ts'
import { duration, stamp, titleFor } from './format.ts'
import { FieldPush } from './FieldPush.tsx'
import { FieldShift } from './FieldShift.tsx'
import { BrandMark, ThemeToggle, useTheme } from './Theme.tsx'
import './workspace.css'
import './field.css'

const fieldUrl = '/field'

// Keep the one-time credential out of page URLs, history and subsequent requests.
function takeConnectionLink() {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const code = fragment.get('invite')
  if (code === null) return null
  fragment.delete('invite')
  const remaining = fragment.toString()
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + (remaining ? '#' + remaining : ''))
  return /^[A-Za-z0-9_-]{32}$/.test(code) ? code : ''
}

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
    <section className="field-instructions">
      {assignment.briefing && <><h3>Field instructions</h3><p>{assignment.briefing}</p></>}
      <h3>Approved response</h3><p>{assignment.response}</p>
    </section>
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
  const [connectionCode, setConnectionCode] = useState(takeConnectionLink)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const workflow = useWorkflow(assignmentId)
  const theme = useTheme()
  const [signOutError, setSignOutError] = useState('')
  const { entries, person, available, loadError } = workflow
  const assigned = entries.filter((entry) => entry.assignment).sort((a, b) =>
    Number(urgent(b)) - Number(urgent(a)) || b.assignment!.assignedAt - a.assignment!.assignedAt)
  const groups = [
    { label: 'New', entries: assigned.filter((entry) => entry.stage === 'assigned') },
    { label: 'Acknowledged and in progress', entries: assigned.filter((entry) => entry.stage === 'acknowledged' || entry.stage === 'in_progress') },
    { label: 'Completed', entries: assigned.filter((entry) => entry.stage === 'resolved') },
  ]

  async function connectDevice() {
    if (!connectionCode) return
    setConnecting(true)
    setConnectionError('')
    try { await workflow.signIn(connectionCode); setConnectionCode(null) }
    catch (error) { setConnectionError((error as Error).message) }
    finally { setConnecting(false) }
  }

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
    <header><div className="field-brand"><BrandMark /><div><h1>NIGHTWATCH Field</h1><span>CREW OPERATIONS</span></div></div>
      <div className="field-head-actions"><ThemeToggle {...theme} />
        {person ? <button className="soft-btn" onClick={() => void workflow.signOut().catch((error) => setSignOutError(error.message))}>Sign out</button> :
          <a className="soft-btn field-control-link" aria-label="Control room" href="/"><ArrowLeft size={15} /><span>Control room</span></a>}</div></header>
    <main>
      {signOutError && <p className="form-error" role="alert">{signOutError}</p>}
      {!person ? <section className="field-welcome"><span className="field-welcome-icon"><Radio size={22} /></span><h2>{assignmentId ? 'Connect to open your assignment' : 'Connect your field device'}</h2>
        <p>Your laptop stays signed in as control room. This phone connects separately as a field engineer and remembers you for seven days.</p>
        {connectionCode !== null ? <div className="field-connect">
          <p>Use the link shared by the control room within 15 minutes, on the device you will take into the field.</p>
          {connectionCode ? <button className="primary-btn" disabled={connecting || workflow.configured !== true} onClick={() => void connectDevice()}>
            {connecting ? 'Connecting…' : 'Connect this device'}</button> : <p className="form-error" role="alert">This connection link is invalid. Ask the control room for a new link.</p>}
          {connectionError && <p className="form-error" role="alert">{connectionError} Ask the control room for a new connection link if this one has expired.</p>}
        </div> : <><p>On your laptop, select an incident → <strong>Send to Field</strong> → <strong>Begin review</strong> → <strong>Create connection link</strong>.</p>
          <p>Scan the QR with this phone’s camera, or open the copied link here. You do not need the control-room code on your phone.</p></>}
        <ol className="field-onboarding"><li>Connect this device once.</li><li>Clock in and enable phone notifications.</li><li>Open your approved assignment and acknowledge it.</li></ol>
        <details className="field-code-fallback"><summary>Have a one-time code instead?</summary><SignIn label="Field sign-in code" configured={workflow.configured} onSignIn={async (code) => { await workflow.signIn(code); setConnectionCode(null) }} /></details>
        <p className="field-demo-note">Demonstration personnel only. No employee account or password is required.</p>
        {workflow.configured === false && <p role="alert">The control room has not enabled field connections yet. Ask the operator to finish field setup.</p>}
        {available === false && <p role="alert">The workflow server is unavailable.</p>}</section> : person.role === 'control' ?
        <section className="field-welcome"><h2>This browser is the control room</h2><p>Open the field connection link on the engineer’s phone or a separate browser profile. That keeps the operator and engineer signed in at the same time.</p>
          <p>To use this browser as the field device instead, sign out above and open the connection link.</p><a className="soft-btn field-back" href="/">Return to control room</a></section> :
        <>
          {!assignmentId && <p className="field-account">{person.name} <span className="tag">Synthetic demo</span></p>}
          {connectionCode !== null && <p className="field-empty">This browser is already connected as {person.name}. To use a different field identity, sign out and connect with the new link.</p>}
          {loadError && <p className="form-error" role="alert">{loadError} {assignmentId && <a href={fieldUrl}>My assignments</a>}</p>}
          {assignmentId ? assigned[0] && <AssignmentDetails entry={assigned[0]} workflow={workflow} /> : <>
            <FieldShift />
            <FieldPush />
            <h2 className="inbox-title"><ClipboardList size={19} /> My assignments</h2>
            {available === true && !assigned.length && <p className="field-empty">No approved assignments yet. After you clock in, the operator can select you and send a confirmed assignment here.</p>}
            {groups.map((group) => group.entries.length > 0 && <section key={group.label} className="field-inbox-group"><h3>{group.label}</h3>
              {group.entries.map((entry) => <AssignmentCard key={entry.assignment!.id} entry={entry} />)}</section>)}
          </>}
        </>}
    </main>
  </div>
}
