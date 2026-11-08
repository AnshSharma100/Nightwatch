import { useEffect, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { investigate } from '../agent/investigate.ts'
import type { AuditEntry, Investigation } from '../agent/investigate.ts'
import type { Completion } from '../agent/contracts.ts'

export function NemotronPanel({ context }: { context: Investigation }) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const request = useRef<AbortController | null>(null)
  const endpoint = '/api/nemotron'
  useEffect(() => {
    const controller = new AbortController()
    void fetch(endpoint, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((status) => setConfigured(status?.configured === true))
      .catch(() => { if (!controller.signal.aborted) setConfigured(false) })
    return () => { controller.abort(); request.current?.abort() }
  }, [])

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
      }, (entry) => setAudit((prior) => [...prior, entry]))
      if (!controller.signal.aborted) setSummary(result)
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message)
    } finally {
      if (!controller.signal.aborted) setWorking(false)
    }
  }

  return <section className="nemotron">
    <div><h3><ScanLine size={16} /> Nemotron investigation</h3>
      <p>{configured === false ? 'Optional · Set NVIDIA_API_KEY on the local server to enable analysis.' :
        configured ? 'Send the selected system’s incident evidence and computed plans to NVIDIA for explanation.' : 'Checking local NVIDIA configuration…'}</p></div>
    <button className="small-btn" disabled={!configured || working} onClick={() => void analyze()}>{working ? 'Investigating…' : 'Investigate with Nemotron'}</button>
    {audit.length > 0 && <ol aria-label="Nemotron tool calls">{audit.map((entry, i) => <li key={i}>{entry.name} · {entry.ok ? 'complete' : 'tool error'}</li>)}</ol>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {summary && <p className="nemotron-summary"><strong>Model explanation</strong>{summary}</p>}
  </section>
}
