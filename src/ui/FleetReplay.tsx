import { useMemo } from 'react'
import { Truck } from 'lucide-react'
import type { Outcome, Scenario, ScheduledJob } from '../engine/simulate.ts'
import { frameAt } from '../engine/simulate.ts'
import { duration, number } from './format.ts'

type Point = [number, number]

function position(job: ScheduledJob, minute: number) {
  const index = job.arrivals.findIndex((arrival) => minute < arrival)
  const first = job.arrivals[0]
  if (minute < first) return (minute - job.dispatchMin) / (first - job.dispatchMin)
  if (index !== -1) {
    const previous = job.arrivals[index - 1]
    return Math.abs(1 - 2 * (minute - previous) / (job.arrivals[index] - previous))
  }
  const last = job.arrivals.at(-1)!
  return 1 - (minute - last) / (job.freeMin - last)
}

export function FleetReplay({ scenario, outcome, minute, title, color }: {
  scenario: Scenario; outcome: Outcome; minute: number; title: string; color: string
}) {
  const { yard, sites } = useMemo(() => {
    const coords = [scenario.system.truckYard, ...scenario.failures.map((item) => item.facility.location)]
    const latitudes = coords.map(([lat]) => lat)
    const longitudes = coords.map(([, lon]) => lon)
    const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes)
    const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes)
    const raw: Point[] = coords.map(([lat, lon]) => [
      42 + 374 * (maxLon === minLon ? .5 : (lon - minLon) / (maxLon - minLon)),
      28 + 80 * (maxLat === minLat ? .5 : (maxLat - lat) / (maxLat - minLat)),
    ])
    const count = raw.length
    for (let pass = 0; pass < 12; pass++) {
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = raw[j][0] - raw[i][0] || .01
          const dy = raw[j][1] - raw[i][1] || .01
          const distance = Math.hypot(dx, dy)
          if (distance >= 43) continue
          const amount = (43 - distance) / distance / 2
          raw[i][0] -= dx * amount
          raw[i][1] -= dy * amount
          raw[j][0] += dx * amount
          raw[j][1] += dy * amount
        }
      }
    }
    return { yard: raw[0], sites: new Map(scenario.failures.map(({ facility }, index) => [facility.id, raw[index + 1]])) }
  }, [scenario])
  const busy = outcome.jobs.filter((job) => job.dispatchMin <= minute && minute < job.freeMin)
  return <article className="fleet-replay" style={{ '--branch-color': color } as React.CSSProperties}>
    <header><Truck size={15} /><strong>{title}</strong><span>{busy.length}/{scenario.system.fleetSize} trucks occupied</span></header>
    <svg viewBox="0 0 460 139" role="img" aria-label={title + ' schematic truck and tank playback'}>
      <defs><pattern id={'grid-' + title} width="17" height="17" patternUnits="userSpaceOnUse"><path d="M 17 0 L 0 0 0 17" fill="none" stroke="#29424a" strokeWidth=".5" /></pattern></defs>
      <rect width="460" height="139" fill={'url(#grid-' + title + ')'} />
      {[...sites].map(([id, [x, y]]) => <path key={id} d={'M ' + yard[0] + ' ' + yard[1] + ' L ' + x + ' ' + y} stroke="#526c70" strokeDasharray="3 4" />)}
      <g transform={'translate(' + yard.join(' ') + ')'}><rect x="-13" y="-10" width="26" height="20" rx="4" fill="#273f46" stroke="#668687" /><text y="3" textAnchor="middle">YARD</text></g>
      {scenario.failures.map(({ facility }, index) => {
        const [x, y] = sites.get(facility.id)!
        const frame = frameAt(outcome.facilities[index].frames, minute)!
        const pct = frame.bbl / facility.tank.capacityBbl * 100
        const height = Math.min(20, pct * .2)
        return <g key={facility.id} transform={'translate(' + x + ' ' + y + ')'}>
          <title>{facility.id} · {number(pct)}% tank fill</title>
          <rect x="-11" y="-12" width="22" height="24" rx="4" fill="#183039" stroke={frame.automatic ? 'var(--coral)' : '#729290'} />
          <rect x="-9" y={10 - height} width="18" height={height} rx="1.5" fill={frame.automatic ? 'var(--coral)' : color} />
          <text y="23" textAnchor="middle">{facility.id.split('_').at(-1)} · {number(pct, 0)}%</text>
        </g>
      })}
      {busy.map((job) => {
        const [x, y] = sites.get(job.facilityId)!
        const progress = position(job, minute)
        return <g key={job.truck} transform={'translate(' + (yard[0] + (x - yard[0]) * progress) + ' ' + (yard[1] + (y - yard[1]) * progress - 12) + ')'}>
          <title>Truck {job.truck} · {job.facilityId} · free +{duration(job.freeMin)}</title>
          <rect x="-8" y="-5" width="16" height="10" rx="3" fill={color} stroke="#17282b" />
          <text y="2.8" textAnchor="middle" className="truck-number">{job.truck}</text>
        </g>
      })}
    </svg>
    <footer>{busy.length ? busy.map((job) => 'Truck ' + job.truck + ' · ' + job.facilityId).join(' / ') : 'All trucks at the yard'}</footer>
  </article>
}
