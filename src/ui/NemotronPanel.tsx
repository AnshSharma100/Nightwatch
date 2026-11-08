import { useEffect, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import type { AuditEntry, Investigation } from '../agent/investigate.ts'
import type { Dataset } from '../../packages/domain/model.ts'
import type { Plan } from '../../packages/domain/simulate.ts'
import { recordingId, registerInvestigationDataset } from './datasets.ts'
import { jsonRequest } from './useWorkflow.ts'
import { money, stamp } from './format.ts'

interface Selection { data: Dataset; at: number; systemId: string; facilityId?: string; manual?: Plan }
interface Result { summary?: string; trace?: AuditEntry[]; recommendedCost?: number; error?: string }

interface ToolPlan {
  costs_usd?: { total?: number }
  facilities?: { facility_id: string; auto_shut_in_after_min: number | null }[]
}

function toolPlan(audit: AuditEntry[], name: string, field: 'outcome' | 'recommended' | 'alternative') {
  const entry = audit.findLast((item) => item.ok && item.name === name)
  return (entry?.result as Partial<Record<typeof field, ToolPlan>> | undefined)?.[field]
}

function automaticSites(plan?: ToolPlan) {
  return plan?.facilities?.filter((site) => site.auto_shut_in_after_min !== null).map((site) => site.facility_id)
}

function InvestigatorForm({ context, onDraft, onRequestAccess }: { context: Selection; onDraft?: (text: string) => void; onRequestAccess?: () => void }) {
  const [status, setStatus] = useState<{ configured: boolean; authorized: boolean } | null>(null)
  const [question, setQuestion] = useState('')
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [summary, setSummary] = useState('')
  const [recommended, setRecommended] = useState<number | undefined>()
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [drafted, setDrafted] = useState(false)
  const [investigatedAt, setInvestigatedAt] = useState<number | null>(null)
  const [answeredQuestion, setAnsweredQuestion] = useState('')
  const request = useRef<AbortController | null>(null)
  const endpoint = '/api/nemotron'
  const system = context.data.systems.find((item) => item.id === context.systemId)
  const recommendedPlan = toolPlan(audit, 'compare_plans', 'recommended')
  const alternativePlan = toolPlan(audit, 'compare_plans', 'alternative') ?? toolPlan(audit, 'simulate_alternative', 'outcome')
  const cost = alternativePlan?.costs_usd?.total
  const recommendedCost = recommended ?? recommendedPlan?.costs_usd?.total
  const recommendedShutIns = automaticSites(recommendedPlan)
  const alternativeShutIns = automaticSites(alternativePlan)
  const enabled = status?.configured && status.authorized
  const answerParagraphs = summary.split(/\n\s*\n/).filter(Boolean)
  const briefing = (audit.findLast((entry) => entry.ok && entry.name === 'draft_briefing')?.result as { instructions?: string[] } | undefined)?.instructions?.join('\n')

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
    if (!enabled || working) return
    const controller = new AbortController()
    request.current = controller
    setWorking(true)
    setAudit([])
    setSummary('')
    setRecommended(undefined)
    setError('')
    setDrafted(false)
    setInvestigatedAt(context.at)
    setAnsweredQuestion(question.trim() || 'What needs attention here, and what should I do next?')
    try {
      async function run(refresh = false) {
        const datasetId = await registerInvestigationDataset(context.data, controller.signal, refresh)
        return fetch(endpoint, { ...jsonRequest({
          datasetId, at: context.at, systemId: context.systemId, facilityId: context.facilityId,
          manual: context.manual, question: question.trim() || 'What needs attention here, and what should I do next?',
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
    <p>{context.systemId} · Selected recording at {stamp(context.at)}</p>
    <p>{status === null ? 'Checking AI availability. You can prepare a question now.' : !status.configured ? 'AI is unavailable. Configure NVIDIA on the server to run an investigation. You can still prepare a question.' :
      !status.authorized ? 'Open Control room and sign in to run an investigation. You can prepare a question now.' :
      'Ask about the evidence, compare truck plans, or prepare a field briefing. Tools use this recorded snapshot and do not dispatch work.'}</p>
    {status?.configured && !status.authorized && onRequestAccess && <div><button className="small-btn" onClick={onRequestAccess}>Open Control room</button></div>}
    <label>Investigation question<textarea disabled={working} rows={2} maxLength={500} value={question}
      onChange={(event) => setQuestion(event.target.value)} placeholder="What is driving the recommendation for this system?" /></label>
    <div className="investigator-buttons">
      <button className="small-btn" disabled={working} onClick={() => setQuestion('What is wrong here, what evidence supports it, and what should I do next?')}>Explain this incident</button>
      {context.facilityId && (system?.fleetSize ?? 0) >= 2 && <button className="small-btn" disabled={working}
        onClick={() => setQuestion('Compare sending both trucks to ' + context.facilityId + ' against the recommended plan. Simulate one trip each from truck slots 1 and 2 sent there now and explain the shared fleet tradeoff.')}>Test two trucks here</button>}
      <button className="small-btn" disabled={working} onClick={() => setQuestion('Draft a field briefing for the current incidents using recorded evidence and the calculated response.')}>Draft field briefing</button>
      <button className="primary-btn" disabled={!enabled || working} onClick={() => void analyze()}>{working ? 'Investigating…' : 'Investigate with Nemotron'}</button>
    </div>
    {investigatedAt !== null && <p className="investigator-snapshot">{working ? 'Investigating' : 'Investigation from'} {stamp(investigatedAt)}{investigatedAt !== context.at ? ' · Replay has moved. Run again to investigate the selected time.' : ''}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {summary && <section aria-label="Investigation answer"><h4>{answeredQuestion}</h4>
      {answerParagraphs.slice(0, 4).map((paragraph, index) => <p key={index} className="investigator-answer">{paragraph}</p>)}
      {answerParagraphs.length > 4 && <details className="investigator-more"><summary>More evidence and plan details</summary>
        {answerParagraphs.slice(4).map((paragraph, index) => <p key={index} className="investigator-answer">{paragraph}</p>)}
      </details>}
      <p className="investigator-attribution">Nemotron selects the evidence; NIGHTWATCH supplies the quoted readings, costs and simulated outcomes.</p>
    </section>}
    {(recommendedCost !== undefined || cost !== undefined) && <dl className="values" aria-label="Verified tool costs">
      {recommendedCost !== undefined && <><dt>Recommended simulated cost</dt><dd>{money(recommendedCost)}</dd></>}
      {cost !== undefined && <><dt>Alternative simulated cost</dt><dd>{money(cost)}</dd></>}
    </dl>}
    {(recommendedShutIns || alternativeShutIns) && <section className="investigator-outcomes" aria-label="Verified automatic shut-ins">
      <h4>Projected automatic shut-ins</h4>
      <dl className="values">
        {recommendedShutIns && <><dt>Recommended</dt><dd>{recommendedPlan?.facilities?.length === 0 ? 'No pump failures simulated' : recommendedShutIns.join(', ') || 'None in simulation'}</dd></>}
        {alternativeShutIns && <><dt>Alternative</dt><dd>{alternativePlan?.facilities?.length === 0 ? 'No pump failures simulated' : alternativeShutIns.join(', ') || 'None in simulation'}</dd></>}
      </dl>
    </section>}
    {summary && onDraft && briefing && <div><button className="small-btn" disabled={investigatedAt !== context.at}
      onClick={() => { onDraft(briefing); setDrafted(true) }}>{investigatedAt !== context.at ? 'Run again before using this draft' : drafted ? 'Draft available in Send to Field' : 'Use as editable assignment draft'}</button></div>}
    {audit.length > 0 && <details className="investigator-trace"><summary>Tool trace · {audit.length} calls</summary><ol aria-label="Nemotron tool calls">
      {audit.map((entry, i) => <li key={i}><details><summary>{entry.name} · {entry.ok ? 'complete' : 'tool error'}</summary>
        <pre>{JSON.stringify({ input: entry.input, output: entry.result }, null, 2)}</pre></details></li>)}
    </ol></details>}
  </div>
}

function InvestigatorDisclosure({ children }: { children: React.ReactNode }) {
  const [opened, setOpened] = useState(false)
  return <details className="investigator" onToggle={(event) => { if (event.currentTarget.open) setOpened(true) }}>
    <summary><ScanLine size={15} /> AI Investigator <span className="tag">Nemotron</span></summary>
    {opened && children}
  </details>
}

export function NemotronPanel({ context }: { context: Investigation }) {
  return <InvestigatorDisclosure key={recordingId(context.data) + ':' + context.scenario.system.id + ':' + context.scenario.at}><InvestigatorForm context={{
    data: context.data, at: context.scenario.at, systemId: context.scenario.system.id,
    facilityId: context.selectedFacilityId ?? context.scenario.failures[0]?.facility.id, manual: context.manual.plan,
  }} /></InvestigatorDisclosure>
}

export function SystemInvestigator({ onDraft, onRequestAccess, ...context }: Selection & { onDraft?: (text: string) => void; onRequestAccess?: () => void }) {
  return <InvestigatorDisclosure key={recordingId(context.data) + ':' + context.systemId + ':' + context.facilityId}><InvestigatorForm context={context} onDraft={onDraft} onRequestAccess={onRequestAccess} /></InvestigatorDisclosure>
}
