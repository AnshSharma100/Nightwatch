import { useState } from 'react'
import { BadgeCheck, ClipboardList, Copy } from 'lucide-react'
import { actionLabel, assigneeName, availableActions, caseKey, stageLabel } from '../engine/workflow.ts'
import type { Action, Actor, WorkflowCase, WorkflowEntry, WorkflowUpdate } from '../engine/workflow.ts'
import { deliveryLabel, personFor } from '../engine/personnel.ts'
import type { Person } from '../engine/personnel.ts'
import { stamp } from './format.ts'
import { jsonRequest, workflowJson } from './useWorkflow.ts'

export function SignIn({ label, configured, onSignIn }: { label: string; configured?: boolean; onSignIn: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  return <form className="field-sign-in workflow-actions" onSubmit={async (event) => {
    event.preventDefault()
    setWorking(true)
    setError('')
    try { await onSignIn(code); setCode('') } catch (error) { setError((error as Error).message) }
    finally { setWorking(false) }
  }}>
    <label>{label}<input type="password" value={code} autoComplete="off" maxLength={128} onChange={(event) => setCode(event.target.value)} /></label>
    <div><button className="primary-btn" disabled={!code.trim() || working || configured === false}>Sign in</button></div>
    {configured === false && <p>Run <code>npm run setup:field</code>, then restart the server.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </form>
}

export function WorkflowActions({ actor, incident, entry, onUpdate, response, draft }: {
  actor: Actor; incident: WorkflowCase; entry?: WorkflowEntry; onUpdate: (change: WorkflowUpdate) => Promise<void>
  response?: string; draft?: string
}) {
  const [note, setNote] = useState('')
  const [recipientRole, setRecipient] = useState<'foreman' | 'lease'>('foreman')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const actions = availableActions(entry, actor)
  if (!actions.length) return null
  const assigning = actions.includes('assign')
  const confirming = actions.includes('confirm')

  async function submit(action: Action) {
    setPending(true)
    setError('')
    try {
      await onUpdate({ actor, action, incident, revision: entry?.history.length ?? 0, note, recipientRole, response })
      setNote('')
    } catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }

  return <div className="workflow-actions" key={entry?.stage}>
    {assigning && <><label>Approved recipient<select value={recipientRole} onChange={(event) => setRecipient(event.target.value as 'foreman' | 'lease')}>
      <option value="foreman">{personFor(incident, 'foreman').name}</option><option value="lease">{personFor(incident, 'lease').name}</option>
    </select></label>{response && <p className="assignment-approved">{response}</p>}
      {draft && <div><button className="small-btn" onClick={() => setNote(draft.slice(0, 500))}>Use AI draft</button></div>}</>}
    {(actor !== 'control' || assigning || confirming) && <label>{confirming ? 'Reason for confirmation' : assigning ? 'Field instructions' : 'Work note'}
      <textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>}
    <div>{actions.map((action, index) => <button key={action} className={index === 0 ? 'primary-btn' : 'small-btn'}
      disabled={pending || (['resolve', 'progress', 'confirm'].includes(action) && !note.trim())}
      onClick={() => void submit(action)}>{actionLabel[action]}</button>)}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>
}

export function WorkflowHistory({ entry }: { entry: WorkflowEntry }) {
  return <details className="workflow-history"><summary>Workflow history · {entry.history.length}</summary>
    <ol>{entry.history.map((event, index) => <li key={index}><strong>{actionLabel[event.action]}</strong>
      <span>{event.person?.name ?? assigneeName(event.actor, entry.incident)} · {stamp(event.at / 1000)}</span>
      {event.recipient && <span>Recipient · {event.recipient.name}</span>}{event.note && <p>{event.note}</p>}</li>)}</ol>
  </details>
}

function Enrollment({ incident }: { incident: WorkflowCase }) {
  const [role, setRole] = useState<'foreman' | 'lease'>('foreman')
  const [invite, setInvite] = useState<{ code: string; person: Person } | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  return <details className="workflow-history"><summary>Enroll a demo field device</summary>
    <div className="workflow-actions">
      <label>Synthetic account<select value={role} onChange={(event) => { setRole(event.target.value as 'foreman' | 'lease'); setInvite(null) }}>
        <option value="foreman">{personFor(incident, 'foreman').name}</option><option value="lease">{personFor(incident, 'lease').name}</option>
      </select></label>
      <div><button className="small-btn" disabled={working} onClick={async () => {
        setWorking(true)
        setError('')
        try { setInvite(await workflowJson('/api/workflow/invite', jsonRequest({ key: caseKey(incident), role }))) }
        catch (error) { setError((error as Error).message) }
        finally { setWorking(false) }
      }}>Create one-time code</button></div>
      {invite && <div className="field-invite"><code>{invite.code}</code><button className="small-btn" onClick={() => void navigator.clipboard?.writeText(invite.code).catch(() => {})}><Copy size={13} /> Copy</button>
        <p>Enter this code on the field device within 15 minutes. It signs in {invite.person.name}.</p></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </details>
}

export function IncidentWorkflow({ incident, entry, available, editable, onUpdate, person, configured, onSignIn, onSignOut, response, draft }: {
  incident: WorkflowCase; entry?: WorkflowEntry; available: boolean | null; editable: boolean; onUpdate: (change: WorkflowUpdate) => Promise<void>
  person?: Person | null; configured?: boolean; onSignIn: (code: string) => Promise<void>; onSignOut: () => Promise<void>
  response?: string; draft?: string
}) {
  const delivery = entry?.assignment?.delivery
  return <details className="inspector-fold workflow-fold">
    <summary><ClipboardList size={15} /> Incident workflow <span className="tag">{stageLabel[entry?.stage ?? 'detected']}</span></summary>
    <div className="inspector-section">
      {entry?.assignment && <><p><BadgeCheck size={14} /> {entry.assignment.recipient.name}</p>
        {delivery && <p className="delivery-state">{deliveryLabel[delivery.status]}{delivery.failed > 0 ? ' · ' + delivery.failed + ' device request(s) failed' : ''}</p>}</>}
      {person?.role === 'control' ? <>
        {editable && available ? <WorkflowActions actor="control" incident={incident} entry={entry} onUpdate={onUpdate} response={response} draft={draft} /> :
          <p>{!editable ? 'Review and assignment are available at the latest recording.' : available === false ? 'Workflow server unavailable.' : 'Connecting to the workflow server…'}</p>}
        {entry && <Enrollment incident={incident} />}
      </> : person ? <p>Sign out of the field account to use control-room tools.</p> :
        <SignIn label="Control-room code" configured={configured} onSignIn={onSignIn} />}
      {entry && <WorkflowHistory entry={entry} />}
      {person && <button className="small-btn" onClick={() => void onSignOut().catch(() => {})}>Sign out</button>}
    </div>
  </details>
}
