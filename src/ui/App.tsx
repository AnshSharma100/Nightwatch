import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowRight, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Clock3, Database, LockKeyhole, PanelRight, Pause, Play, Upload, X } from 'lucide-react'
import type { Alert, Incident } from '../../packages/domain/incidents.ts'
import { yardId } from '../../packages/domain/model.ts'
import type { Dataset } from '../../packages/domain/model.ts'
import type { PlanComparison, RecordedSnapshot } from '../../packages/contracts/operations.ts'
import { AlertRail } from './AlertRail.tsx'
import { DecisionLab } from './DecisionLab.tsx'
import { Inspector } from './Inspector.tsx'
import { IncidentWorkflow, SignIn } from './IncidentWorkflow.tsx'
import { useWorkflow } from './useWorkflow.ts'
import { caseFromAlert, caseKey } from '../../packages/domain/workflow.ts'
import { OperationsStrip } from './OperationsStrip.tsx'
import { SpatialView } from './SpatialView.tsx'
import type { Scope } from './NetworkMap.tsx'
import { comparePlans, loadPractice, loadRecording, loadUpload, practiceNames, recordedSnapshot, recordingId, registerInvestigationDataset } from './datasets.ts'
import type { LoadedRecording } from './datasets.ts'
import { practiceLabel, stamp } from './format.ts'
import { BrandMark, ThemeToggle, useTheme } from './Theme.tsx'
import './workspace.css'

type Demo = { stage: 'intro' | 'first-replay' | 'first-failure' | 'cluster-replay' | 'cluster'; first: Incident; last: Incident }

const noAlerts: Alert[] = []
const labPath = '/decision-lab'
const currentLabRoute = () => location.pathname === labPath ? location.search : null
type LabView = { route: string; comparison: PlanComparison; demo: boolean; alerts: Alert[]; data: Dataset }

function demoSequence(incidents: Incident[]) {
  const failures = incidents.filter((incident) => incident.category === 'pump_failure')
  for (const last of failures) {
    const active = failures.filter((incident) => incident.systemId === last.systemId &&
      incident.detectedAt <= last.detectedAt && incident.detectedAt >= last.detectedAt - 3600 &&
      (incident.clearedAt === null || last.detectedAt < incident.clearedAt))
    if (active.length >= 3) return { first: active[0], last }
  }
  return failures.length ? { first: failures[0], last: failures[0] } : null
}

function scopeFor(data: Dataset | null, id: string | null): Scope {
  if (!id || !data) return {}
  const asset = data.assets.get(id)
  if (asset) return { systemId: asset.systemId, facilityId: asset.facilityId }
  return { systemId: data.systems.find((system) => yardId(system.id) === id)?.id }
}

