import { useState } from 'react'
import { BadgeCheck, ClipboardList, Copy } from 'lucide-react'
import { actionLabel, assigneeName, availableActions, caseKey, stageLabel } from '../../packages/domain/workflow.ts'
import type { Action, Actor, WorkflowCase, WorkflowEntry, WorkflowUpdate } from '../../packages/domain/workflow.ts'
import { deliveryLabel, personFor } from '../../packages/domain/personnel.ts'
import type { Person } from '../../packages/domain/personnel.ts'
import { stamp } from './format.ts'
import { useRoster } from './useRoster.ts'
import { shiftLabel } from '../../packages/contracts/shifts.ts'
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
  const [recipientId, setRecipient] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const actions = availableActions(entry, actor).filter((action) => action !== 'handoff')
  const assigning = actions.includes('assign')
  const confirming = actions.includes('confirm')
  const needsNote = assigning || confirming || actions.includes('progress')
  const roster = useRoster(assigning ? caseKey(incident) : null)
  const recipient = roster?.engineers.find(({ person, shift }) => person.id === recipientId && shift.status === 'available')
  if (!actions.length) return null

  async function submit(action: Action) {
    setPending(true)
    setError('')
    const submitted = note
    try {
      await onUpdate({ actor, action, incident, revision: entry?.history.length ?? 0, note: submitted,
        recipientId: recipient?.person.id, response })
      setNote((current) => current === submitted ? '' : current)
    } catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }

  return <div className="workflow-actions">
    {assigning && <>
      <label>Available engineer<select value={recipientId} disabled={pending} onChange={(event) => setRecipient(event.target.value)}>
        <option value="">Choose an engineer</option>
        {roster?.engineers.map(({ person, shift }) => <option key={person.id} value={person.id} disabled={shift.status !== 'available'}>
          {person.name} · {shiftLabel[shift.status]}
        </option>)}
      </select></label>
      {!roster ? <p>Checking the shift roster…</p> : roster.error ? <p className="form-error" role="alert">{roster.error}</p> :
        !roster.engineers.some(({ shift }) => shift.status === 'available') && <p>No available engineers cover this site. Connect a field device below, then have the engineer clock in on it.</p>}
      {response && <p className="assignment-approved">{response}</p>}
      {draft && <div><button className="small-btn" disabled={pending} onClick={() => setNote(draft.slice(0, 500))}>Use AI draft</button></div>}
    </>}
    {needsNote && <label>{confirming ? 'Reason for confirmation' : assigning ? 'Field instructions' : 'Work note'}
      <textarea rows={3} maxLength={500} disabled={pending} value={note} onChange={(event) => setNote(event.target.value)} /></label>}
    <div>{actions.map((action, index) => <button key={action} className={index === 0 ? 'primary-btn' : 'small-btn'}
      disabled={pending || (['assign', 'resolve', 'progress', 'confirm'].includes(action) && !note.trim()) || (action === 'assign' && !recipient)}
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
  const [role, setRole] = useState<'foreman' | 'lease'>('lease')
  const [invite, setInvite] = useState<{ code: string; person: Person } | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [copied, setCopied] = useState(false)
  const connectionLink = invite ? window.location.origin + '/field#invite=' + encodeURIComponent(invite.code) : ''
  return <details className="workflow-history"><summary>Connect a field device</summary>
    <div className="workflow-actions">
      <p>Do this once for each engineer’s browser or phone. The link connects a synthetic demo identity to its assigned work; the device stays signed in for seven days.</p>
      <label>Synthetic account<select value={role} onChange={(event) => { setRole(event.target.value as 'foreman' | 'lease'); setInvite(null); setCopied(false) }}>
        <option value="foreman">{personFor(incident, 'foreman').name}</option><option value="lease">{personFor(incident, 'lease').name}</option>
      </select></label>
      <div><button className="small-btn" disabled={working} onClick={async () => {
        setWorking(true)
        setError('')
        setCopied(false)
        try { setInvite(await workflowJson('/api/workflow/invite', jsonRequest({ key: caseKey(incident), role }))) }
        catch (error) { setError((error as Error).message) }
        finally { setWorking(false) }
      }}>Create connection link</button></div>
      {invite && <div className="field-invite">
        <label>Field connection link<input readOnly value={connectionLink} onFocus={(event) => event.target.select()} /></label>
        <button className="small-btn" onClick={async () => {
          try {
            if (!navigator.clipboard) throw new Error('Select and copy the connection link above.')
            await navigator.clipboard.writeText(connectionLink)
            setCopied(true)
            setError('')
          } catch { setError('Select and copy the connection link above.') }
        }}><Copy size={13} /> {copied ? 'Link copied' : 'Copy connection link'}</button>
        <p>Open this link on the engineer’s device within 15 minutes. Tap <strong>Connect this device</strong>, then <strong>Clock in</strong> and <strong>Enable notifications</strong>.</p>
        <p>Connects {invite.person.name}. Share only with the intended engineer. For a phone, use the shared HTTPS address for both devices.</p>
        <details><summary>Use a one-time code instead</summary><code>{invite.code}</code><p>Open /field in a separate browser profile or on the phone, then choose “Have a one-time code instead?”</p></details>
      </div>}
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
    <summary><ClipboardList size={15} /> Send to Field <span className="tag">{stageLabel[entry?.stage ?? 'detected']}</span></summary>
    <div className="inspector-section">
      {!entry?.assignment && <p>Review and confirm the incident, choose a clocked-in engineer, then send the approved instructions. Detection and confirmation alone never send a phone alert.</p>}
      {entry?.assignment && <><p><BadgeCheck size={14} /> {entry.assignment.recipient.name}</p>
        {delivery && <p className="delivery-state">{deliveryLabel[delivery.status]}{delivery.failed > 0 ? ' · ' + delivery.failed + ' device request(s) failed' : ''}</p>}</>}
      {person?.role === 'control' ? <>
        {editable && available ? <WorkflowActions actor="control" incident={incident} entry={entry} onUpdate={onUpdate} response={response} draft={draft} /> :
          <p>{!editable ? 'Review and assignment are available at the latest recording.' : available === false ? 'Workflow server unavailable.' : 'Connecting to the workflow server…'}</p>}
        {entry && <Enrollment incident={incident} />}
      </> : person ? <p>Sign out of the field account to use control-room tools.</p> : <>
        <p>Control-room sign-in identifies who approves field work. Sign in once; this browser remembers you for seven days.</p>
        <SignIn label="Control-room code" configured={configured} onSignIn={onSignIn} /></>}
      {entry && <WorkflowHistory entry={entry} />}
      {person && <button className="small-btn" onClick={() => void onSignOut().catch(() => {})}>Sign out</button>}
    </div>
  </details>
}
