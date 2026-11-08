import { useEffect, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import type { AuditEntry, Investigation } from '../agent/investigate.ts'
import type { Dataset } from '../../packages/domain/model.ts'
import type { Plan } from '../../packages/domain/simulate.ts'
import { registerInvestigationDataset } from './datasets.ts'
import { jsonRequest } from './useWorkflow.ts'
import { money, stamp } from './format.ts'

interface Selection { data: Dataset; at: number; systemId: string; facilityId?: string; manual?: Plan }
interface Result { summary?: string; trace?: AuditEntry[]; recommendedCost?: number; error?: string }

function alternativeCost(audit: AuditEntry[]) {
  const entry = audit.findLast((item) => item.ok && item.name === 'simulate_alternative')
  const value = (entry?.result as { outcome?: { costs_usd?: { total?: number } } } | undefined)?.outcome?.costs_usd?.total
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function InvestigatorForm({ context, onDraft }: { context: Selection; onDraft?: (text: string) => void }) {
  const [status, setStatus] = useState<{ configured: boolean; authorized: boolean } | null>(null)
  const [question, setQuestion] = useState('')
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [summary, setSummary] = useState('')
  const [recommended, setRecommended] = useState<number | undefined>()
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [drafted, setDrafted] = useState(false)
  const request = useRef<AbortController | null>(null)
  const endpoint = '/api/nemotron'
  const system = context.data.systems.find((item) => item.id === context.systemId)
  const cost = alternativeCost(audit)
  const enabled = status?.configured && status.authorized

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      void fetch(endpoint, { signal: controller.signal }).then(async (response) => {
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const value = await response.json()
          if (!controller.signal.aborted) setStatus(value)
        } else if (!controller.signal.aborted) setStatus({ configured: false, authorized: false })
      }).catch(() => { if (!controller.signal.aborted) setStatus({ configured: false, authorized: false }) })
    }
    refresh()
    window.addEventListener('nightwatch-session', refresh)
    return () => { controller.abort(); request.current?.abort(); window.removeEventListener('nightwatch-session', refresh) }
  }, [])

  async function analyze() {
    const controller = new AbortController()
    request.current = controller
    setWorking(true)
    setAudit([])
    setSummary('')
    setRecommended(undefined)
    setError('')
    setDrafted(false)
    try {
      async function run(refresh = false) {
        const datasetId = await registerInvestigationDataset(context.data, controller.signal, refresh)
        return fetch(endpoint, { ...jsonRequest({
          datasetId, at: context.at, systemId: context.systemId, facilityId: context.facilityId,
          manual: context.manual, question: question.trim() || undefined,
        }), signal: controller.signal })
      }
      let response = await run()
      if (response.status === 404) response = await run(true)
      const result = await response.json() as Result
      if (!controller.signal.aborted) {
        setAudit(result.trace ?? [])
        if (!response.ok) throw new Error(result.error || 'Nemotron request failed.')
        setSummary(result.summary ?? '')
        setRecommended(result.recommendedCost)
      }
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message)
    } finally {
      if (!controller.signal.aborted) setWorking(false)
    }
  }

  return <div className="investigator-form">
    <p>{context.systemId} · Frozen at {stamp(context.at)}</p>
    <p>{status === null ? 'Checking NVIDIA configuration…' : !status.configured ? 'Set NVIDIA_API_KEY in .env.local and restart NIGHTWATCH.' :
      !status.authorized ? 'Sign in as a control-room operator to investigate.' :
      'The server runs the tools and sends the selected evidence and computed outcomes to NVIDIA.'}</p>
    <label>Investigation question<textarea disabled={!enabled || working} rows={2} maxLength={500} value={question}
      onChange={(event) => setQuestion(event.target.value)} placeholder="What is driving the recommendation for this system?" /></label>
    <div className="investigator-buttons">
      {context.facilityId && (system?.fleetSize ?? 0) >= 2 && <button className="small-btn" disabled={!enabled || working}
        onClick={() => setQuestion('What happens if I send trucks 1 and 2 to ' + context.facilityId + ' for one trip each now? Simulate that plan and compare it.')}>Test two trucks here</button>}
      <button className="small-btn" disabled={!enabled || working} onClick={() => setQuestion('Draft a field briefing for the current incidents using recorded evidence and the calculated response.')}>Draft field briefing</button>
      <button className="primary-btn" disabled={!enabled || working} onClick={() => void analyze()}>{working ? 'Investigating…' : 'Investigate with Nemotron'}</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {summary && <><p className="investigator-answer">{summary}</p>
      {recommended !== undefined && <dl className="values">
        <dt>Recommended simulated cost</dt><dd>{money(recommended)}</dd>
        {cost !== null && <><dt>Alternative simulated cost</dt><dd>{money(cost)}</dd></>}
      </dl>}
      {onDraft && audit.some((entry) => entry.ok && entry.name === 'draft_briefing') && <div><button className="small-btn"
        onClick={() => { onDraft(summary); setDrafted(true) }}>{drafted ? 'Draft available in Incident workflow' : 'Use as editable assignment draft'}</button></div>}
    </>}
    {audit.length > 0 && <details className="investigator-trace"><summary>Tool trace · {audit.length} calls</summary><ol aria-label="Nemotron tool calls">
      {audit.map((entry, i) => <li key={i}><details><summary>{entry.name} · {entry.ok ? 'complete' : 'tool error'}</summary>
        <pre>{JSON.stringify({ input: entry.input, output: entry.result }, null, 2)}</pre></details></li>)}
    </ol></details>}
  </div>
}

function InvestigatorDisclosure({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return <details className="investigator" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><ScanLine size={15} /> AI Investigator <span className="tag">Nemotron</span></summary>
    {open && children}
  </details>
}

export function NemotronPanel({ context }: { context: Investigation }) {
  return <InvestigatorDisclosure><InvestigatorForm context={{
    data: context.data, at: context.scenario.at, systemId: context.scenario.system.id,
    facilityId: context.selectedFacilityId ?? context.scenario.failures[0]?.facility.id, manual: context.manual.plan,
  }} /></InvestigatorDisclosure>
}

export function SystemInvestigator({ onDraft, ...context }: Selection & { onDraft?: (text: string) => void }) {
  return <InvestigatorDisclosure><InvestigatorForm context={context} onDraft={onDraft} /></InvestigatorDisclosure>
}
