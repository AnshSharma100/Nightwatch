import { Activity, ArrowUpRight, ChevronRight, Clock3, LocateFixed, Waves, X } from 'lucide-react'
import { useState } from 'react'
import { read, sensorMetrics, windowed, yardId } from '../engine/model.ts'
import type { Asset, Dataset, Metric } from '../engine/model.ts'
import type { Alert } from '../engine/incidents.ts'
import type { Optimization } from '../engine/optimize.ts'
import type { Scenario } from '../engine/simulate.ts'
import { duration, money, number, stamp, titleFor, utc } from './format.ts'
import { failureUrgency } from './AlertRail.tsx'
import { Trace } from './Trace.tsx'
import { fieldResponse } from '../engine/field-response.ts'
import { SystemInvestigator } from './NemotronPanel.tsx'

const metricLabels: Record<Metric, string> = {
  status: 'Status code', water_bpd: 'Water production (bbl/day)', inflow_bpd: 'Tank inflow (bbl/day)',
  level_pct: 'Tank fill (%)', flow_bpd: 'Pump discharge (bbl/day)', discharge_psi: 'Discharge pressure (psi)',
  receive_flow_bpd: 'Receiving flow (bbl/day)', pressure_psi: 'Receiving pressure (psi)',
}
const assetLabels = { system: 'System', facility: 'Facility', tank: 'Storage tank', pump: 'Transfer pump', pipeline: 'Pipeline', well: 'Production well', disposal: 'Disposal site', yard: 'Truck yard' }
type Planning = { scenario: Scenario; search: Optimization }

function SensorTrend({ data, asset, at }: { data: Dataset; asset: Asset; at: number }) {
  const metrics = sensorMetrics[asset.kind] ?? []
  const [choice, setChoice] = useState<Metric | undefined>()
  const metric = choice ?? (asset.kind === 'pump' ? 'flow_bpd' : metrics[0])
  if (!metric) return null
  const start = Math.max(data.start, at - 6 * 3600)
  const points = windowed(data, asset.id, metric, start, at)
  return <div className="inspector-section">
    <select aria-label="Sensor metric" value={metric} onChange={(event) => setChoice(event.target.value as Metric)}>
      {metrics.map((item) => <option key={item} value={item}>{metricLabels[item]}</option>)}
    </select>
    {points.length ? <Trace lines={[{ label: metricLabels[metric], color: 'var(--teal)', points }]} xStart={start} xEnd={at} timeLabel={utc} label={metricLabels[metric] + ' over the last six recorded hours'}
      min={metric === 'level_pct' || metric === 'status' ? 0 : undefined} max={metric === 'level_pct' ? 100 : metric === 'status' ? asset.kind === 'pump' ? 2 : 1 : undefined}
      threshold={metric === 'level_pct' ? data.shutdownPct : undefined} /> : <p className="muted">No readings in this window.</p>}
    <div className="sensor-current"><span>Latest at playhead</span><strong>{number(read(data, asset.id, metric, at), 2)}</strong></div>
  </div>
}

function IncidentTrend({ data, at, alert }: { data: Dataset; at: number; alert: Alert }) {
  const facility = data.facilities.get(alert.facilityId)!
  if (alert.category === 'pump_failure') return null
  const start = Math.max(data.start, alert.onset - 3 * 3600)
  const running = windowed(data, facility.pump.id, 'flow_bpd', start, at)
    .filter((point) => read(data, facility.pump.id, 'status', point.at) === 1)
  if (!running.length) return null
  const wear = alert.category === 'pump_degradation'
  const points = running.flatMap((point) => {
    if (wear) return [{ at: point.at, value: point.value / facility.pump.maxFlowBpd * 100 }]
    const receive = read(data, facility.pipeline.id, 'receive_flow_bpd', point.at)
    return receive === undefined || point.value <= 0 ? [] : [{ at: point.at, value: (point.value - receive) / point.value * 100 }]
  })
  const label = wear ? 'Discharge as % of rated flow' : 'Discharge lost before receiving (%)'
  return <div className="incident-trend">
    <h4>{label}</h4>
    <Trace lines={[{ label, color: 'var(--teal)', points }]} xStart={start} xEnd={at} timeLabel={utc}
      threshold={wear ? 97.5 : 1.2} cursor={alert.onset} label={label + ' during running samples'} />
    <p className="muted">Running samples only · Marker at first abnormal sample · Dashed line at {wear ? '97.5%' : '1.2%'}</p>
  </div>
}

