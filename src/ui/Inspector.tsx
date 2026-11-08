import { Activity, ArrowUpRight, Box, ChevronRight, Clock3, LocateFixed, Waves } from 'lucide-react'
import { useState } from 'react'
import { read, sensorMetrics, windowed, yardId } from '../engine/model.ts'
import type { Asset, Dataset, Metric, System } from '../engine/model.ts'
import type { Alert } from '../engine/incidents.ts'
import { duration, money, number, stamp, titleFor, utc } from './format.ts'
import { Trace } from './Trace.tsx'

const metricLabels: Record<Metric, string> = {
  status: 'Status code', water_bpd: 'Water production (bbl/day)', inflow_bpd: 'Tank inflow (bbl/day)',
  level_pct: 'Tank fill (%)', flow_bpd: 'Pump discharge (bbl/day)', discharge_psi: 'Discharge pressure (psi)',
  receive_flow_bpd: 'Receiving flow (bbl/day)', pressure_psi: 'Receiving pressure (psi)',
}
export const assetLabels = { system: 'System', facility: 'Facility', tank: 'Storage tank', pump: 'Transfer pump', pipeline: 'Pipeline', well: 'Production well', disposal: 'Disposal site', yard: 'Truck yard' }

export function SensorTrend({ data, asset, at }: { data: Dataset; asset: Asset; at: number }) {
  const metrics = sensorMetrics[asset.kind] ?? []
  const [choice, setChoice] = useState<Metric | undefined>()
  const metric = choice ?? (asset.kind === 'pump' ? 'flow_bpd' : metrics[0])
  if (!metric) return null
  const start = Math.max(data.start, at - 6 * 3600)
  const points = windowed(data, asset.id, metric, start, at)
  return <section className="inspector-section">
    <h3><Activity size={14} /> Sensor history <span className="tag">Recorded</span></h3>
    <select aria-label="Sensor metric" value={metric} onChange={(event) => setChoice(event.target.value as Metric)}>
      {metrics.map((item) => <option key={item} value={item}>{metricLabels[item]}</option>)}
    </select>
    {points.length ? <Trace lines={[{ label: metricLabels[metric], color: 'var(--teal)', points }]} xStart={start} xEnd={at} timeLabel={utc} label={metricLabels[metric] + ' over the last six recorded hours'}
      min={metric === 'level_pct' || metric === 'status' ? 0 : undefined} max={metric === 'level_pct' ? 100 : metric === 'status' ? asset.kind === 'pump' ? 2 : 1 : undefined}
      threshold={metric === 'level_pct' ? data.shutdownPct : undefined} /> : <p className="muted">No readings in this window.</p>}
    <div className="sensor-current"><span>Latest at playhead</span><strong>{number(read(data, asset.id, metric, at), 2)}</strong></div>
  </section>
}

