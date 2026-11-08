import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { isExposureInput, summarizeOperations } from '../src/engine/operations.ts'

import { requestBody, send } from './http.ts'
import { workflowHandler } from './workflow.ts'

async function handle(request: IncomingMessage, response: ServerResponse, next: () => void, workflow: ReturnType<typeof workflowHandler>) {
  const pathname = request.url?.split('?')[0]
  if (pathname === '/api/workflow') { await workflow(request, response); return }
  if (pathname !== '/api/operations-summary') { next(); return }
  if (request.method !== 'POST') { send(response, 405, { error: 'Expected POST' }); return }
  try {
    const failures = await requestBody(request)
    if (!Array.isArray(failures) || !failures.every(isExposureInput)) throw new Error('Invalid failure snapshot')
    send(response, 200, summarizeOperations(failures))
  } catch (error) {
    send(response, 400, { error: (error as Error).message })
  }
}

export function workspaceApi(): Plugin {
  const workflow = workflowHandler(process.env.NIGHTWATCH_WORKFLOW_FILE ?? '.nightwatch/workflow.json')
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => { void handle(req, res, next, workflow) }
  return {
    name: 'nightwatch-workspace',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
