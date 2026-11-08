import { useCallback, useEffect, useRef, useState } from 'react'
import { caseKey } from '../engine/workflow.ts'
import type { Person } from '../engine/personnel.ts'
import type { WorkflowEntry, WorkflowUpdate } from '../engine/workflow.ts'

const endpoint = import.meta.env.BASE_URL + 'api/workflow'
const sessionEndpoint = import.meta.env.BASE_URL + 'api/session'

class WorkflowError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function workflowJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The NIGHTWATCH server is unavailable.')
  const value = await response.json()
  if (!response.ok) throw new WorkflowError(value.error || 'The request failed.', response.status)
  return value as T
}

export function jsonRequest(value: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }
}

export function useWorkflow(assignmentId?: string) {
  const [entries, setEntries] = useState<WorkflowEntry[]>([])
  const [available, setAvailable] = useState<boolean | null>(null)
  const [session, setSession] = useState<{ person: Person | null; configured: boolean } | null>(null)
  const [loadError, setLoadError] = useState('')
  const request = useRef(0)
  const person = session?.person

  useEffect(() => {
    const controller = new AbortController()
    void workflowJson<{ person: Person | null; configured: boolean }>(sessionEndpoint, { signal: controller.signal })
      .then(setSession)
      .catch(() => { if (!controller.signal.aborted) setAvailable(false) })
    return () => controller.abort()
  }, [])

  const refresh = useCallback(async () => {
    if (!person) return
    const sequence = ++request.current
    try {
      const value = assignmentId
        ? [await workflowJson<WorkflowEntry>(endpoint + '/assignments/' + encodeURIComponent(assignmentId))]
        : await workflowJson<WorkflowEntry[]>(endpoint)
      if (sequence === request.current) {
        setEntries(value)
        setLoadError('')
        setAvailable(true)
      }
    } catch (error) {
      if (sequence === request.current) {
        setEntries([])
        if (error instanceof WorkflowError && error.status === 401) {
          setSession((current) => current ? { ...current, person: null } : null)
          setAvailable(null)
          setLoadError('')
          return
        }
        setLoadError((error as Error).message)
        setAvailable(false)
      }
    }
  }, [person, assignmentId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 4000)
    return () => { window.clearInterval(timer); request.current++ }
  }, [refresh])

  async function signIn(code: string) {
    const result = await workflowJson<{ person: Person | null; configured: boolean }>(sessionEndpoint, jsonRequest({ code }))
    setSession(result)
    window.dispatchEvent(new Event('nightwatch-session'))
    setEntries([])
    setAvailable(null)
    setLoadError('')
  }
  async function signOut() {
    const result = await workflowJson<{ person: null; configured: boolean }>(sessionEndpoint, jsonRequest({ signOut: true }))
    request.current++
    setSession(result)
    window.dispatchEvent(new Event('nightwatch-session'))
    setEntries([])
    setAvailable(null)
    setLoadError('')
  }
  async function update(change: WorkflowUpdate) {
    let entry: WorkflowEntry
    try { entry = await workflowJson<WorkflowEntry>(endpoint, jsonRequest(change)) }
    catch (error) { void refresh(); throw error }
    request.current++
    setEntries((current) => [...current.filter((item) => caseKey(item.incident) !== caseKey(entry.incident)), entry])
  }

  return { entries, person, configured: session?.configured, available, loadError, update, signIn, signOut }
}
