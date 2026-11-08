import { AlertCircle, Check, ChevronRight, History, PanelLeftClose, PanelLeftOpen, RotateCcw, Wrench } from 'lucide-react'
import type { Alert, Incident } from '../../packages/domain/incidents.ts'
import { duration, stamp, titleFor } from './format.ts'

export function failureUrgency(alert: Alert) {
  if (alert.automatic) return 'Shut in'
  if (alert.minutesToLimit === null) return 'Awaiting reading'
  if (alert.repairMinutes !== null && alert.minutesToLimit >= alert.repairMinutes) return 'Repair first'
  return duration(alert.minutesToLimit)
}

export function AlertRail({ alerts, dismissed, selected, collapsed, loading, recent, onAlert, onReplay, onToggle }: {
  alerts: Alert[]; dismissed: ReadonlySet<string>; selected: string | null; collapsed: boolean; loading: boolean
  recent: Incident[]; onAlert: (id: string) => void; onReplay: (event: Incident) => void; onToggle: () => void
}) {
  const verified = alerts.filter((alert) => alert.verified && !dismissed.has(alert.assetId))
  const pending = alerts.filter((alert) => !alert.verified && !dismissed.has(alert.assetId))
  const dismissedAlerts = alerts.filter((alert) => dismissed.has(alert.assetId))
  function row(alert: Alert) {
    const failure = alert.category === 'pump_failure'
    const level = failure ? 'critical' : alert.category === 'pipeline_leak' ? 'warning' : 'advisory'
    return <li key={alert.assetId + alert.category}>
      <button className={'priority-item ' + level} aria-pressed={selected === alert.assetId} onClick={() => onAlert(alert.assetId)}>
        {failure ? <AlertCircle size={15} /> : <Wrench size={14} />}
        <span className="priority-copy"><span>{titleFor[alert.category]}</span><strong>{alert.assetId}</strong></span>
        <span className="priority-deadline">{failure ? failureUrgency(alert) : alert.verified ? 'Inspect' : 'Pending'}</span>
        <ChevronRight className="priority-chevron" size={12} />
      </button>
    </li>
  }
  return <aside className="priority-rail" aria-label="Priority alerts">
    <div className="workspace-pane-head">
      {!collapsed && <h2>Alert queue</h2>}
      <span className="priority-count" aria-label={verified.length + ' active alerts'}>{verified.length}</span>
      <button className="icon-btn" aria-label={collapsed ? 'Expand alert queue' : 'Collapse alert queue'} aria-expanded={!collapsed} aria-controls="priority-alerts" onClick={onToggle}>
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
      </button>
    </div>
    <div className="priority-scroll" id="priority-alerts" hidden={collapsed}>
      {loading ? <p className="queue-caption">Reading this point in the recording…</p> : verified.length ? <ul>{verified.map(row)}</ul> :
        <div className="priority-empty"><Check size={18} /><div><h3>{alerts.length ? 'No actionable alerts' : 'All clear at this recorded timestamp'}</h3>
          <p>{alerts.length ? 'Review dismissed or unverified incidents below.' : 'You’re looking at recorded network conditions.'}</p></div></div>}
      {dismissedAlerts.length > 0 && <details className="verification-queue"><summary>Dismissed <span>{dismissedAlerts.length}</span></summary><ul>{dismissedAlerts.map(row)}</ul></details>}
      {pending.length > 0 && <details className="verification-queue"><summary>Awaiting verification <span>{pending.length}</span></summary><ul>{pending.map(row)}</ul></details>}
      {!loading && verified.length === 0 && recent.length > 0 && <section className="recent-incidents">
        <h3><History size={15} /> Recent recorded incidents</h3>
        <ul>{recent.map((event) => <li key={event.assetId + event.detectedAt}>
          <button type="button" aria-label={'Replay ' + event.assetId} onClick={() => onReplay(event)}>
            <span><strong>{titleFor[event.category]}</strong><small>{event.assetId} · {stamp(event.detectedAt)}</small></span><RotateCcw size={14} />
          </button>
        </li>)}</ul>
      </section>}
    </div>
  </aside>
}
