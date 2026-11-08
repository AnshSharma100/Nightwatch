import { ArrowUpRight, Box, Factory, Truck } from 'lucide-react'
import { read, yardId } from '../../packages/domain/model.ts'
import type { Dataset } from '../../packages/domain/model.ts'
import type { Alert } from '../../packages/domain/incidents.ts'
import { number } from './format.ts'

export interface Scope { systemId?: string; facilityId?: string }
export interface MapProps {
  data: Dataset; at: number; scope: Scope; selected: string | null; alerts: Alert[]
  onSelect: (id: string) => void; onFocus: (id: string) => void
}

export function NetworkMap({ data, at, scope, selected, alerts, onSelect, onFocus }: MapProps) {
  const systems = data.systems.filter((system) => !scope.systemId || system.id === scope.systemId)
  return <div className="fallback-map">
    {systems.map((system) => <section className="map-system" key={system.id}>
      <button className="map-system-title" onClick={() => onFocus(system.id)}><Factory size={19} /><span>{system.id}</span><small>{system.facilities.length} facilities</small><ArrowUpRight size={15} /></button>
      <div className="map-facilities">{system.facilities.filter((facility) => !scope.facilityId || facility.id === scope.facilityId).map((facility) => {
        const alarm = alerts.find((item) => item.facilityId === facility.id)
        const fill = read(data, facility.tank.id, 'level_pct', at)
        return <article className={'map-facility' + (alarm ? ' flagged' : '')} key={facility.id}>
          <button onClick={() => onFocus(facility.id)} className="map-facility-title"><Box size={14} /> {facility.id}<ArrowUpRight size={13} /></button>
          <span>{number(fill)}{fill === undefined ? '' : '%'} tank fill · {facility.wells.length} wells</span>
          <div className="map-assets">{[facility.tank, facility.pump, facility.pipeline, ...facility.wells].map((asset, i) =>
            <button className={asset.id === selected ? 'chosen' : ''} key={asset.id} onClick={() => onSelect(asset.id)}>{['Tank', 'Pump', 'Pipeline'][i] ?? 'Well ' + (i - 2)}</button>)}</div>
        </article>
      })}</div>
      <div className="map-shared"><button className="small-btn" onClick={() => onSelect(system.disposal.id)}>Disposal site</button><button className="small-btn" onClick={() => onSelect(yardId(system.id))}><Truck size={14} /> {system.fleetSize} truck slots</button></div>
    </section>)}
  </div>
}