export function Inspector({ data, at, selected, alerts, onSelect, onFocus, onLab }: {
  data: Dataset; at: number; selected: string | null; alerts: Alert[]
  onSelect: (id: string) => void; onFocus: (id: string) => void; onLab: (systemId: string) => void
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
  const failures = system ? alerts.filter((item) => item.systemId === system.id && item.category === 'pump_failure') : []
  return <aside className="panel inspector" aria-label="Asset inspector">
    <div className="panel-head"><div><span className="eyebrow">DETAIL VIEW</span><h2>Asset inspector</h2></div><Box size={17} className="muted" /></div>
    {!asset ? <div className="inspector-empty"><div className="empty-glyph"><LocateFixed size={25} /></div><h3>Inspect the network</h3><p>Select an alert or a piece of equipment to view recorded readings, operating limits, and response options.</p>
      <div className="system-links">{data.systems.map((system) => <SystemLink key={system.id} system={system} onFocus={onFocus} />)}</div></div> :
      <div className="inspector-content">
        <header className="asset-heading"><div className="asset-type">{assetLabels[asset.kind]} <span> / </span> {asset.systemId}</div>
          <h3>{asset.kind === 'yard' ? 'Emergency truck yard' : asset.id}</h3><button className="small-btn" onClick={() => onFocus(asset.id)}><LocateFixed size={13} /> Focus asset</button>
        </header>
        {alert && <section className={'inspector-section evidence ' + (alert.category === 'pump_failure' ? 'critical' : 'warning')}>
          <h3><Activity size={15} /> {titleFor[alert.category]}</h3>
          <p className="muted">First flagged {stamp(alert.detectedAt)}</p>
          {!alert.verified && <p className="warning-text">Awaiting fresh evidence while the pump cycles.</p>}
          <ul>{alert.evidence.map((line) => <li key={line}>{line}</li>)}</ul>
          {alert.category === 'pump_failure' ? <div className="forecast">
            <div><Clock3 size={14} /><span>{alert.automatic ? 'Automatic shut-in' : 'To shutdown limit'}</span><strong>{alert.automatic ? 'Latched' : duration(alert.minutesToLimit)}</strong></div>
            <div><span>Repair remaining</span><strong>{duration(alert.repairMinutes)}</strong></div>
            {!alert.automatic && headroom !== undefined && <div><span>{number(headroom)} bbl headroom</span><strong>{number(configuredInflow)} bbl/day</strong></div>}
            <p>{alert.automatic ? 'The wells stay shut until repair.' : 'Headroom ÷ configured well water production, with pump flow at zero.'}</p>
          </div> : <p className="inspection-action">Response · Field inspection{alert.category === 'pipeline_leak' ? ' now' : ''}</p>}
        </section>}
        {system && failures.length > 0 && <section className="inspector-section lab-action"><button className="primary-btn" onClick={() => onLab(system.id)}>Open Decision Lab <ArrowUpRight size={15} /></button><p>{failures.length} failed {failures.length === 1 ? 'pump' : 'pumps'} · {system.fleetSize} shared trucks</p></section>}
        {facility && <section className="inspector-section">
          <h3><Waves size={14} /> Facility conditions <span className="tag">Recorded</span></h3>
          <div className="sensor-current"><span>Tank fill</span><strong>{number(fill)}{fill === undefined ? '' : '%'}</strong></div>
          <div className="fill-track"><i style={{ width: Math.max(0, Math.min(100, fill ?? 0)) + '%', background: fill !== undefined && fill >= data.warningPct ? 'var(--amber)' : undefined }} /><b style={{ left: data.shutdownPct + '%' }} /></div>
          <dl className="values"><dt>Shutdown limit</dt><dd>{data.shutdownPct}% · {number(facility.tank.capacityBbl * data.shutdownPct / 100)} bbl</dd>
            <dt>Tank capacity</dt><dd>{number(facility.tank.capacityBbl, 0)} bbl</dd>
            <dt>Pump state</dt><dd>{state === 2 ? 'Fault' : state === 1 ? 'Running' : state === 0 ? 'Stopped' : 'Unavailable'}</dd>
            <dt>Truck response</dt><dd>{duration(facility.trucking.responseMin)}</dd>
            {asset.kind === 'pump' && <><dt>Rated flow</dt><dd>{number(facility.pump.maxFlowBpd)} bbl/day</dd><dt>Start / stop</dt><dd>{facility.pump.startPct}% / {facility.pump.stopPct}%</dd></>}
            {asset.kind === 'pipeline' && <><dt>Rated flow</dt><dd>{number(facility.pipeline.maxBpd)} bbl/day</dd><dt>Disposal</dt><dd>{system?.disposal.id}</dd></>}
            {well && <><dt>Configured production</dt><dd>{number(well.oilBpd)} bbl oil/day<br />{number(well.gasMcfd)} mcf gas/day</dd><dt>Revenue</dt><dd>{money(well.revenuePerHour)}/h</dd></>}
          </dl>
        </section>}
        {system && (asset.kind === 'yard' || asset.kind === 'system' || asset.kind === 'disposal') && <section className="inspector-section">
          <h3>System configuration</h3><dl className="values"><dt>Emergency fleet</dt><dd>{system.fleetSize} trucks</dd><dt>Trip capacity</dt><dd>{number(data.truckCapacityBbl)} bbl</dd><dt>Trip price</dt><dd>{money(data.truckCost)}</dd><dt>Disposal pressure</dt><dd>{number(system.disposal.pressurePsi)} psi</dd></dl>
          {system.facilities.map((item) => <button key={item.id} className="asset-link" onClick={() => onFocus(item.id)}>{item.id}<ChevronRight size={13} /></button>)}
        </section>}
        <SensorTrend key={asset.id} data={data} at={at} asset={asset} />
        {facility && <section className="inspector-section"><h3>Connected equipment</h3>
          {[facility.tank.id, facility.pump.id, facility.pipeline.id, ...facility.wells.map((well) => well.id)].filter((id) => id !== selected).map((id) =>
            <button className="asset-link" key={id} onClick={() => onSelect(id)}>{id}<ChevronRight size={13} /></button>)}
        </section>}
      </div>}
  </aside>
}

function SystemLink({ system, onFocus }: { system: System; onFocus: (id: string) => void }) {
  return <button className="asset-link" onClick={() => onFocus(system.id)}><span>{system.id} <small>{system.facilities.length} facilities</small></span><ChevronRight size={14} /></button>
}
