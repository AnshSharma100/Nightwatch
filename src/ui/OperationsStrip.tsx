import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Clock3, Radio, TrendingDown } from 'lucide-react'
import type { Alert } from '../engine/incidents.ts'
import type { Dataset } from '../engine/model.ts'
import { exposureInputs, summarizeOperations } from '../engine/operations.ts'
import type { OperationsSummary } from '../engine/operations.ts'
import { duration, money } from './format.ts'

export function OperationsStrip({ data, alerts, onFocus }: { data: Dataset; alerts: Alert[]; onFocus: (id: string) => void }) {
  const snapshot = useMemo(() => exposureInputs(data, alerts), [data, alerts])
  const local = useMemo(() => summarizeOperations(snapshot), [snapshot])
  const [remote, setRemote] = useState<{ snapshot: typeof snapshot; summary: OperationsSummary } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(import.meta.env.BASE_URL + 'api/operations-summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot), signal: controller.signal,
    }).then(async (response) => {
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const summary = await response.json() as OperationsSummary
        if (!controller.signal.aborted) setRemote({ snapshot, summary })
      }
    }).catch(() => { /* The same calculation keeps recorded playback available offline. */ })
    return () => controller.abort()
  }, [snapshot])
  const summary = remote?.snapshot === snapshot ? remote.summary : local
  const next = summary.next
  return <section className="ops-strip" aria-label="Current operational risk">
    <div className="ops-metric">
      <Clock3 size={17} /><div><span>Next shut-in</span><strong className={next ? 'at-risk' : ''}>{next ? duration(next.minutes) : summary.projectedLoss === null ? 'Reading needed' : 'None forecast'}</strong></div>
      {next && <button className="ops-jump" title={next.facilityId} onClick={() => onFocus(next.assetId)} aria-label={'Go to next shut-in at ' + next.facilityId}><span>{next.facilityId}</span><ArrowUpRight size={15} /></button>}
    </div>
    <div className="ops-metric"><Radio size={17} /><div><span>Urgent pump failures</span><strong>{summary.urgent}</strong></div>
      <small>{summary.shutIn ? summary.shutIn + ' already shut in' : summary.active + ' active'}</small></div>
    <div className="ops-metric"><TrendingDown size={17} /><div><span>Revenue at risk</span><strong className={summary.atRiskPerHour ? 'at-risk' : ''}>{money(summary.atRiskPerHour)}<small>/hr</small></strong></div>
      <small className="risk-detail" title="Projected oil and gas revenue loss from this recorded timestamp through repair if no action is taken">{summary.projectedLoss === null ? 'Forecast incomplete' : money(summary.projectedLoss) + ' projected loss'}</small></div>
  </section>
}
