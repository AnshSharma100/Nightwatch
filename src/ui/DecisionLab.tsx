import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, FlaskConical, Focus, Pause, Play, Plus, Truck, X } from 'lucide-react'
import type { PlanComparison } from '../../packages/contracts/operations.ts'
import type { Alert } from '../../packages/domain/incidents.ts'
import type { Dataset } from '../../packages/domain/model.ts'
import type { Job, Outcome, Plan, Scenario, ShutIn } from '../../packages/domain/simulate.ts'
import { comparePlans } from './datasets.ts'
import { duration, money, number, stamp } from './format.ts'
import { Trace } from './Trace.tsx'
import { FleetReplay } from './FleetReplay.tsx'
import { frameAt, projectNetwork } from './playback.ts'
import { SpatialView } from './SpatialView.tsx'
import { NemotronPanel } from './NemotronPanel.tsx'
import { ThemeToggle } from './Theme.tsx'
import type { useTheme } from './Theme.tsx'
import './lab.css'

type BranchKey = 'baseline' | 'operator' | 'recommended'
interface Branch { key: BranchKey; label: string; color: string; outcome: Outcome | null }

export function DecisionLab({ comparison, demo, data, alerts, theme, onClose }: {
  comparison: PlanComparison; demo: boolean; data: Dataset; alerts: Alert[]
  theme: ReturnType<typeof useTheme>; onClose: () => void
}) {
  const { scenario, search } = comparison
  const heading = useRef<HTMLHeadingElement>(null)
  const request = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState<Plan>(comparison.operator?.plan ?? { jobs: [], shutIns: [] })
  const [manual, setManual] = useState<Outcome | null>(comparison.operator)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [minute, setMinute] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [selectedBranch, selectBranch] = useState<BranchKey>('recommended')
  const [site, setSite] = useState(scenario.failures[0].facility.id)
  const [focusSite, setFocusSite] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const max = search.baseline.duration
  const branches: Branch[] = [
    { key: 'baseline', label: 'No action', color: 'var(--quiet)', outcome: search.baseline },
    { key: 'operator', label: 'Operator plan', color: 'var(--amber)', outcome: manual },
    { key: 'recommended', label: 'Recommended', color: 'var(--teal)', outcome: search.best },
  ]
  const branch = branches.find(({ key }) => key === selectedBranch)!
  const projected = useMemo(() => branch.outcome ? projectNetwork(scenario, branch.outcome, minute) : undefined, [scenario, branch.outcome, minute])
  const scope = useMemo(() => ({ systemId: scenario.system.id, facilityId: focusSite ?? undefined }), [scenario.system.id, focusSite])
  const savings = manual === null ? null : manual.costs.total - search.best.costs.total
  const canPlay = Boolean(branch.outcome && max > 0)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    const previousTitle = document.title
    document.title = 'Decision Lab · NIGHTWATCH'
    return () => { request.current?.abort(); document.title = previousTitle }
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setMinute((value) => Math.min(max, value + 5)), 150)
    return () => clearInterval(timer)
  }, [playing, max])
  useEffect(() => {
    if (playing && (!canPlay || minute >= max)) setPlaying(false)
  }, [canPlay, minute, max, playing])

  function edit(plan: Plan) { setDraft(plan); setDirty(true); setError('') }
  async function run() {
    const controller = new AbortController()
    request.current = controller
    setRunning(true)
    setPlaying(false)
    setError('')
    try {
      const result = await comparePlans(data, { at: scenario.at, systemId: scenario.system.id, plan: draft }, controller.signal)
      if (controller.signal.aborted) return
      setManual(result.operator)
      selectBranch('operator')
      setMinute(0)
      setDirty(false)
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message)
    } finally {
      if (!controller.signal.aborted) setRunning(false)
    }
  }

  function focus(id: string) {
    const facility = data.facilities.get(id) ?? data.facilities.get(data.assets.get(id)?.facilityId ?? '')
    if (!facility) return
    setFocusSite(facility.id)
    setFocusRequest((value) => value + 1)
    if (scenario.failures.some((item) => item.facility.id === facility.id)) setSite(facility.id)
  }

  const schematics = <div className="lab-schematics" aria-label="Synchronized schematic comparisons">
    {branches.map(({ key, label, color, outcome }) => outcome ?
      <FleetReplay key={key} scenario={scenario} outcome={outcome} minute={minute} title={label} color={color} /> :
      <div key={key} className="schematic-empty"><strong>{label}</strong><p>Configure actions and run a simulation.</p></div>)}
  </div>

  return <main className="lab-shell" aria-labelledby="lab-title">
    <header className="lab-header">
      <button className="soft-btn lab-back" aria-label="Close Decision Lab" onClick={onClose}><ArrowLeft size={17} /><span>Operations</span></button>
      <div className="lab-title"><FlaskConical size={23} /><div><span className="eyebrow">BUTTERFLY EFFECT / {scenario.system.id}</span><h1 id="lab-title" ref={heading} tabIndex={-1}>Decision Lab</h1></div></div>
      <p className="lab-origin"><span className="tag">Simulation</span> {stamp(scenario.at)} · {scenario.failures.length} failed pumps · {scenario.system.fleetSize} shared trucks</p>
      <ThemeToggle {...theme} />
    </header>
    <div className="lab-studio">
      <aside className="lab-plans" aria-label="Response plans">
        <div className="lab-pane-head"><h2>Response plans</h2><span>3 futures</span></div>
        <div className="branch-list" role="group" aria-label="Preview a plan">
          {branches.map(({ key, label, color, outcome }) => <button key={key} className={'branch-choice ' + key} type="button"
            style={{ '--branch-color': color } as React.CSSProperties} aria-pressed={selectedBranch === key} onClick={() => selectBranch(key)}>
            <span><strong>{label}</strong><small>{key === 'recommended' ? 'Lowest cost found' : key === 'baseline' ? 'Recorded starting conditions' :
              outcome ? dirty ? 'Last simulated run' : demo ? 'Demo dispatch by alert priority' : 'Your simulated intervention' : 'Unconfigured'}</small></span>
            <b>{outcome ? money(outcome.costs.total) : '—'}</b>
          </button>)}
        </div>
        <div className="plan-editor">
          <h3>Edit operator plan</h3>
          <p className="muted">Schedule full truck trips or hold individual wells through repair.</p>
          <PlanEditor scenario={scenario} draft={draft} edit={edit} running={running} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="editor-actions"><button className="primary-btn" disabled={!dirty || running} onClick={() => void run()}>
            {running ? 'Simulating…' : 'Run simulation'} <ArrowRight size={15} /></button>
            {dirty && <small>Unsaved changes</small>}</div>
        </div>
      </aside>
      <section className="lab-stage" aria-label="Simulated network">
        <div className="lab-pane-head"><div><span className="eyebrow">SIMULATED NETWORK</span><h2>{branch.label}</h2></div>
          {focusSite && <button className="small-btn" onClick={() => { setFocusSite(null); setFocusRequest((value) => value + 1) }}><Focus size={14} /> System view</button>}
        </div>
        <div className="map-container lab-map">
          {projected ? <SpatialView data={data} at={scenario.at} alerts={alerts} projection={projected} scope={scope}
            selected={focusSite} onSelect={focus} onFocus={focus} focusRequest={focusRequest} night={theme.night} fallback={schematics} /> :
            <div className="lab-unconfigured"><FlaskConical size={27} /><h3>Operator plan unconfigured</h3><p>Add an action and run the simulation to see its effects.</p></div>}
        </div>
        <div className="lab-map-note">
          <span><Truck size={15} /> {projected ? projected.trucks.length + ' of ' + scenario.system.fleetSize + ' trucks occupied' : 'Fleet preview pending'}</span>
          <span>Routes are schematic. Tanks and well states use simulated frames.</span>
        </div>
      </section>
      <aside className="lab-evidence" aria-label="Costs and operational outcomes">
        <div className="lab-pane-head"><h2>Cost &amp; impact</h2></div>
        <div className="lab-evidence-body">
          {savings !== null && <p className="lab-savings">{savings > .005 ? money(savings) + ' less than the operator plan' :
            savings < -.005 ? 'Operator plan costs ' + money(-savings) + ' less' : 'Operator and recommended plans tie'}</p>}
          <CostTable branches={branches} />
          <label className="lab-site-select">Facility evidence<select value={site} onChange={(event) => setSite(event.target.value)}>
            {scenario.failures.map(({ facility }) => <option key={facility.id} value={facility.id}>{facility.id}</option>)}
          </select></label>
          <FacilityComparison key={site} scenario={scenario} site={site} branches={branches} minute={minute} max={max} />
          <details className="method"><summary>Recommended actions</summary>
            {search.best.jobs.map((job) => <p key={job.truck + ':' + job.dispatchMin}><strong>Truck {job.truck} → {job.facilityId}</strong><br />
              Dispatch +{duration(job.dispatchMin)} · Arrive {job.arrivals.map((arrival) => '+' + duration(arrival)).join(', ')} · Free +{duration(job.freeMin)}</p>)}
            {search.best.plan.shutIns.map((stop) => <p key={stop.wellId}>Shut in {stop.wellId} at +{duration(stop.startMin)} through repair.</p>)}
            {!search.best.jobs.length && !search.best.plan.shutIns.length && <p>Monitor and wait for repair.</p>}
          </details>
          <details className="method"><summary>Calculation and search limits</summary>
            <p>{search.evaluated} fleet schedules evaluated{search.limited ? ' within the schedule budget' : ''}. Search tries the earliest available dispatch and grouped well stops on five-minute boundaries. The editor also accepts staggered well stops and later departures.</p>
            <p>Truck travel, capacity, and return times come from the dataset. A full tank shuts in all wells through repair. Revenue uses configured oil and gas rates and prices.</p>
            {search.alternative && <p>Next distinct plan found · {money(search.alternative.costs.total)}</p>}
          </details>
          {manual && <NemotronPanel key={JSON.stringify(manual.plan)} context={{ data, alerts, scenario, baseline: search.baseline, manual, recommended: search.best }} />}
        </div>
      </aside>
    </div>
    <footer className="lab-scrubber" aria-label="Simulated timeline">
      <button className="icon-btn" disabled={!canPlay} aria-label={playing ? 'Pause simulation' : 'Play simulation'} onClick={() => {
        if (!playing && minute >= max) setMinute(0)
        setPlaying(!playing)
      }}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
      <div className="lab-scrubber-time"><span className="eyebrow">FUTURE PLAYHEAD</span><strong>Simulated · +{duration(minute)}</strong></div>
      <input aria-label="Simulated minutes after decision" type="range" min="0" max={max} step="any" value={minute}
        onChange={(event) => { setPlaying(false); setMinute(+event.target.value) }} />
      <small>+{duration(max)} repair horizon</small>
    </footer>
  </main>
}

