import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { isExposureInput, summarizeOperations } from '../src/engine/operations.ts'
import { requestBody, send } from './http.ts'
import { workspaceStore } from './store.ts'
import { sessionAuth } from './auth.ts'
import { pushService } from './push.ts'
import { workflowHandler } from './workflow.ts'
import { nemotronHandler } from './nemotron.ts'
import { recordingRegistry } from './datasets.ts'

export function workspaceApi(env: Record<string, string>): Plugin {
  const origin = env.NIGHTWATCH_PUBLIC_ORIGIN?.replace(/\/$/, '') || undefined
  const store = workspaceStore(env.NIGHTWATCH_WORKFLOW_FILE || '.nightwatch/workflow.json')
  const auth = sessionAuth(store, env.NIGHTWATCH_CONTROL_CODE, origin)
  const push = pushService(store, env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? {
    publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT,
  } : null, origin)
  const recordings = recordingRegistry()
  const workflow = workflowHandler(store, auth, push, recordings, origin)
  const nemotron = nemotronHandler({ apiKey: env.NVIDIA_API_KEY, baseUrl: env.NVIDIA_BASE_URL, model: env.NVIDIA_MODEL, origin }, auth, recordings)

  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    const path = request.url?.split('?')[0] ?? ''
    try {
      if (path === '/api/session') { await auth.handle(request, response); return }
      if (path.startsWith('/api/workflow')) { await workflow(request, response, path); return }
      if (path === '/api/field/push') {
        const session = auth.session(request)
        if (!session) { send(response, 401, { error: 'Sign in to manage notifications.' }); return }
        await push.subscriptionApi(request, response, session)
        return
      }
      if (path.startsWith('/api/nemotron')) { await nemotron(request, response, path); return }
      if (path !== '/api/operations-summary') { next(); return }
      if (request.method !== 'POST') { send(response, 405, { error: 'Expected POST.' }); return }
      const failures = await requestBody(request, 128_000, origin)
      if (!Array.isArray(failures) || !failures.every(isExposureInput)) { send(response, 400, { error: 'Invalid failure snapshot.' }); return }
      send(response, 200, summarizeOperations(failures))
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
