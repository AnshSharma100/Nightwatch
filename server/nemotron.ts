import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { defaultModel, tools } from '../src/agent/contracts.ts'

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage) {
  let body = ''
  for await (const chunk of request) {
    body += chunk.toString()
    if (body.length > 64_000) throw new Error('Investigation request exceeds 64 KB.')
  }
  return JSON.parse(body)
}

export function nemotronBridge(apiKey: string | undefined, model = defaultModel): Plugin {
  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    if (request.url?.split('?')[0] !== '/api/nemotron') { next(); return }
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') ||
        (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host)) {
      send(response, 403, { error: 'Nemotron is available to the local console only.' })
      return
    }
    if (request.method === 'GET') { send(response, 200, { configured: Boolean(apiKey), model }); return }
    if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) {
      send(response, 405, { error: 'Expected a JSON investigation request.' })
      return
    }
    if (!apiKey) { send(response, 503, { error: 'Set NVIDIA_API_KEY in the local environment and restart NIGHTWATCH.' }); return }
    let input
    try {
      input = await readBody(request)
      if (!Array.isArray(input.messages) || input.messages.length < 2 || input.messages.length > 38 ||
          !input.messages.every((message: { role?: string }) => message && ['system', 'user', 'assistant', 'tool'].includes(message.role ?? ''))) {
        throw new Error('Invalid investigation messages.')
      }
    } catch (error) {
      send(response, 400, { error: (error as Error).message })
      return
    }
    try {
      const upstream = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages: input.messages, tools, tool_choice: input.first ? 'required' : 'auto',
          max_tokens: 2500, temperature: .2, stream: false,
        }),
        signal: AbortSignal.timeout(40000),
      })
      if (!upstream.ok || upstream.status === 202) {
        send(response, 502, { error: 'NVIDIA returned HTTP ' + upstream.status + '. Check model access and credentials.' })
        return
      }
      const result = await upstream.json()
      const message = result.choices?.[0]?.message
      if (!message) { send(response, 502, { error: 'NVIDIA returned no completion.' }); return }
      send(response, 200, { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls })
    } catch {
      send(response, 502, { error: 'Could not reach NVIDIA or the request timed out.' })
    }
  }
  return {
    name: 'nightwatch-nemotron',
    configureServer(server) { server.middlewares.use((req, res, next) => { void handle(req, res, next) }) },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void handle(req, res, next) }) },
  }
}
