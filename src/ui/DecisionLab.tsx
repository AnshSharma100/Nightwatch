import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowRight, FlaskConical, Pause, Play, Plus, Truck, X } from 'lucide-react'
import type { Optimization } from '../engine/optimize.ts'
import { frameAt, noAction, simulate } from '../engine/simulate.ts'
import type { Job, Outcome, Plan, Scenario, ShutIn } from '../engine/simulate.ts'
import { duration, money, number, stamp } from './format.ts'
import { Trace } from './Trace.tsx'
import { FleetReplay } from './FleetReplay.tsx'
import { NemotronPanel } from './NemotronPanel.tsx'
import type { Alert } from '../engine/incidents.ts'
import type { Dataset } from '../engine/model.ts'

export function firstResponse(scenario: Scenario): Plan {
  const jobs: Job[] = []
  for (const { facility, repairMin, alreadyShut } of scenario.failures) {
    if (jobs.length === scenario.system.fleetSize) break
    if (alreadyShut || facility.trucking.responseMin >= repairMin) continue
    const trial = { truck: jobs.length + 1, facilityId: facility.id, dispatchMin: 0, trips: 1 }
    try {
      simulate(scenario, { jobs: [...jobs, trial], shutIns: [] })
      jobs.push(trial)
    } catch {
      // A plausible immediate dispatch must still carry a full load.
    }
  }
  return { jobs, shutIns: [] }
}

