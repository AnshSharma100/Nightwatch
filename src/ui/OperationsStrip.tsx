import { ArrowUpRight, Clock3, Radio, TrendingDown } from 'lucide-react'
import type { OperationsSummary } from '../../packages/domain/operations.ts'
import { duration, money } from './format.ts'

export function OperationsStrip({ summary, onFocus }: { summary?: OperationsSummary; onFocus: (id: string) => void }) {
  if (!summary) return <section className="ops-strip" aria-label="Current operational risk"><div className="ops-metric" role="status">Loading recorded risk…</div></section>
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