function PlanEditor({ scenario, draft, edit, running }: { scenario: Scenario; draft: Plan; edit: (plan: Plan) => void; running: boolean }) {
  const wells = scenario.failures.flatMap(({ facility, repairMin }) => repairMin > 0 ? facility.wells : [])
  const reachable = scenario.failures.filter((failure) => failure.facility.trucking.responseMin < failure.repairMin)
  function replaceJob(index: number, fields: Partial<Job>) {
    edit({ ...draft, jobs: draft.jobs.map((job, i) => i === index ? { ...job, ...fields } : job) })
  }
  function replaceWell(index: number, fields: Partial<ShutIn>) {
    edit({ ...draft, shutIns: draft.shutIns.map((well, i) => i === index ? { ...well, ...fields } : well) })
  }

  return <fieldset disabled={running} className="editor-fields">
    <div className="plan-editor-heading"><h4><Truck size={14} /> Truck jobs</h4>
      <button className="small-btn" disabled={!reachable.length || !scenario.system.fleetSize || draft.jobs.length >= 60} onClick={() =>
        edit({ ...draft, jobs: [...draft.jobs, { facilityId: reachable[0].facility.id,
          truck: Math.min(scenario.system.fleetSize, draft.jobs.length + 1), dispatchMin: 0, trips: 1 }] })}><Plus size={14} /> Add job</button></div>
    {draft.jobs.map((job, index) => <div className="edit-row" key={index}>
      <label className="edit-destination">Facility<select value={job.facilityId} onChange={(event) => replaceJob(index, { facilityId: event.target.value })}>
        {reachable.map(({ facility }) => <option key={facility.id}>{facility.id}</option>)}</select></label>
      <label>Truck<input type="number" min="1" max={scenario.system.fleetSize} value={job.truck} onChange={(event) => replaceJob(index, { truck: +event.target.value })} /></label>
      <label>Start (min)<input type="number" min="0" value={job.dispatchMin} onChange={(event) => replaceJob(index, { dispatchMin: +event.target.value })} /></label>
      <label>Trips<input type="number" min="1" max="100" value={job.trips} onChange={(event) => replaceJob(index, { trips: +event.target.value })} /></label>
      <button aria-label={'Remove truck job ' + (index + 1)} className="icon-btn" onClick={() => edit({ ...draft, jobs: draft.jobs.filter((_, i) => i !== index) })}><X size={14} /></button>
    </div>)}
    <div className="plan-editor-heading"><h4>Well shut-ins</h4>
      <button className="small-btn" disabled={draft.shutIns.length >= Math.min(60, wells.length)} onClick={() => {
        const next = wells.find((well) => !draft.shutIns.some((stop) => stop.wellId === well.id))
        if (next) edit({ ...draft, shutIns: [...draft.shutIns, { wellId: next.id, startMin: 0 }] })
      }}><Plus size={14} /> Add well</button></div>
    {draft.shutIns.map((stop, index) => <div className="edit-row well-row" key={index}>
      <label className="edit-destination">Well<select value={stop.wellId} onChange={(event) => replaceWell(index, { wellId: event.target.value })}>
        {wells.map((well) => <option key={well.id} disabled={stop.wellId !== well.id && draft.shutIns.some((item) => item.wellId === well.id)}>{well.id}</option>)}
      </select></label>
      <label>Start (min)<input type="number" min="0" value={stop.startMin} onChange={(event) => replaceWell(index, { startMin: +event.target.value })} /></label>
      <button aria-label={'Remove well shut-in ' + (index + 1)} className="icon-btn" onClick={() => edit({ ...draft, shutIns: draft.shutIns.filter((_, i) => i !== index) })}><X size={14} /></button>
    </div>)}
  </fieldset>
}