export function DecisionLab({ scenario, demo, data, alerts, search, onClose }: { scenario: Scenario; demo: boolean; data: Dataset; alerts: Alert[]; search: Optimization; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<Plan>(() => demo ? firstResponse(scenario) : noAction)
  const [manual, setManual] = useState<Outcome>(() => simulate(scenario, draft))
  const [error, setError] = useState('')
  const [minute, setMinute] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [dirty, setDirty] = useState(false)
  const max = search.baseline.duration
  const savings = manual.costs.total - search.best.costs.total
  const shutDownCount = (outcome: Outcome) => outcome.facilities.filter((facility) => facility.autoAt !== null).length

  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setMinute((value) => Math.min(max, value + 5)), 150)
    return () => clearInterval(timer)
  }, [playing, max])
  useEffect(() => {
    if (minute >= max && playing) setPlaying(false)
  }, [minute, max, playing])

  function edit(plan: Plan) { setDraft(plan); setDirty(true); setError('') }
  function replaceJob(index: number, fields: Partial<Job>) {
    edit({ ...draft, jobs: draft.jobs.map((job, i) => i === index ? { ...job, ...fields } : job) })
  }
  function replaceWell(index: number, fields: Partial<ShutIn>) {
    edit({ ...draft, shutIns: draft.shutIns.map((well, i) => i === index ? { ...well, ...fields } : well) })
  }
  function run() {
    try {
      setManual(simulate(scenario, draft))
      setMinute(0)
      setPlaying(false)
      setError('')
      setDirty(false)
    } catch (error) { setError((error as Error).message) }
  }
  const wells = scenario.failures.flatMap(({ facility, repairMin }) => repairMin > 0 ? facility.wells : [])
  const reachable = scenario.failures.filter((failure) => failure.facility.trucking.responseMin < failure.repairMin)

  return <dialog ref={dialog} className="decision-dialog" onCancel={(event) => { event.preventDefault(); onClose() }} aria-labelledby="lab-title">
    <div className="dialog-body">
      <header className="lab-header"><div className="lab-symbol"><FlaskConical size={24} /></div><div><span className="eyebrow">BUTTERFLY EFFECT / {scenario.system.id}</span><h2 id="lab-title">Decision Lab</h2><p>Simulated future from {stamp(scenario.at)} · {scenario.failures.length} failed pumps · {scenario.system.fleetSize} shared trucks</p></div><button className="icon-btn lab-close" aria-label="Close Decision Lab" onClick={onClose}><X size={21} /></button></header>
      {demo && <div className="demo-note">Compare an immediate truck response, assigned by alert priority, with a plan that weighs all affected facilities together.</div>}
      <div className="comparison-cards">
        <CostCard title="No action" outcome={search.baseline} color="baseline" />
        <CostCard title="Manual response" outcome={manual} color="manual" />
        <CostCard title="Recommended" outcome={search.best} color="recommended" />
      </div>
      <div className="lab-summary">
        <ArrowDownRight size={18} />
        <div><strong>{savings > 0.005 ? money(savings) + ' less than the manual response' : savings < -0.005 ? 'Manual response costs ' + money(-savings) + ' less' : 'Manual and recommended responses tie'}</strong>
        <p>{search.best.jobs.length || search.best.plan.shutIns.length ? 'Recommended plan uses ' + search.best.jobs.reduce((sum, job) => sum + job.trips, 0) + ' truck trips and ' + search.best.plan.shutIns.length + ' selective well shut-ins.' : 'No intervention has the lowest cost among the evaluated responses.'} {search.evaluated} fleet schedules evaluated{search.limited ? ' with search limits' : ''}.</p><p>Automatic shut-ins · {shutDownCount(search.baseline)} without action · {shutDownCount(manual)} manual · {shutDownCount(search.best)} recommended</p></div>
      </div>
      <div className="lab-grid">
        <section className="plan-editor"><h3>Manual response</h3><p className="muted">Enter the jobs and well shut-ins you want to compare.</p>
          <div className="plan-editor-heading"><h4><Truck size={14} /> Truck jobs</h4>
            <button className="small-btn" disabled={!reachable.length || !scenario.system.fleetSize} onClick={() => edit({ ...draft, jobs: [...draft.jobs, { facilityId: reachable[0].facility.id, truck: Math.min(scenario.system.fleetSize, draft.jobs.length + 1), dispatchMin: 0, trips: 1 }] })}><Plus size={14} /> Add job</button></div>
          {draft.jobs.map((job, index) => <div className="edit-row" key={index}>
            <label>Facility<select value={job.facilityId} onChange={(event) => replaceJob(index, { facilityId: event.target.value })}>{reachable.map(({ facility }) => <option key={facility.id}>{facility.id}</option>)}</select></label>
            <label>Truck<input type="number" min="1" max={scenario.system.fleetSize} value={job.truck} onChange={(event) => replaceJob(index, { truck: +event.target.value })} /></label>
            <label>Start (min)<input type="number" min="0" value={job.dispatchMin} onChange={(event) => replaceJob(index, { dispatchMin: +event.target.value })} /></label>
            <label>Trips<input type="number" min="1" value={job.trips} onChange={(event) => replaceJob(index, { trips: +event.target.value })} /></label>
            <button aria-label={'Remove truck job ' + (index + 1)} className="icon-btn" onClick={() => edit({ ...draft, jobs: draft.jobs.filter((_, i) => i !== index) })}><X size={14} /></button>
          </div>)}
          <div className="plan-editor-heading"><h4>Well shut-ins</h4>
            <button className="small-btn" disabled={draft.shutIns.length >= wells.length} onClick={() => {
              const next = wells.find((well) => !draft.shutIns.some((stop) => stop.wellId === well.id))
              if (next) edit({ ...draft, shutIns: [...draft.shutIns, { wellId: next.id, startMin: 0 }] })
            }}><Plus size={14} /> Add well</button></div>
          {draft.shutIns.map((stop, index) => <div className="edit-row well-row" key={index}>
            <label>Well<select value={stop.wellId} onChange={(event) => replaceWell(index, { wellId: event.target.value })}>
              {wells.map((well) => <option key={well.id} disabled={stop.wellId !== well.id && draft.shutIns.some((item) => item.wellId === well.id)}>{well.id}</option>)}
            </select></label>
            <label>Start (min)<input type="number" min="0" value={stop.startMin} onChange={(event) => replaceWell(index, { startMin: +event.target.value })} /></label>
            <button aria-label={'Remove well shut-in ' + (index + 1)} className="icon-btn" onClick={() => edit({ ...draft, shutIns: draft.shutIns.filter((_, i) => i !== index) })}><X size={14} /></button>
          </div>)}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="editor-actions"><button className="primary-btn" onClick={run}>Run simulation <ArrowRight size={15} /></button>{dirty && <span>Draft has changes</span>}</div>
        </section>
        <section className="plan-editor"><h3>Recommended intervention</h3><p className="muted">Lowest cost found under the modeled fleet and well constraints.</p>
          {search.best.jobs.map((job) => <div className="plan-detail" key={job.truck + ':' + job.dispatchMin}><Truck size={15} /><div><strong>Truck {job.truck} → {job.facilityId}</strong><p>Dispatch +{duration(job.dispatchMin)} · Arrive {job.arrivals.map((arrival) => '+' + duration(arrival)).join(', ')} · Free +{duration(job.freeMin)}</p></div></div>)}
          {search.best.plan.shutIns.map((stop) => <div className="plan-detail" key={stop.wellId}><span className="status-dot" /><div><strong>Shut in {stop.wellId}</strong><p>Start +{duration(stop.startMin)} · Hold until pump repair</p></div></div>)}
          {!search.best.jobs.length && !search.best.plan.shutIns.length && <p>Monitor and wait for repair. See the projected tank outcomes below.</p>}
          {search.alternative && <p className="muted runner-up">Next distinct plan found · {money(search.alternative.costs.total)}</p>}
          <details className="method"><summary>Calculation and search limits</summary><p>Tank fill uses configured producing-well water rates and measured starting volume. Trips remove a full load at arrival. A tank that reaches its limit shuts in all wells through repair. Lost production uses each well's oil and gas rates and the configured prices.</p><p>Search tries dispatches at the earliest available yard time and groups of wells shut in together on five-minute boundaries. Large searches use a fixed schedule budget and sample well groups. The manual editor also accepts staggered well starts and later departures.</p></details>
        </section>
      </div>
      <section className="future">
        <div className="future-head"><div><span className="eyebrow">SYNCHRONIZED PLAYBACK</span><h3>System consequences</h3></div><span className="tag simulation-tag">Simulated · +{duration(minute)}</span></div>
        <div className="playback-inline"><button className="icon-btn" aria-label={playing ? 'Pause simulation' : 'Play simulation'} onClick={() => { if (!playing && minute >= max) setMinute(0); setPlaying(!playing) }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><input aria-label="Simulated minutes after decision" type="range" min="0" max={max} step="any" value={minute} onChange={(event) => { setPlaying(false); setMinute(+event.target.value) }} /></div>
        <div className="fleet-strip">
          <FleetReplay scenario={scenario} outcome={manual} minute={minute} title="Manual" color="var(--amber)" />
          <FleetReplay scenario={scenario} outcome={search.best} minute={minute} title="Recommended" color="var(--teal)" />
        </div>
        <p className="route-note">Truck paths are schematic. Departures, arrivals, and availability follow the simulation.</p>
        <div className="future-grid">{scenario.failures.map((failure, index) => {
          const outcomes = [search.baseline, manual, search.best]
          const labels = ['No action', 'Manual', 'Recommended']
          const colors = ['var(--quiet)', 'var(--amber)', 'var(--teal)']
          return <article className="future-card" key={failure.facility.id}>
            <h4>{failure.facility.id}</h4>
            <Trace xStart={0} xEnd={max} min={0} max={100} cursor={minute} threshold={failure.limitBbl / failure.facility.tank.capacityBbl * 100}
              timeLabel={(time) => '+' + duration(time)} label={'Simulated tank fill at ' + failure.facility.id}
              lines={outcomes.map((outcome, i) => ({ label: labels[i], color: colors[i], points: outcome.facilities[index].frames.map((frame) => ({ at: frame.minute, value: frame.bbl / failure.facility.tank.capacityBbl * 100 })) }))} />
            <div className="future-states">{outcomes.map((outcome, i) => {
              const result = outcome.facilities[index]
              const frame = frameAt(result.frames, minute)!
              return <div key={labels[i]}><span style={{ color: colors[i] }}>{labels[i]}</span><strong>{number(frame.bbl / failure.facility.tank.capacityBbl * 100)}% · {frame.producing}/{failure.facility.wells.length} wells</strong><small>{result.autoAt === null ? 'No automatic shut-in' : 'Auto shut-in +' + duration(result.autoAt)} · {money(result.costs.total)}</small></div>
            })}</div>
          </article>
        })}</div>
      </section>
      <NemotronPanel key={JSON.stringify(manual.plan)} context={{ data, alerts, scenario, baseline: search.baseline, manual, recommended: search.best }} />
    </div>
  </dialog>
}

function CostCard({ title, outcome, color }: { title: string; outcome: Outcome; color: string }) {
  return <article className={'cost-card ' + color}><span>{title}</span><strong>{money(outcome.costs.total)}</strong>
    <dl><div><dt>Oil lost</dt><dd>{money(outcome.costs.oil)}</dd></div><div><dt>Gas lost</dt><dd>{money(outcome.costs.gas)}</dd></div><div><dt>Trucking</dt><dd>{money(outcome.costs.trucking)}</dd></div></dl></article>
}
