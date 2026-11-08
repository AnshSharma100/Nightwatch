import type { IncomingMessage, ServerResponse } from 'node:http'

export function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

export async function requestBody(request: IncomingMessage, limit = 128_000, publicOrigin?: string): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON.')
  const origin = request.headers.origin
  if (origin && origin !== 'http://' + request.headers.host && origin !== publicOrigin) throw new Error('Expected a same-origin request.')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('Request is too large.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
