import { useEffect, useState } from 'react'
import { Clock3, Radio } from 'lucide-react'
import type { Shift, ShiftStatus } from '../../packages/contracts/shifts.ts'
import { shiftLabel } from '../../packages/contracts/shifts.ts'
import { jsonRequest, workflowJson } from './useWorkflow.ts'

export function FieldShift() {
  const [shift, setShift] = useState<Shift | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => void workflowJson<Shift>('/api/shift', { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setShift(value) })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message) })
    refresh()
    const timer = window.setInterval(refresh, 15_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [])

  async function change(status: ShiftStatus) {
    setPending(true)
    setError('')
    try { setShift(await workflowJson<Shift>('/api/shift', jsonRequest({ status }))) }
    catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }

  const available = shift?.status === 'available'
  const off = shift?.status === 'off'
  return <section className="field-shift" aria-label="Shift availability">
    <div className="shift-heading"><Radio size={20} /><div><span>YOUR SHIFT</span><h2 aria-live="polite">{shift ? shiftLabel[shift.status] : 'Checking availability…'}</h2></div></div>
    {shift?.expiresAt ? <p><Clock3 size={14} /> Ends at {new Date(shift.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p> :
      <p>Clock in when you’re ready for new dispatches.</p>}
    {shift && <div className="shift-actions">
      <button className="primary-btn" disabled={pending || available} onClick={() => void change('available')}>{off ? 'Clock in' : 'Available'}</button>
      {!off && <><button className="soft-btn" disabled={pending || !available} onClick={() => void change('busy')}>Busy</button>
        <button className="soft-btn" disabled={pending} onClick={() => void change('off')}>Clock out</button></>}
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
