import { useEffect, useState } from 'react'
import type { EngineerOnShift } from '../../packages/contracts/shifts.ts'
import { workflowJson } from './useWorkflow.ts'

export function useRoster(key: string | null) {
  const [result, setResult] = useState<{ key: string; engineers: EngineerOnShift[]; error: string } | null>(null)
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const refresh = () => void workflowJson<EngineerOnShift[]>('/api/shift/engineers?case=' + encodeURIComponent(key), { signal: controller.signal })
      .then((engineers) => { if (!controller.signal.aborted) setResult({ key, engineers, error: '' }) })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ key, engineers: [], error: error.message }) })
    refresh()
    const timer = window.setInterval(refresh, 2500)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [key])
  return result?.key === key ? result : null
}
