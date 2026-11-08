import type { IncomingMessage, ServerResponse } from 'node:http'
import pg from 'pg'
import { HttpError, send } from './http.ts'
import { workspaceStore } from './store.ts'
import { postgresStore } from './postgres.ts'
import { sessionAuth } from './auth.ts'
import { pushService } from './push.ts'
import { workflowHandler } from './workflow.ts'
import { nemotronHandler } from './nemotron.ts'
import { operationalRecordings, recordingRegistry } from './datasets.ts'
import { operationsHandler } from './operations.ts'
import { shiftHandler } from './shifts.ts'

export function createWorkspace(env: Record<string, string | undefined>) {
  const origin = env.NIGHTWATCH_PUBLIC_ORIGIN ? new URL(env.NIGHTWATCH_PUBLIC_ORIGIN).origin : undefined
  if (env.NIGHTWATCH_REQUIRE_HTTPS === '1' && !origin?.startsWith('https://')) {
    throw new Error('Set NIGHTWATCH_PUBLIC_ORIGIN to the external HTTPS origin.')
  }
  const pool = env.DATABASE_URL ? new pg.Pool({
    connectionString: env.DATABASE_URL, application_name: 'nightwatch',
    max: 6, connectionTimeoutMillis: 4000, query_timeout: 12000, statement_timeout: 10000,
  }) : null
  pool?.on('error', () => console.warn(JSON.stringify({ event: 'database_connection_lost' })))
  const database = pool ? postgresStore(pool, env.NIGHTWATCH_LEGACY_WORKFLOW_FILE) : null
  const store = database ?? workspaceStore(env.NIGHTWATCH_WORKFLOW_FILE || '.nightwatch/workflow.json')
  const auth = sessionAuth(store, env.NIGHTWATCH_CONTROL_CODE, origin)
  const push = pushService(store, env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? {
    publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT,
  } : null, origin)
  const practice = env.NIGHTWATCH_PRACTICE_DIR || 'public/practice'
  const recordings = recordingRegistry(practice)
  const secureHost = origin?.startsWith('https:') ? new URL(origin).host : undefined
  const operational = operationalRecordings(practice, env.NIGHTWATCH_RECORDINGS_DIR || '.nightwatch/recordings', secureHost, database?.catalog)
  const operations = operationsHandler(operational, recordings, auth, origin, env.NIGHTWATCH_REQUIRE_CONTROL_IMPORT === '1')
  const shifts = shiftHandler(store, auth, origin)
  const workflow = workflowHandler(store, auth, push, recordings, origin)
  const nemotron = nemotronHandler({ apiKey: env.NVIDIA_API_KEY, baseUrl: env.NVIDIA_BASE_URL, model: env.NVIDIA_MODEL, origin }, auth, recordings)

  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    try {
      const url = new URL(request.url ?? '/', 'http://nightwatch')
      const path = url.pathname
      if (path === '/api/health/live' || path === '/api/health/ready') {
        if (request.method !== 'GET') { send(response, 405, { error: 'Expected GET.' }); return }
        if (path.endsWith('/ready')) {
          try { await store.ready() }
          catch { send(response, 503, { ready: false }); return }
          send(response, 200, { ready: true, store: database ? 'postgres' : 'local' })
        } else send(response, 200, { live: true })
        return
      }
      if (path === '/api/session') { await auth.handle(request, response); return }
      if (path === '/api/shift' || path.startsWith('/api/shift/')) { await shifts(request, response, url); return }
      if (path === '/api/workflow' || path.startsWith('/api/workflow/')) { await workflow(request, response, path); return }
      if (path === '/api/field/push') {
        const session = await auth.session(request)
        if (!session) { send(response, 401, { error: 'Sign in to manage notifications.' }); return }
        await push.subscriptionApi(request, response, session)
        return
      }
      if (path === '/api/nemotron' || path.startsWith('/api/nemotron/')) { await nemotron(request, response, path); return }
      if (path === '/api/datasets' || path.startsWith('/api/datasets/')) { await operations(request, response, url); return }
      if (path.startsWith('/api/')) { send(response, 404, { error: 'Unknown API endpoint.' }); return }
      next()
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        if (error instanceof HttpError) { send(response, error.status, { error: error.message }); return }
        const unavailable = Boolean((error as NodeJS.ErrnoException).code) || (error as Error).message === 'Query read timeout'
        send(response, unavailable ? 503 : 400, { error: unavailable ? 'NIGHTWATCH could not read or save its server state.' : (error as Error).message })
      }
    }
  }

  async function recover() {
    try { await push.recover() }
    catch { console.warn(JSON.stringify({ event: 'push_recovery_failed' })) }
  }
  async function close() { await push.close(); await store.close() }
  return { handle, recover, close }
}
