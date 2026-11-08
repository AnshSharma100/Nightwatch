import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { send } from './http.ts'
import { workspaceStore } from './store.ts'
import { sessionAuth } from './auth.ts'
import { pushService } from './push.ts'
import { workflowHandler } from './workflow.ts'
import { nemotronHandler } from './nemotron.ts'
import { operationalRecordings, recordingRegistry } from './datasets.ts'
import { operationsHandler } from './operations.ts'
import { shiftHandler } from './shifts.ts'

export function workspaceApi(env: Record<string, string>): Plugin {
  const origin = env.NIGHTWATCH_PUBLIC_ORIGIN?.replace(/\/$/, '') || undefined
  const store = workspaceStore(env.NIGHTWATCH_WORKFLOW_FILE || '.nightwatch/workflow.json')
  const auth = sessionAuth(store, env.NIGHTWATCH_CONTROL_CODE, origin)
  const push = pushService(store, env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? {
    publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT,
  } : null, origin)
  const practice = env.NIGHTWATCH_PRACTICE_DIR || 'public/practice'
  const recordings = recordingRegistry(practice)
  const operations = operationsHandler(operationalRecordings(practice, env.NIGHTWATCH_RECORDINGS_DIR || '.nightwatch/recordings', origin?.startsWith('https:') ?? false), recordings, auth, origin)
  const shifts = shiftHandler(store, auth, origin)
  const workflow = workflowHandler(store, auth, push, recordings, origin)
  const nemotron = nemotronHandler({ apiKey: env.NVIDIA_API_KEY, baseUrl: env.NVIDIA_BASE_URL, model: env.NVIDIA_MODEL, origin }, auth, recordings)

  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    const path = request.url?.split('?')[0] ?? ''
    try {
      if (path === '/api/session') { await auth.handle(request, response); return }
      if (path === '/api/shift' || path.startsWith('/api/shift/')) {
        await shifts(request, response, new URL(request.url ?? '/', 'http://nightwatch'))
        return
      }
      if (path.startsWith('/api/workflow')) { await workflow(request, response, path); return }
      if (path === '/api/field/push') {
        const session = auth.session(request)
        if (!session) { send(response, 401, { error: 'Sign in to manage notifications.' }); return }
        await push.subscriptionApi(request, response, session)
        return
      }
      if (path.startsWith('/api/nemotron')) { await nemotron(request, response, path); return }
      if (path === '/api/datasets' || path.startsWith('/api/datasets/')) {
        await operations(request, response, new URL(request.url ?? '/', 'http://nightwatch'))
        return
      }
      next()
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const filesystem = Boolean((error as NodeJS.ErrnoException).code)
        send(response, filesystem ? 500 : 400, { error: filesystem ? 'NIGHTWATCH could not read or save its server state.' : (error as Error).message })
      }
    }
  }

  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => { void handle(req, res, next) }
  function recover() {
    try { push.recover() } catch { console.warn('NIGHTWATCH could not recover the push queue.') }
  }
  return {
    name: 'nightwatch-workspace',
    configureServer(server) { server.middlewares.use(middleware); recover() },
    configurePreviewServer(server) { server.middlewares.use(middleware); recover() },
  }
}
