import { useEffect, useMemo, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { investigate } from '../agent/investigate.ts'
import type { AuditEntry, Investigation } from '../agent/investigate.ts'
import type { Completion } from '../agent/contracts.ts'
import type { Alert } from '../engine/incidents.ts'
import type { Dataset } from '../engine/model.ts'
import { optimize } from '../engine/optimize.ts'
import type { Optimization } from '../engine/optimize.ts'
import { scenarioAt } from '../engine/simulate.ts'
import type { Scenario } from '../engine/simulate.ts'
import { money, stamp } from './format.ts'

function alternativeCost(audit: AuditEntry[]) {
  const entry = audit.findLast((item) => item.ok && item.name === 'simulate_alternative')
  const value = (entry?.result as { outcome?: { costs_usd?: { total?: number } } } | undefined)?.outcome?.costs_usd?.total
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function InvestigatorForm({ context }: { context: Investigation }) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [question, setQuestion] = useState('')
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const request = useRef<AbortController | null>(null)
  const endpoint = import.meta.env.BASE_URL + 'api/nemotron'
  const failure = context.scenario.failures.find((item) => item.facility.id === context.selectedFacilityId) ?? context.scenario.failures[0]
  const cost = alternativeCost(audit)

  useEffect(() => {
    const controller = new AbortController()
    void fetch(endpoint, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((status) => { if (!controller.signal.aborted) setConfigured(status?.configured === true) })
      .catch(() => { if (!controller.signal.aborted) setConfigured(false) })
    return () => { controller.abort(); request.current?.abort() }
  }, [endpoint])

  async function analyze() {
    const controller = new AbortController()
    request.current = controller
    setWorking(true)
    setAudit([])
    setSummary('')
    setError('')
    try {
      const result = await investigate(context, async (messages, first) => {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, first }), signal: controller.signal,
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'Nemotron request failed.')
        return result as Completion
      }, (entry) => setAudit((prior) => [...prior, entry]), question.trim() || undefined)
      if (!controller.signal.aborted) setSummary(result)
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message)
    } finally {
      if (!controller.signal.aborted) setWorking(false)
    }
  }

  return <div className="investigator-form">
    <p>{context.scenario.system.id} · Frozen at {stamp(context.scenario.at)}</p>
    <p>{configured === false ? 'Set NVIDIA_API_KEY on the local server to enable Nemotron.' :
      configured ? 'Running an investigation sends the selected system’s evidence and computed outcomes to NVIDIA.' : 'Checking local NVIDIA configuration…'}</p>
    <label>Investigation question<textarea disabled={!configured || working} rows={2} maxLength={500} value={question}
      onChange={(event) => setQuestion(event.target.value)} placeholder="What is driving the recommendation for this system?" /></label>
    <div className="investigator-buttons">
      {failure && context.scenario.system.fleetSize >= 2 && <button className="small-btn" disabled={!configured || working} onClick={() => setQuestion('What happens if I send trucks 1 and 2 to ' + failure.facility.id + ' for one trip each now? Simulate that plan and compare it.')}>Test two trucks here</button>}
      <button className="small-btn" disabled={!configured || working} onClick={() => setQuestion('Draft a field briefing for the current incidents using recorded evidence and the calculated response.')}>Draft field briefing</button>
      <button className="primary-btn" disabled={!configured || working} onClick={() => void analyze()}>{working ? 'Investigating…' : 'Investigate with Nemotron'}</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {summary && <><p className="investigator-answer">{summary}</p>{context.scenario.failures.length > 0 && <dl className="values">
      <dt>Recommended simulated cost</dt><dd>{money(context.recommended.costs.total)}</dd>
      {cost !== null && <><dt>Alternative simulated cost</dt><dd>{money(cost)}</dd></>}
    </dl>}</>}
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
  return <InvestigatorDisclosure><InvestigatorForm context={context} /></InvestigatorDisclosure>
}

export function SystemInvestigator(props: SystemInvestigatorProps) {
  return <InvestigatorDisclosure><SystemInvestigatorForm {...props} /></InvestigatorDisclosure>
}

interface SystemInvestigatorProps {
  data: Dataset; alerts: Alert[]; at: number; systemId: string; facilityId?: string
  planning: { scenario: Scenario; search: Optimization } | null
}

function SystemInvestigatorForm({ data, alerts, at, systemId, facilityId, planning }: SystemInvestigatorProps) {
  const context = useMemo(() => {
    const scenario = planning?.scenario ?? scenarioAt(data, alerts.filter((alert) => alert.levelPct !== undefined), systemId, at)
    const search = planning?.search ?? optimize(scenario)
    return { data, alerts, scenario, baseline: search.baseline, manual: search.baseline, recommended: search.best, selectedFacilityId: facilityId }
  }, [data, alerts, at, systemId, facilityId, planning])
  return <InvestigatorForm context={context} />
}
