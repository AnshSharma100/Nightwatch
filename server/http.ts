import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(value))
}

export async function requestBody(request: IncomingMessage, limit = 128_000, publicOrigin?: string): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Expected JSON.')
  const origin = request.headers.origin
  if (origin && origin !== 'http://' + request.headers.host && origin !== publicOrigin) throw new HttpError(403, 'Expected a same-origin request.')
  if (Number(request.headers['content-length']) > limit) throw new HttpError(413, 'Request is too large.')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > limit) { request.resume(); throw new HttpError(413, 'Request is too large.') }
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new HttpError(400, 'Invalid JSON request.') }
}
