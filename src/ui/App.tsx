import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowRight, Boxes, CircleHelp, Clock3, Database, Droplets, FlaskConical, LocateFixed, Pause, Play, Radio, Truck, Upload, X } from 'lucide-react'
import { activeAlerts, detectIncidents } from '../engine/incidents.ts'
import type { Incident } from '../engine/incidents.ts'
import { read, yardId } from '../engine/model.ts'
import type { Dataset } from '../engine/model.ts'
import { scenarioAt } from '../engine/simulate.ts'
import type { Scenario } from '../engine/simulate.ts'
import { AlertRail } from './AlertRail.tsx'
import { DecisionLab } from './DecisionLab.tsx'
import { Inspector } from './Inspector.tsx'
import { SpatialView } from './SpatialView.tsx'
import type { Scope } from './NetworkMap.tsx'
import { loadPractice, loadUpload, practiceNames } from './datasets.ts'
import { practiceLabel, stamp, utc } from './format.ts'

type Demo = { stage: 'intro' | 'first-replay' | 'first-failure' | 'cluster-replay' | 'cluster'; first: Incident; last: Incident }

function demoSequence(incidents: Incident[]) {
  const failures = incidents.filter((incident) => incident.category === 'pump_failure')
  for (const first of failures) {
    const group = failures.filter((incident) => incident.systemId === first.systemId && incident.detectedAt >= first.detectedAt &&
      incident.detectedAt <= first.detectedAt + 3600 && (first.clearedAt === null || incident.detectedAt < first.clearedAt))
    if (group.length >= 3) return { first, last: group[2] }
  }
  return failures.length ? { first: failures[0], last: failures[0] } : null
}

