import type { IncomingMessage, ServerResponse } from 'node:http'

export function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

export async function requestBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON')
  if (request.headers.origin && !['http://', 'https://'].some((scheme) => request.headers.origin === scheme + request.headers.host)) {
    throw new Error('Expected a same-origin request')
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 128_000) throw new Error('Request exceeds 128 KB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
