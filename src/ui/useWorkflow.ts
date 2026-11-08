import { useCallback, useEffect, useRef, useState } from 'react'
import { caseKey } from '../engine/workflow.ts'
import type { WorkflowEntry, WorkflowUpdate } from '../engine/workflow.ts'

const endpoint = import.meta.env.BASE_URL + 'api/workflow'

export function useWorkflow() {
  const [entries, setEntries] = useState<WorkflowEntry[]>([])
  const [available, setAvailable] = useState<boolean | null>(null)
  const request = useRef(0)
  const refresh = useCallback(async () => {
    const sequence = ++request.current
    try {
      const response = await fetch(endpoint)
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Workflow unavailable')
      const value = await response.json() as WorkflowEntry[]
      if (sequence === request.current) {
        setEntries(value)
        setAvailable(true)
      }
    } catch {
      if (sequence === request.current) setAvailable(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => { window.clearInterval(timer); request.current++ }
  }, [refresh])

  async function update(change: WorkflowUpdate) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
    })
    const result = await response.json()
    if (!response.ok) {
      if (response.status === 409) void refresh()
      throw new Error(result.error ?? 'Could not update incident.')
    }
    request.current++
    const entry = result as WorkflowEntry
    setEntries((current) => [...current.filter((item) => caseKey(item.incident) !== caseKey(entry.incident)), entry])
  }

  return { entries, available, update }
}