export function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [names, setNames] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [scope, setScope] = useState<Scope>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('Loading practice telemetry…')
  const [error, setError] = useState('')
  const [lab, setLab] = useState<{ scenario: Scenario; demo: boolean } | null>(null)
  const [demo, setDemo] = useState<Demo | null>(null)
  const request = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const incidents = useMemo(() => data ? detectIncidents(data) : [], [data])
  const at = data?.times[index] ?? 0
  const alerts = useMemo(() => data ? activeAlerts(data, incidents, at) : [], [data, incidents, at])
  const failures = alerts.filter((alert) => alert.category === 'pump_failure')
  const system = data?.systems.find((system) => system.id === scope.systemId)

  function adopt(dataset: Dataset) {
    setData(dataset)
    setIndex(dataset.times.length - 1)
    setScope({})
    setSelected(null)
    setPlaying(false)
    setDemo(null)
    setLab(null)
  }

  async function load(loader: () => Promise<Dataset>, label: string) {
    const id = ++request.current
    setStatus('Loading ' + label + '…')
    setError('')
    setPlaying(false)
    try {
      const dataset = await loader()
      if (request.current !== id) return
      adopt(dataset)
      return dataset
    } catch (error) {
      if (request.current === id) setError((error as Error).message)
    } finally {
      if (request.current === id) setStatus('')
    }
  }

  useEffect(() => {
    const id = ++request.current
    async function boot() {
      try {
        const list = await practiceNames()
        if (request.current !== id) return
        setNames(list)
        const name = list.includes('full_week') ? 'full_week' : list[0]
        if (name) {
          const dataset = await loadPractice(name)
          if (request.current === id) adopt(dataset)
        }
      } catch {
        if (request.current === id) setError('Practice files are unavailable. Import an EOG dataset or run npm run data.')
      } finally {
        if (request.current === id) setStatus('')
      }
    }
    void boot()
  }, [])

  useEffect(() => {
    if (!playing || !data) return
    const timer = window.setInterval(() => setIndex((value) => Math.min(data.times.length - 1, value + 1)), demo ? 360 : 155)
    return () => window.clearInterval(timer)
  }, [playing, data, demo])

  useEffect(() => {
    if (!demo || !playing) return
    const replay = demo.stage === 'first-replay' ? demo.first : demo.stage === 'cluster-replay' ? demo.last : null
    if (!replay || at < replay.detectedAt) return
    setPlaying(false)
    setSelected(replay.assetId)
    setFocusRequest((value) => value + 1)
    setScope({ systemId: replay.systemId, facilityId: demo.stage === 'first-replay' ? replay.facilityId : undefined })
    setDemo({ ...demo, stage: demo.stage === 'first-replay' ? 'first-failure' : 'cluster' })
  }, [at, demo, playing])

  useEffect(() => {
    if (data && index === data.times.length - 1) setPlaying(false)
  }, [data, index])

  function focus(id: string) {
    if (!data) return
    const asset = data.assets.get(id)
    const yard = data.systems.find((system) => yardId(system.id) === id)
    setSelected(id)
    setFocusRequest((value) => value + 1)
    if (asset) setScope({ systemId: asset.systemId, facilityId: asset.facilityId })
    else if (yard) setScope({ systemId: yard.id })
  }

  function navigate(next: Scope) {
    setScope(next)
    setFocusRequest((value) => value + 1)
    setSelected(next.facilityId ?? next.systemId ?? null)
  }

  function openLab(systemId: string, demoPlan = false) {
    if (!data) return
    try {
      setLab({ scenario: scenarioAt(data, alerts, systemId, at), demo: demoPlan })
      setPlaying(false)
      if (demoPlan) setDemo(null)
      setError('')
    } catch (error) { setError((error as Error).message) }
  }

  async function startDemo() {
    const source = data?.name === 'full_week' || !names.includes('full_week') ? data : await load(() => loadPractice('full_week'), 'full week')
    if (!source) return
    const sequence = demoSequence(source === data ? incidents : detectIncidents(source))
    if (!sequence) { setError('This dataset contains no detected pump failure for the guided demo.'); return }
    setPlaying(false)
    setIndex(0)
    navigate({})
    setDemo({ ...sequence, stage: 'intro' })
  }

  function demoNext() {
    if (!data || !demo) return
    if (demo.stage === 'intro') {
      const first = data.times.findIndex((time) => time >= demo.first.detectedAt - 20 * 60)
      setIndex(Math.max(0, first))
      setDemo({ ...demo, stage: 'first-replay' })
      setPlaying(true)
    } else if (demo.stage === 'first-failure' && demo.first !== demo.last) {
      setDemo({ ...demo, stage: 'cluster-replay' })
      setScope({ systemId: demo.first.systemId })
      setPlaying(true)
    } else if (demo.stage === 'first-failure' || demo.stage === 'cluster') {
      openLab(demo.first.systemId, true)
    }
  }

  function scrub(value: number) {
    setPlaying(false)
    setDemo(null)
    setIndex(value)
  }

  const wellCount = data ? [...data.facilities.values()].reduce((sum, facility) => sum + facility.wells.length, 0) : 0
  const runningWells = data ? [...data.facilities.values()].reduce((sum, facility) =>
    sum + facility.wells.filter((well) => read(data, well.id, 'status', at) === 1).length, 0) : 0
  const fleet = data?.systems.reduce((sum, system) => sum + system.fleetSize, 0)
  return <>
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Activity size={22} strokeWidth={2.6} /></div><div><strong>NIGHTWATCH</strong><small>WATER OPERATIONS CONSOLE</small></div></div>
      <div className="header-context"><span className="status-dot" /> EOG CHALLENGE <span className="head-divider" /> HACKUTD 2026</div>
      <div className="top-actions">
        <button className="soft-btn import-btn" onClick={() => input.current?.click()}><Upload size={15} /> Import data</button>
        <button className="primary-btn demo-btn" disabled={!data || Boolean(status)} onClick={() => void startDemo()}><Play size={14} fill="currentColor" /> Start Demo</button>
        <input ref={input} aria-label="Import network.json, ops.json and telemetry.csv" type="file" accept=".json,.csv" multiple hidden onChange={(event) => {
          if (event.target.files?.length) void load(() => loadUpload(event.target.files!), 'uploaded dataset')
          event.target.value = ''
        }} />
      </div>
    </header>
    <main className="workspace">
      <section className="masthead"><div><div className="eyebrow mast-label"><span className="status-dot" /> PRODUCED WATER / SHIFT MONITOR</div><h1>Water operations</h1><p>Monitor the network, investigate incidents, and compare response plans.</p></div>
        <div className="dataset-switch"><label htmlFor="dataset">DATA SOURCE</label><div><Database size={15} /><select id="dataset" value={data?.name ?? ''} onChange={(event) => void load(() => loadPractice(event.target.value), 'practice dataset')}>
          {!data && <option value="" disabled>Choose a dataset</option>}
          {data && !names.includes(data.name) && <option value={data.name}>{data.name}</option>}
          {names.map((name) => <option value={name} key={name}>{practiceLabel(name)}</option>)}
        </select></div>{data && <span><Clock3 size={12} /> Dataset end · {stamp(data.now)}</span>}</div>
      </section>
      {status && <p className="notice" role="status"><Activity size={15} />{status}</p>}
      {error && <div className="notice error-notice" role="alert"><CircleHelp size={16} /><span>{error}</span><button aria-label="Dismiss error" className="icon-btn" onClick={() => setError('')}><X size={15} /></button></div>}
      {data ? <>
        <div className="stats">
          <Stat icon={<Boxes size={18} />} label="NETWORK COVERAGE" value={String(data.systems.length)} detail={'systems · ' + data.facilities.size + ' facilities'} />
          <Stat icon={<Droplets size={18} />} label="PRODUCING WELLS" value={String(runningWells)} detail={'of ' + wellCount + ' recorded wells'} />
          <Stat icon={<Truck size={19} />} label="EMERGENCY FLEET" value={String(fleet)} detail="trucks across the network" />
          <Stat icon={<Radio size={18} />} label="ACTIVE PUMP FAULTS" value={String(failures.length)} detail={failures.length ? 'response planning available' : 'at this recorded timestamp'} hot={failures.length > 0} />
        </div>
        {demo && <div className="demo-banner"><div className="lab-symbol"><Play size={18} fill="currentColor" /></div><div><div className="eyebrow">GUIDED PRACTICE SCENARIO</div>
          <strong>{demo.stage === 'intro' ? 'The shift begins with normal operations' : demo.stage === 'first-replay' || demo.stage === 'cluster-replay' ? 'Replaying recorded telemetry' : demo.stage === 'first-failure' ? 'A pump has failed' : 'Three failures are competing for one fleet'}</strong>
          <p>{demo.stage === 'intro' ? 'Jump to the lead-up and watch the fault emerge in the recording.' : demo.stage === 'first-failure' ? 'The alert shows the fault reading, headroom, and projected time to shut-in.' : demo.stage === 'cluster' ? 'Compare an immediate priority-based response with a system-wide plan.' : 'The playhead advances in five-minute recording steps.'}</p>
        </div><button className="primary-btn" disabled={playing} onClick={demoNext}>{demo.stage === 'intro' ? 'Replay the lead-up' : demo.stage === 'first-failure' && demo.first !== demo.last ? 'Show shared fleet pressure' : 'Compare responses'}<ArrowRight size={15} /></button><button className="icon-btn" aria-label="Exit demo" onClick={() => { setDemo(null); setPlaying(false) }}><X size={17} /></button></div>}
        <div className="console">
          <AlertRail alerts={alerts} selected={selected} onAlert={focus} />
          <section className="panel network-panel" aria-label="Water network">
            <div className="panel-head network-head"><div><span className="eyebrow">SPATIAL OVERVIEW</span><h2>{scope.facilityId ? 'Facility view' : scope.systemId ? 'System view' : 'Network view'}</h2></div>
              <button className="small-btn" onClick={() => navigate({})}><LocateFixed size={14} /> Overview</button></div>
            <nav className="map-nav" aria-label="Network views">
              <button className={!scope.systemId ? 'current' : ''} onClick={() => navigate({})}>Network</button><span>/</span>
              <select aria-label="Select system" value={scope.systemId ?? ''} onChange={(event) => navigate(event.target.value ? { systemId: event.target.value } : {})}>
                <option value="">All systems</option>{data.systems.map((item) => <option key={item.id}>{item.id}</option>)}</select>
              {system && <><span>/</span><select aria-label="Select facility" value={scope.facilityId ?? ''} onChange={(event) => navigate({ systemId: system.id, facilityId: event.target.value || undefined })}>
                <option value="">All facilities</option>{system.facilities.map((facility) => <option key={facility.id}>{facility.id}</option>)}</select></>}
            </nav>
            <div className="map-container"><SpatialView focusRequest={focusRequest} data={data} at={at} scope={scope} selected={selected} alerts={alerts} onSelect={setSelected} onFocus={focus} /></div>
            <div className="map-footer"><span><i className="legend-dot water" /> Produced water</span><span><i className="legend-dot fault" /> Pump fault</span><span><i className="legend-dot inspect" /> Inspection</span></div>
          </section>
          <Inspector data={data} at={at} selected={selected} alerts={alerts} onSelect={setSelected} onFocus={focus} onLab={openLab} />
        </div>
        <section className="panel timeline" aria-label="Historical playback">
          <div className="timeline-title"><div className="timeline-icon"><Clock3 size={19} /></div><div><h2>Recording timeline</h2><span className="tag">Recorded</span></div></div>
          <button className="icon-btn timeline-play" aria-label={playing ? 'Pause historical playback' : 'Play historical playback'} onClick={() => {
            setDemo(null)
            if (!playing && index >= data.times.length - 1) setIndex(0)
            setPlaying(!playing)
          }}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
          <div className="timeline-track"><input type="range" aria-label="Recorded timestamp" aria-valuetext={stamp(at)} min="0" max={data.times.length - 1} value={index} onChange={(event) => scrub(+event.target.value)} /><div><span>{stamp(data.start)}</span><span>{stamp(data.now)}</span></div></div>
          <div className="timeline-at"><strong>{utc(at)}</strong><span>{at === data.now ? 'Latest recorded' : stamp(at).split(',')[0]}</span></div>
          <button className="small-btn" onClick={() => scrub(data.times.length - 1)}>Latest</button>
        </section>
        <footer className="workspace-foot"><span>NIGHTWATCH / EOG PRODUCED WATER</span><span><FlaskConical size={13} /> Decision Lab compares hypothetical interventions</span></footer>
      </> : <section className="panel welcome"><div className="empty-glyph"><Database size={26} /></div><h2>Load a network</h2><p>Select the three EOG files together to build the network and analyze its recorded telemetry.</p><button className="primary-btn" onClick={() => input.current?.click()}><Upload size={15} /> Import dataset</button></section>}
    </main>
    {lab && <DecisionLab scenario={lab.scenario} demo={lab.demo} onClose={() => setLab(null)} />}
  </>
}

function Stat({ icon, label, value, detail, hot }: { icon: React.ReactNode; label: string; value: string; detail: string; hot?: boolean }) {
  return <article className={'stat' + (hot ? ' stat-hot' : '')}><div className="stat-icon">{icon}</div><div><span className="eyebrow">{label}</span><div><strong>{value}</strong><small>{detail}</small></div></div></article>
}