function Response({ alert, planning, onLab }: { alert: Alert; planning: Planning | null; onLab: (id: string) => void }) {
  const failure = planning?.scenario.failures.find((item) => item.facility.id === alert.facilityId)
  const jobs = planning?.search.best.jobs.filter((job) => job.facilityId === alert.facilityId) ?? []
  const shutIns = planning?.search.best.plan.shutIns.filter((stop) => failure?.facility.wells.some((well) => well.id === stop.wellId)) ?? []
  const result = planning?.search.best.facilities.find((item) => item.facilityId === alert.facilityId)
  const baseline = planning?.search.baseline.facilities.find((item) => item.facilityId === alert.facilityId)
  return <section className="inspector-response">
    <h4>Recommended response</h4>
    {jobs.length + shutIns.length > 0 ? <ul>
      {jobs.map((job) => <li key={job.truck + ':' + job.dispatchMin}>Truck {job.truck} · {job.trips} {job.trips === 1 ? 'trip' : 'trips'} · first arrival in {duration(job.arrivals[0])}</li>)}
      {shutIns.map((stop) => <li key={stop.wellId}>Shut in {stop.wellId} at +{duration(stop.startMin)}</li>)}
    </ul> : <p>{!result ? 'Compare feasible actions for this system.' : alert.automatic ? 'Monitor through repair. Wells are already shut in.' :
      result.autoAt === null ? 'Monitor through repair.' : 'Allow automatic shut-in through repair.'}</p>}
    {baseline && <p className="baseline-loss">{money(baseline.costs.oil + baseline.costs.gas)} projected lost revenue here without action</p>}
    {result && <p className="baseline-loss">{money(result.costs.total)} recommended cost here · oil, gas and trucking</p>}
    <button className="primary-btn" onClick={() => onLab(alert.systemId)}>Compare response plans <ArrowUpRight size={15} /></button>
  </section>
}