function CostTable({ branches }: { branches: Branch[] }) {
  const rows = [
    { label: 'Oil lost', value: (outcome: Outcome) => money(outcome.costs.oil) },
    { label: 'Gas lost', value: (outcome: Outcome) => money(outcome.costs.gas) },
    { label: 'Trucking', value: (outcome: Outcome) => money(outcome.costs.trucking) },
    { label: 'Auto shut-ins', value: (outcome: Outcome) => outcome.facilities.filter((facility) => facility.autoAt !== null).length },
  ]
  return <table className="lab-cost-table">
    <thead><tr><th scope="col">USD</th><th scope="col">None</th><th scope="col">Operator</th><th scope="col">Best found</th></tr></thead>
    <tbody>{rows.map(({ label, value }) => <tr key={label}><th scope="row">{label}</th>{branches.map(({ key, outcome }) =>
      <td key={key}>{outcome ? value(outcome) : '—'}</td>)}</tr>)}</tbody>
  </table>
}

function FacilityComparison({ scenario, site, branches, minute, max }: { scenario: Scenario; site: string; branches: Branch[]; minute: number; max: number }) {
  const failure = scenario.failures.find(({ facility }) => facility.id === site)!
  const { facility, limitBbl } = failure
  const samples = branches.flatMap(({ outcome, label, color }) => {
    const result = outcome?.facilities.find(({ facilityId }) => facilityId === site)
    if (!result) return []
    return [{ result, label, color, points: result.frames.map((frame) => ({ at: frame.minute, value: frame.bbl / facility.tank.capacityBbl * 100 })) }]
  })
  return <section className="future-card">
    <Trace xStart={0} xEnd={max} min={0} max={100} cursor={minute} threshold={limitBbl / facility.tank.capacityBbl * 100}
      timeLabel={(time) => '+' + duration(time)} label={'Simulated tank fill at ' + site} lines={samples} />
    <div className="future-states">{samples.map(({ result, label, color }) => {
      const frame = frameAt(result.frames, minute)!
      return <div key={label}><span style={{ color }}>{label}</span><strong>{number(frame.bbl / facility.tank.capacityBbl * 100)}% · {frame.producing}/{facility.wells.length} wells</strong>
        <small>{result.autoAt === null ? 'No automatic shut-in' : 'Auto shut-in +' + duration(result.autoAt)} · {money(result.costs.total)}</small></div>
    })}</div>
  </section>
}
