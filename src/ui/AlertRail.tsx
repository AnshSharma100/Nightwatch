import { AlertCircle, Check, ChevronRight, Wrench } from 'lucide-react'
import type { Alert } from '../engine/incidents.ts'
import { duration, titleFor } from './format.ts'

export function failureUrgency(alert: Alert) {
  if (alert.automatic) return 'Shut in'
  if (alert.minutesToLimit === null) return 'Awaiting reading'
  if (alert.repairMinutes !== null && alert.minutesToLimit >= alert.repairMinutes) return 'Repair first'
  return duration(alert.minutesToLimit)
}

export function AlertRail({ alerts, dismissed, selected, onAlert }: {
  alerts: Alert[]; dismissed: ReadonlySet<string>; selected: string | null; onAlert: (id: string) => void
}) {
  const verified = alerts.filter((alert) => alert.verified && !dismissed.has(alert.assetId))
  const pending = alerts.filter((alert) => !alert.verified && !dismissed.has(alert.assetId))
  const dismissedAlerts = alerts.filter((alert) => dismissed.has(alert.assetId))
  function card(alert: Alert) {
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
    <div className="workspace-pane-head"><h2>Priority alerts</h2><span className="priority-count">{verified.length}</span></div>
    <div className="priority-scroll">
      {verified.length ? <ul>{verified.map(card)}</ul> : <div className="priority-empty"><Check size={17} /><div><h3>No active alerts</h3><p>At this recorded timestamp</p></div></div>}
      {dismissedAlerts.length > 0 && <details className="verification-queue"><summary>Dismissed <span>{dismissedAlerts.length}</span></summary><ul>{dismissedAlerts.map(card)}</ul></details>}
      {pending.length > 0 && <details className="verification-queue"><summary>Awaiting verification <span>{pending.length}</span></summary><ul>{pending.map(card)}</ul></details>}
    </div>
  </aside>
}