export function Inspector({ data, at, selected, alerts, planning, onSelect, onLab, onClose, workflow, onBriefing }: {
  data: Dataset; at: number; selected: string | null; alerts: Alert[]; planning: Planning | null
  onSelect: (id: string) => void; onLab: (systemId: string) => void; onClose: () => void
  workflow?: (alert: Alert, response: string) => React.ReactNode
  onBriefing?: (alert: Alert, draft: string) => void
}) {
  const yard = data.systems.find((system) => yardId(system.id) === selected)
  const asset: Asset | undefined = (selected ? data.assets.get(selected) : undefined) ??
    (yard ? { id: selected!, kind: 'yard', systemId: yard.id } : undefined)
  const system = data.systems.find((system) => system.id === asset?.systemId)
  const facility = asset?.facilityId ? data.facilities.get(asset.facilityId) : undefined
  const alert = alerts.find((item) => item.assetId === selected) ??
    (asset?.kind === 'facility' ? alerts.find((item) => item.facilityId === asset.facilityId) : undefined)
  const fill = facility ? read(data, facility.tank.id, 'level_pct', at) : undefined
  const state = facility ? read(data, facility.pump.id, 'status', at) : undefined
  const configuredInflow = facility?.wells.reduce((sum, well) => sum + well.baselineWaterBpd, 0)
  const headroom = facility && fill !== undefined ? Math.max(0, data.shutdownPct - fill) / 100 * facility.tank.capacityBbl : undefined
  const well = facility?.wells.find((well) => well.id === selected)
  const failure = alert?.category === 'pump_failure'
  const approved = alert && facility ? fieldResponse(alert, facility, planning?.search.best) : ''
  return <aside id="asset-inspector" className="operator-inspector" aria-label="Asset inspector">
    <div className="workspace-pane-head"><h2>Inspector</h2><button className="stage-inspector-toggle" aria-label="Close inspector" onClick={onClose}><X size={17} /></button></div>
    {!asset ? <div className="inspector-empty"><LocateFixed size={22} /><h3>Inspect the network</h3><p>{data.systems.length} systems · {data.facilities.size} facilities</p>
      <div className="system-links">{data.systems.map((item) => <button key={item.id} className="asset-link" onClick={() => onSelect(item.id)}>{item.id}<ChevronRight size={14} /></button>)}</div></div> :
      <div className="inspector-content" key={asset.id}>
        <header className="asset-heading"><div className={'asset-type' + (failure ? ' failure-type' : '')}>{alert ? titleFor[alert.category] : assetLabels[asset.kind]}</div>
          <h3>{asset.kind === 'yard' ? 'Emergency truck yard' : asset.id}</h3>
          <p>{[asset.systemId, facility?.id !== asset.id ? facility?.id : undefined].filter(Boolean).join(' / ')}</p>
        </header>
        {alert && failure && <section className="incident-forecast" aria-label="Shutdown forecast">
          <div><span><Clock3 size={13} /> Shut-in forecast</span><strong>{failureUrgency(alert)}</strong></div>
          <div><span>Repair remaining</span><strong>{duration(alert.repairMinutes)}</strong></div>
          <div><span>Facility revenue rate</span><strong>{money(alert.revenuePerHour)}/hr</strong></div>
        </section>}
        {alert && failure && <Response alert={alert} planning={planning} onLab={onLab} />}
        {alert && !failure && <section className="inspector-response"><h4>Field inspection</h4><p>{alert.category === 'pipeline_leak' && alert.verified ? 'Urgent · Inspect the pipeline.' : alert.verified ? 'Inspect the pump for wear.' : 'Await another running sample before escalation.'}</p></section>}
        {alert && <details className="inspector-fold evidence-fold" open={!failure || undefined}>
          <summary><Activity size={15} /> Detection evidence</summary>
          <div className="inspector-section">
            <dl className="values"><dt>First abnormal</dt><dd>{stamp(alert.onset)}</dd><dt>First flagged</dt><dd>{stamp(alert.detectedAt)}</dd>
              <dt>Observed duration</dt><dd>{duration((at - alert.onset) / 60)}</dd></dl>
            <ul>{alert.evidence.map((line) => <li key={line}>{line}</li>)}</ul>
            {failure && !alert.automatic && headroom !== undefined && <p className="muted">The estimate divides {number(headroom)} bbl of headroom by {number(configuredInflow)} bbl/day of configured inflow.</p>}
            <IncidentTrend data={data} at={at} alert={alert} />
          </div>
        </details>}
        {workflow && alert && workflow(alert, approved)}
        {system && alert && <SystemInvestigator key={system.id + ':' + at} data={data} at={at} systemId={system.id} facilityId={facility?.id} onDraft={onBriefing ? (draft) => onBriefing(alert, draft) : undefined} />}
        {facility && <details className="inspector-fold" open={!alert || undefined}>
          <summary><Waves size={15} /> Facility conditions</summary>
          <div className="inspector-section">
            <div className="sensor-current"><span>Tank fill</span><strong>{number(fill)}{fill === undefined ? '' : '%'}</strong></div>
            <div className="fill-track"><i style={{ width: Math.max(0, Math.min(100, fill ?? 0)) + '%' }} /><b style={{ left: data.shutdownPct + '%' }} /></div>
            <dl className="values"><dt>Shutdown limit</dt><dd>{data.shutdownPct}% · {number(facility.tank.capacityBbl * data.shutdownPct / 100)} bbl</dd>
              <dt>Tank capacity</dt><dd>{number(facility.tank.capacityBbl, 0)} bbl</dd>
              <dt>Pump state</dt><dd>{state === 2 ? 'Fault' : state === 1 ? 'Running' : state === 0 ? 'Stopped' : 'Unavailable'}</dd>
              <dt>Truck response</dt><dd>{duration(facility.trucking.responseMin)}</dd>
              {asset.kind === 'pump' && <><dt>Rated flow</dt><dd>{number(facility.pump.maxFlowBpd)} bbl/day</dd><dt>Start / stop</dt><dd>{facility.pump.startPct}% / {facility.pump.stopPct}%</dd></>}
              {asset.kind === 'pipeline' && <><dt>Rated flow</dt><dd>{number(facility.pipeline.maxBpd)} bbl/day</dd><dt>Disposal</dt><dd>{system?.disposal.id}</dd></>}
              {well && <><dt>Configured production</dt><dd>{number(well.oilBpd)} bbl oil/day<br />{number(well.gasMcfd)} mcf gas/day</dd><dt>Revenue</dt><dd>{money(well.revenuePerHour)}/hr</dd></>}
            </dl>
          </div>
        </details>}
        {system && ['system', 'disposal', 'yard'].includes(asset.kind) && <section className="inspector-section">
          <h4>System configuration</h4><dl className="values"><dt>Emergency fleet</dt><dd>{system.fleetSize} trucks</dd><dt>Trip capacity</dt><dd>{number(data.truckCapacityBbl)} bbl</dd><dt>Trip price</dt><dd>{money(data.truckCost)}</dd><dt>Disposal pressure</dt><dd>{number(system.disposal.pressurePsi)} psi</dd></dl>
          {system.facilities.map((item) => <button key={item.id} className="asset-link" onClick={() => onSelect(item.id)}>{item.id}<ChevronRight size={13} /></button>)}
          {planning && <button className="small-btn" onClick={() => onLab(system.id)}>Compare response plans</button>}
        </section>}
        {sensorMetrics[asset.kind]?.length && <details className="inspector-fold"><summary><Activity size={15} /> Recorded sensor history</summary><SensorTrend data={data} at={at} asset={asset} /></details>}
        {facility && <details className="inspector-fold"><summary>Connected equipment</summary><div className="inspector-section">
          {[facility.tank.id, facility.pump.id, facility.pipeline.id, ...facility.wells.map((item) => item.id)].filter((id) => id !== selected).map((id) =>
            <button className="asset-link" key={id} onClick={() => onSelect(id)}>{id}<ChevronRight size={13} /></button>)}
        </div></details>}
      </div>}
  </aside>
}
