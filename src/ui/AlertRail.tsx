import { AlertCircle, Bell, Check, ChevronRight, Clock3, Wrench } from 'lucide-react'
import type { Alert } from '../engine/incidents.ts'
import { duration, titleFor } from './format.ts'

export function AlertRail({ alerts, selected, onAlert }: { alerts: Alert[]; selected: string | null; onAlert: (id: string) => void }) {
  const confirmed = alerts.filter((alert) => alert.verified)
  const pending = alerts.filter((alert) => !alert.verified)
  const critical = confirmed.filter((alert) => alert.category === 'pump_failure').length
  function card(alert: Alert) {
    const failure = alert.category === 'pump_failure'
    const level = failure ? 'critical' : alert.category === 'pipeline_leak' ? 'warning' : 'advisory'
    const status = alert.automatic ? 'Wells shut in' : alert.minutesToLimit === null ? 'Countdown unavailable' :
      alert.repairMinutes !== null && alert.minutesToLimit >= alert.repairMinutes ? 'Repair before limit' : duration(alert.minutesToLimit) + ' to shutdown'
    return <button className={'alert-card ' + level + (selected === alert.assetId ? ' selected' : '')} key={alert.assetId + alert.category} onClick={() => onAlert(alert.assetId)}>
      <span className="alert-top">{failure ? <AlertCircle size={14} /> : <Wrench size={13} />}{titleFor[alert.category]}<ChevronRight size={14} className="chevron" /></span>
      <strong>{alert.assetId}</strong>
      <span className="alert-meta">{alert.systemId} · {failure ? 'Critical' : alert.category === 'pipeline_leak' ? 'Urgent inspection' : 'Inspection'}</span>
      <span className="alert-action">{failure && <Clock3 size={12} />}{failure ? status : alert.verified ? 'Field inspection' : 'Awaiting running sample'}</span>
    </button>
  }
  return <aside className="panel alert-rail" aria-label="Active alerts">
    <div className="panel-head"><div><span className="eyebrow">SHIFT PRIORITIES</span><h2>Active alerts</h2></div><span className={'badge ' + (confirmed.length ? 'hot' : '')}>{confirmed.length}</span></div>
    <div className="alert-scroll">
      {confirmed.length > 0 ? <>
        <div className="rail-label"><Bell size={13} /> {critical ? critical + ' requiring response' : 'Inspection queue'}</div>
        {confirmed.map(card)}
      </> : <div className="empty-state"><div className="empty-glyph"><Check size={21} /></div><h3>No active alerts</h3><p>No incident evidence at this point in the recording.</p></div>}
      {pending.length > 0 && <><div className="rail-label pending-label">Awaiting verification</div>{pending.map(card)}</>}
    </div>
    <footer className="rail-foot"><span className="status-dot" /> Telemetry-based monitoring</footer>
  </aside>
}
