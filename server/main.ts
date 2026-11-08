import { createServer } from 'node:http'
import { send } from './http.ts'
import { createWorkspace } from './workspace.ts'

const port = Number(process.env.NIGHTWATCH_API_PORT || 4100)
const host = process.env.NIGHTWATCH_API_HOST || '127.0.0.1'
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Set NIGHTWATCH_API_PORT to a valid port.')

const workspace = createWorkspace(process.env)
const server = createServer({ requestTimeout: 120_000, headersTimeout: 15_000 }, (request, response) => {
  if (process.env.NIGHTWATCH_LOG_REQUESTS === '1') {
    const start = performance.now()
    response.once('finish', () => console.log(JSON.stringify({
      event: 'api_request', method: request.method, status: response.statusCode, ms: Math.round(performance.now() - start),
    })))
  }
  void workspace.handle(request, response, () => send(response, 404, { error: 'Use the NIGHTWATCH web application for this route.' }))
})
server.listen(port, host, () => {
  console.log(JSON.stringify({ event: 'api_listening', port, store: process.env.DATABASE_URL ? 'postgres' : 'local' }))
  void workspace.recover()
})

function shutdown() {
  const deadline = setTimeout(() => process.exit(1), 20_000)
  deadline.unref()
  server.close(() => {
    void workspace.close().then(() => clearTimeout(deadline)).catch(() => { process.exitCode = 1 })
  })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