export function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [names, setNames] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [queueCollapsed, setQueueCollapsed] = useState(false)
  const inspectorToggle = useRef<HTMLButtonElement>(null)
  const theme = useTheme()
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('Loading practice telemetry…')
  const [error, setError] = useState('')
  const [lab, setLab] = useState<LabView | null>(null)
  const [labRoute, setLabRoute] = useState(currentLabRoute)
  const [labError, setLabError] = useState('')
  const hadLab = useRef(labRoute !== null)
  const [snapshot, setSnapshot] = useState<RecordedSnapshot | null>(null)
  const [calculation, setCalculation] = useState<{ data: Dataset; at: number; systemId: string; comparison: PlanComparison } | null>(null)
  const labRequest = useRef<AbortController | null>(null)
  const [demo, setDemo] = useState<Demo | null>(null)
  const workflow = useWorkflow()
  const [fieldDraft, setFieldDraft] = useState<{ key: string; text: string } | null>(null)
  const cases = useMemo(() => new Map(workflow.entries.map((entry) => [caseKey(entry.incident), entry])), [workflow.entries])
  const request = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const scope = useMemo(() => scopeFor(data, selected), [data, selected])
  const at = data?.times[index] ?? 0
  const current = snapshot?.at === at ? snapshot : null
  const alerts = current?.alerts ?? noAlerts
  const recent = useMemo(() => incidents.filter((incident) => incident.clearedAt !== null && incident.clearedAt <= at)
    .sort((a, b) => b.detectedAt - a.detectedAt).slice(0, 3), [incidents, at])
  const system = data?.systems.find((item) => item.id === scope.systemId)
  const editable = Boolean(data && at === data.now && !demo && !playing)
  const dismissed = new Set(editable && data ? alerts.filter((alert) => cases.get(caseKey(caseFromAlert(data, alert, at)))?.stage === 'dismissed').map((alert) => alert.assetId) : [])
  const verified = alerts.filter((alert) => alert.verified)
  const elsewhere = system && verified.length > 0 && verified.every((alert) => alert.systemId !== system.id) ? verified[0] : null
  const planning = calculation && calculation.data === data && calculation.at === at && calculation.systemId === scope.systemId
    ? calculation.comparison : null

  useEffect(() => {
    if (!data || snapshot?.at === at) return
    const controller = new AbortController()
    void recordedSnapshot(data, at, controller.signal).then((value) => {
      if (!controller.signal.aborted) setSnapshot(value)
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setError(error.message)
    })
    return () => controller.abort()
  }, [data, at, snapshot?.at])

  useEffect(() => {
    if (!data || !current || playing || !scope.systemId || !inspectorOpen) return
    const systemId = scope.systemId
    const failures = current.alerts.filter((alert) => alert.category === 'pump_failure' && alert.systemId === systemId)
    if (!failures.length || failures.some((alert) => alert.levelPct === undefined)) return
    const controller = new AbortController()
    void comparePlans(data, { at, systemId }, controller.signal).then((comparison) => {
      if (!controller.signal.aborted) setCalculation({ data, at, systemId, comparison })
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setError(error.message)
    })
    return () => controller.abort()
  }, [data, current, at, playing, scope.systemId, inspectorOpen])

  function adopt({ data: dataset, incidents: events, latest }: LoadedRecording) {
    const verified = latest.alerts.filter((alert) => alert.verified)
    const next = verified.find((alert) => !alert.automatic && alert.minutesToLimit !== null &&
      alert.repairMinutes !== null && alert.minutesToLimit < alert.repairMinutes) ?? verified[0]
    labRequest.current?.abort()
    setData(dataset)
    setSnapshot(latest)
    setCalculation(null)
    setIncidents(events)
    setIndex(dataset.times.length - 1)
    setSelected(next?.assetId ?? null)
    setInspectorOpen(Boolean(next))
    setFocusRequest((value) => value + 1)
    setPlaying(false)
    setDemo(null)
    setLab(null)
  }

  async function load(loader: () => Promise<LoadedRecording>, label: string) {
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
        if (name && currentLabRoute() === null) {
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
    const navigate = () => setLabRoute(currentLabRoute())
    window.addEventListener('popstate', navigate)
    return () => window.removeEventListener('popstate', navigate)
  }, [])

  useEffect(() => {
    if (labRoute === null) {
      if (hadLab.current) window.requestAnimationFrame(() => {
        const opener = document.querySelector<HTMLButtonElement>('#asset-inspector .inspector-response .primary-btn')
        if (opener && !opener.disabled) opener.focus()
        else document.getElementById('operations-heading')?.focus()
      })
      hadLab.current = false
      return
    }
    hadLab.current = true
    setLabError('')
    if (lab?.route === labRoute) return
    const controller = new AbortController()
    const parameters = new URLSearchParams(labRoute)
    const id = parameters.get('recording')
    const systemId = parameters.get('system')
    const at = Number(parameters.get('at'))
    const demo = parameters.get('demo') === '1'
    if (!id || !systemId || !parameters.has('at') || !Number.isSafeInteger(at)) {
      setLabError('Choose a recorded pump failure in Operations to start a comparison.')
      return
    }
    void (async () => {
      try {
        const loaded = await loadRecording(id)
        if (controller.signal.aborted) return
        const [comparison, frame] = await Promise.all([
          comparePlans(loaded.data, { at, systemId, demo }, controller.signal),
          recordedSnapshot(loaded.data, at, controller.signal),
        ])
        if (controller.signal.aborted) return
        adopt(loaded)
        setIndex(loaded.data.times.indexOf(at))
        setSnapshot(frame)
        setSelected(comparison.scenario.failures[0]?.facility.pump.id ?? systemId)
        setInspectorOpen(true)
        setLab({ route: labRoute, comparison, demo, alerts: frame.alerts, data: loaded.data })
      } catch (error) {
        if (!controller.signal.aborted) setLabError((error as Error).message)
      }
    })()
    return () => controller.abort()
  }, [labRoute, lab?.route])

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
    setSelected(demo.stage === 'first-replay' ? replay.assetId : replay.systemId)
    setInspectorOpen(demo.stage === 'first-replay')
    setFocusRequest((value) => value + 1)
    setDemo({ ...demo, stage: demo.stage === 'first-replay' ? 'first-failure' : 'cluster' })
  }, [at, demo, playing])

  useEffect(() => {
    if (data && index === data.times.length - 1) setPlaying(false)
  }, [data, index])

  function select(id: string | null, showDetails = true) {
    if (demo && playing) {
      setPlaying(false)
      setDemo(null)
    }
    setSelected(id)
    setInspectorOpen(showDetails && Boolean(id))
    setFocusRequest((value) => value + 1)
  }

  async function openLab(systemId: string, demoPlan = false) {
    if (!data) return
    labRequest.current?.abort()
    const controller = new AbortController()
    labRequest.current = controller
    setPlaying(false)
    setError('')
    try {
      const comparison = !demoPlan && planning?.scenario.system.id === systemId ? planning :
        await comparePlans(data, { at, systemId, demo: demoPlan }, controller.signal)
      if (controller.signal.aborted) return
      const id = recordingId(data)
      if (!id) throw new Error('Reload the recording before opening Decision Lab.')
      const query = new URLSearchParams({ recording: id, system: systemId, at: String(at) })
      if (demoPlan) query.set('demo', '1')
      const route = '?' + query.toString()
      window.history.pushState({ nightwatchLab: true }, '', labPath + route)
      setLab({ route, comparison, demo: demoPlan, alerts, data })
      setLabRoute(route)
      if (demoPlan) setDemo(null)
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message)
    }
  }

  function closeLab() {
    if (window.history.state?.nightwatchLab) window.history.back()
    else {
      window.history.replaceState(null, '', '/')
      setLabRoute(null)
      if (!data && names[0]) {
        const name = names.includes('full_week') ? 'full_week' : names[0]
        void load(() => loadPractice(name), 'practice dataset')
      }
    }
  }

  async function startDemo() {
    const useCurrent = data?.name === 'full_week' || !names.includes('full_week')
    const source = useCurrent ? data && { incidents } : await load(() => loadPractice('full_week'), 'full week')
    if (!source) return
    const sequence = demoSequence(source.incidents)
    if (!sequence) { setError('This dataset contains no detected pump failure for the guided demo.'); return }
    setPlaying(false)
    setIndex(0)
    select(null)
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
      setSelected(demo.first.systemId)
      setInspectorOpen(false)
      setFocusRequest((value) => value + 1)
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

  function replay(event: Incident) {
    if (!data) return
    const atIndex = data.times.indexOf(event.detectedAt)
    if (atIndex < 0) return
    scrub(atIndex)
    setTimelineOpen(true)
    select(event.assetId)
  }

  function closeInspector() {
    setInspectorOpen(false)
    inspectorToggle.current?.focus()
  }

  const facility = scope.facilityId ? data?.facilities.get(scope.facilityId) : undefined
  const leaf = selected && selected !== scope.systemId && selected !== scope.facilityId
    ? data?.assets.get(selected)?.id ?? 'Truck yard' : null
  const trail = [
    { id: null, label: 'All systems' },
    ...(system ? [{ id: system.id, label: system.id }] : []),
    ...(facility ? [{ id: facility.id, label: facility.id }] : []),
    ...(leaf ? [{ id: selected, label: leaf }] : []),
  ]
  if (labRoute !== null) {
    if (lab?.route === labRoute) return <DecisionLab key={labRoute} comparison={lab.comparison} demo={lab.demo} data={lab.data}
      alerts={lab.alerts} theme={theme} onClose={closeLab} />
    return <main className="lab-route-state"><section className="panel welcome"><h1>Decision Lab</h1>
      {labError ? <p role="alert">{labError}</p> : <p role="status">Loading the recorded decision point…</p>}
      <button className="soft-btn" onClick={closeLab}>Back to Operations</button></section></main>
  }

  return <div className="operator-shell">
    <header className="operator-top">
      <div className="operator-brand"><BrandMark /><div><h1 id="operations-heading" tabIndex={-1}>NIGHTWATCH</h1><span>FIELD ATLAS</span></div></div>
      <div className="operator-recording">
        <label className="operator-dataset"><Database size={15} /><select aria-label="Dataset" value={data?.name ?? ''} onChange={(event) => void load(() => loadPractice(event.target.value), 'practice dataset')}>
          {!data && <option value="" disabled>Choose a dataset</option>}
          {data && !names.includes(data.name) && <option value={data.name}>{data.name}</option>}
          {names.map((name) => <option value={name} key={name}>{practiceLabel(name)}</option>)}
        </select></label>
        {data && <span className="operator-time"><Clock3 size={14} /> <time dateTime={new Date(at * 1000).toISOString()}>{stamp(at)}</time></span>}
      </div>
      <div className="operator-actions"><ThemeToggle {...theme} /><a className="field-link" aria-label="Field desk" title="NIGHTWATCH Field" href="/field"><ClipboardList size={17} /><span>Field</span></a>
        <details className="control-account">
          <summary className="field-link" aria-label="Control-room account" title="Control-room account"><LockKeyhole size={16} /></summary>
          <div>{workflow.person ? <><p>{workflow.person.name}</p><button className="small-btn" onClick={() => void workflow.signOut().catch((error) => setError(error.message))}>Sign out</button></> :
            <SignIn label="Control-room code" configured={workflow.configured} onSignIn={workflow.signIn} />}</div>
        </details>
        <button className="soft-btn import-btn" onClick={() => input.current?.click()}><Upload size={15} /> <span>Import</span></button>
        <button className="primary-btn demo-btn" disabled={!data || Boolean(status)} onClick={() => void startDemo()}><Play size={13} fill="currentColor" /> Start Demo</button>
        <input ref={input} aria-label="Import network.json, ops.json and telemetry.csv" type="file" accept=".json,.csv" multiple hidden onChange={(event) => {
          const files = event.target.files
          if (files?.length) void load(() => loadUpload(files), 'uploaded dataset')
          event.target.value = ''
        }} />
      </div>
    </header>
    <main className="ops-workspace">
      {status && <p className="notice" role="status"><Activity size={15} />{status}</p>}
      {error && <div className="notice error-notice" role="alert"><CircleHelp size={16} /><span>{error}</span><button aria-label="Dismiss error" className="icon-btn" onClick={() => setError('')}><X size={15} /></button></div>}
      {data ? <>
        <OperationsStrip summary={current?.summary} onFocus={select} />
        {demo && <div className="operator-demo">
          <span className="demo-kicker"><Play size={14} /> Guided demo</span>
          <strong>{demo.stage === 'intro' ? 'The shift begins with normal operations' : demo.stage === 'first-replay' || demo.stage === 'cluster-replay' ? 'Replaying recorded telemetry' : demo.stage === 'first-failure' ? 'A pump has failed' : 'Three failures are competing for one fleet'}</strong>
          {!playing && <button className="primary-btn" onClick={demoNext}>{demo.stage === 'intro' ? 'Replay the lead-up' : demo.stage === 'first-failure' && demo.first !== demo.last ? 'Show shared fleet pressure' : 'Compare responses'}<ArrowRight size={15} /></button>}
          <button className="icon-btn" aria-label="Exit demo" onClick={() => { setDemo(null); setPlaying(false) }}><X size={16} /></button>
        </div>}
        <div className={'operator-console' + (inspectorOpen ? ' with-inspector' : '') + (queueCollapsed ? ' queue-collapsed' : '')}>
          <AlertRail alerts={alerts} dismissed={dismissed} selected={selected} collapsed={queueCollapsed} loading={!current} recent={recent}
            onAlert={select} onReplay={replay} onToggle={() => setQueueCollapsed((value) => !value)} />
          <section className="operator-stage" aria-label="Water network">
            <div className="stage-toolbar">
              <div className="map-title"><span>NETWORK</span><strong>Atlas</strong></div>
              <nav className="breadcrumbs" aria-label="Network breadcrumb">
                {trail.map((crumb, i) => <span key={crumb.id ?? 'all'}>
                  {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
                  <button onClick={() => select(crumb.id)} aria-current={i === trail.length - 1 ? 'location' : undefined}>{crumb.label}</button>
                </span>)}
              </nav>
              {inspectorOpen && <a className="stage-mobile-inspect" href="#asset-inspector">Details</a>}
              <button ref={inspectorToggle} className="stage-inspector-toggle" aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}><PanelRight size={16} /></button>
            </div>
            <div className="map-container">
              <SpatialView night={theme.night} focusRequest={focusRequest} data={data} at={at} scope={scope} selected={selected} alerts={alerts} onSelect={select} onFocus={select} />
              {elsewhere && system && <div className="stage-notice"><span>No active incidents in {system.id} · {verified.length} elsewhere</span><button onClick={() => select(elsewhere.assetId)}>Go to priority <ArrowRight size={13} /></button></div>}
            </div>
          </section>
          {inspectorOpen && <Inspector data={data} at={at} selected={selected} alerts={alerts} planning={planning} onSelect={select} onLab={openLab} onClose={closeInspector} onBriefing={(alert, text) => setFieldDraft({ key: caseKey(caseFromAlert(data, alert, at)), text })} workflow={(alert, response) => {
            const incident = caseFromAlert(data, alert, at)
            const key = caseKey(incident)
            return <IncidentWorkflow key={key} incident={incident} entry={cases.get(key)} available={workflow.available} editable={editable} onUpdate={async (change) => {
                const signal = AbortSignal.timeout(30_000)
                const submit = async (refresh = false) => workflow.update({
                  ...change, recordingId: await registerInvestigationDataset(data, signal, refresh),
                })
                try { await submit() } catch (error) {
                  if ((error as Error).message !== 'Reload the recorded dataset before changing this incident.') throw error
                  await submit(true)
                }
              }}
              person={workflow.person} configured={workflow.configured} onSignIn={workflow.signIn} onSignOut={workflow.signOut}
              response={response} draft={fieldDraft?.key === key ? fieldDraft.text : undefined} />
          }} />}
        </div>
        <section className={'operator-timeline' + (timelineOpen ? ' timeline-open' : '')} aria-label="Historical playback">
          <button className="timeline-disclosure" aria-expanded={timelineOpen} aria-controls="recording-controls" onClick={() => setTimelineOpen(!timelineOpen)}>
            <Clock3 size={16} /> Recorded timeline <ChevronDown size={14} />
          </button>
          <button className="icon-btn timeline-play" aria-label={playing ? 'Pause historical playback' : 'Play historical playback'} onClick={() => {
            setDemo(null)
            if (!playing && index >= data.times.length - 1) setIndex(0)
            setPlaying(!playing)
            setTimelineOpen(true)
          }}>{playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button>
          <div className="timeline-track" id="recording-controls" hidden={!timelineOpen}><input type="range" aria-label="Recorded timestamp" aria-valuetext={stamp(at)} min="0" max={data.times.length - 1} value={index} onChange={(event) => scrub(+event.target.value)} /></div>
          <span className="timeline-state"><span className="status-dot" />{at === data.now ? 'Latest recording' : 'Historical replay'}</span>
          {at !== data.now && <button className="small-btn" onClick={() => scrub(data.times.length - 1)}>Latest</button>}
        </section>
      </> : <section className="panel welcome"><div className="empty-glyph"><Database size={26} /></div><h2>Load a network</h2><p>Select the three EOG files together to build the network and analyze its recorded telemetry.</p><button className="primary-btn" onClick={() => input.current?.click()}><Upload size={15} /> Import dataset</button></section>}
    </main>
  </div>
}
