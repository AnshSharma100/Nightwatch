import type { IncomingMessage, ServerResponse } from 'node:http'
import { defaultModel, tools } from '../src/agent/contracts.ts'
import type { Completion, Message } from '../src/agent/contracts.ts'
import { investigate } from '../src/agent/investigate.ts'
import type { AuditEntry, Investigation } from '../src/agent/investigate.ts'
import { activeAlerts } from '../packages/domain/incidents.ts'
import { optimize } from '../packages/domain/optimize.ts'
import { scenarioAt, simulate } from '../packages/domain/simulate.ts'
import { isPlan } from '../packages/contracts/operations.ts'
import { requestBody, send } from './http.ts'
import type { SessionAuth } from './auth.ts'
import type { RecordingRegistry } from './datasets.ts'

interface Configuration { apiKey?: string; baseUrl?: string; model?: string; origin?: string }

export function parseCompletion(value: unknown): Completion {
  const message = (value as { choices?: { message?: Partial<Completion> }[] } | null)?.choices?.[0]?.message
  if (!message || message.role !== 'assistant' || (message.content != null && typeof message.content !== 'string')) {
    throw new Error('NVIDIA returned an invalid assistant response.')
  }
  const calls = message.tool_calls
  if (calls !== undefined && (!Array.isArray(calls) || calls.length > 6 || !calls.every((call) =>
    call?.type === 'function' && typeof call.id === 'string' && call.id.length <= 160 &&
    typeof call.function?.name === 'string' && call.function.name.length <= 80 &&
    typeof call.function.arguments === 'string' && call.function.arguments.length <= 20_000
  ) || new Set(calls.map((call) => call.id)).size !== calls.length)) {
    throw new Error('NVIDIA returned invalid tool calls.')
  }
  return { role: 'assistant', content: message.content ?? null, tool_calls: calls }
}

export function nvidiaCompletion(config: Configuration, signal: AbortSignal, request = fetch) {
  const base = new URL(config.baseUrl || 'https://integrate.api.nvidia.com/v1')
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('NVIDIA_BASE_URL must be an HTTPS API base URL.')
  const endpoint = base.href.replace(/\/+$/, '') + '/chat/completions'
  return async (messages: Message[], first: boolean) => {
    const reply = await request(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model || defaultModel, messages, tools, tool_choice: first ? 'required' : 'auto',
        max_tokens: 3500, temperature: .2, stream: false,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    })
    if (!reply.ok || reply.status === 202) throw new Error('NVIDIA returned HTTP ' + reply.status + '. Check the configured key and model access.')
    return parseCompletion(await reply.json())
  }
}

export function prepareInvestigation(recording: NonNullable<ReturnType<RecordingRegistry['find']>>, input: Record<string, unknown>): Investigation {
  const { data, incidents } = recording
  const { at, systemId, facilityId, manual } = input
  if (typeof at !== 'number' || !data.times.includes(at) || typeof systemId !== 'string' ||
      (facilityId !== undefined && (typeof facilityId !== 'string' || data.facilities.get(facilityId)?.systemId !== systemId))) {
    throw new Error('Choose an asset and recorded timestamp in this dataset.')
  }
  const alerts = activeAlerts(data, incidents, at).filter((item) => item.systemId === systemId)
  const scenario = scenarioAt(data, alerts.filter((item) => item.levelPct !== undefined), systemId, at)
  const search = optimize(scenario)
  let alternative = search.baseline
  if (manual !== undefined) {
    if (!isPlan(manual)) throw new Error('Invalid manual plan.')
    alternative = simulate(scenario, manual)
  }
  return { data, alerts, scenario, baseline: search.baseline, manual: alternative, recommended: search.best, selectedFacilityId: facilityId as string | undefined }
}

export function nemotronHandler(config: Configuration, auth: SessionAuth, recordings: RecordingRegistry) {
  const busy = new Set<string>()
  return async (request: IncomingMessage, response: ServerResponse, path: string) => {
    const session = await auth.session(request)
    if (path === '/api/nemotron' && request.method === 'GET') {
      send(response, 200, { configured: Boolean(config.apiKey), authorized: session?.person.role === 'control', model: config.model || defaultModel })
      return
    }
    if (session?.person.role !== 'control') { send(response, 403, { error: 'Control-room sign-in is required.' }); return }
    if (request.method !== 'POST') { send(response, 405, { error: 'Expected POST.' }); return }
    if (path === '/api/nemotron/datasets') {
      const body = await requestBody(request, 65_000_000, config.origin)
      try { send(response, 200, { id: recordings.register(session.digest, body) }) }
      catch (error) {
        send(response, 400, { error: (error as NodeJS.ErrnoException).code ? 'The practice recording could not be loaded on the server.' : (error as Error).message })
      }
      return
    }
    if (path !== '/api/nemotron') { send(response, 404, { error: 'Unknown Investigator endpoint.' }); return }
    if (!config.apiKey) { send(response, 503, { error: 'Set NVIDIA_API_KEY in .env.local and restart NIGHTWATCH.' }); return }
    const input = await requestBody(request, 48_000, config.origin) as Record<string, unknown> | null
    const recording = recordings.find(input?.datasetId, session.digest)
    if (!input || !recording) { send(response, 404, { error: 'The selected dataset must be loaded in this session.' }); return }
    if (input.question !== undefined && (typeof input.question !== 'string' || input.question.length > 500)) {
      send(response, 400, { error: 'Enter a question up to 500 characters.' }); return
    }
    if (busy.has(session.digest) || busy.size >= 2) { send(response, 429, { error: 'An investigation is already running. Try again shortly.' }); return }
    let context
    try { context = prepareInvestigation(recording, input) }
    catch (error) { send(response, 422, { error: (error as Error).message }); return }

    busy.add(session.digest)
    const stopped = new AbortController()
    response.on('close', () => stopped.abort())
    const trace: AuditEntry[] = []
    try {
      const signal = AbortSignal.any([stopped.signal, AbortSignal.timeout(80_000)])
      const summary = await investigate(context, nvidiaCompletion(config, signal), (entry) => trace.push(entry), input.question as string | undefined)
      if (!stopped.signal.aborted) send(response, 200, { summary, trace, recommendedCost: context.recommended.costs.total })
    } catch (error) {
      const message = (error as Error).name === 'TimeoutError' ? 'Nemotron timed out. Try a narrower question.' : (error as Error).message
      if (!stopped.signal.aborted) send(response, 502, { error: message, trace })
    } finally { busy.delete(session.digest) }
  }
}
