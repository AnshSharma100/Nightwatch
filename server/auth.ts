import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { controlPerson, personFor } from '../packages/domain/personnel.ts'
import type { WorkflowCase } from '../packages/domain/workflow.ts'
import { requestBody, send } from './http.ts'
import type { WorkspaceStore } from './store.ts'

const cookieName = 'nw_session'
const token = () => randomBytes(24).toString('base64url')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const inviteLifetime = 15 * 60 * 1000
const sessionLifetime = 7 * 24 * 60 * 60 * 1000

function sessionDigest(request: IncomingMessage) {
  const value = request.headers.cookie?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
  return value && /^[A-Za-z0-9_-]{32}$/.test(value) ? digest(value) : undefined
}

export function sessionAuth(store: WorkspaceStore, controlCode: string | undefined, publicOrigin?: string) {
  const attempts = new Map<string, { count: number; until: number }>()
  const secureHost = publicOrigin?.startsWith('https:') ? new URL(publicOrigin).host : undefined

  async function session(request: IncomingMessage) {
    const current = sessionDigest(request)
    if (!current) return undefined
    return (await store.read()).sessions.find((item) => item.digest === current && item.expires > Date.now())
  }

  function cookie(request: IncomingMessage, response: ServerResponse, value: string, maxAge: number) {
    const secure = secureHost && request.headers.host === secureHost
    response.setHeader('Set-Cookie', cookieName + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : ''))
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === 'GET') {
      send(response, 200, { person: (await session(request))?.person ?? null, configured: Boolean(controlCode) })
      return
    }
    if (request.method !== 'POST') { send(response, 405, { error: 'Expected GET or POST.' }); return }
    const input = await requestBody(request, 4096, publicOrigin) as { code?: unknown; signOut?: boolean } | null
    const current = sessionDigest(request)
    if (input?.signOut === true) {
      if (current) await store.update((state) => {
        state.sessions = state.sessions.filter((item) => item.digest !== current)
        state.subscriptions = state.subscriptions.filter((item) => item.session !== current)
        state.shifts = state.shifts.filter((item) => item.session !== current)
      })
      cookie(request, response, '', 0)
      send(response, 200, { person: null, configured: Boolean(controlCode) })
      return
    }
    if (!controlCode) { send(response, 503, { error: 'Run npm run setup:field and restart NIGHTWATCH.' }); return }
    if (typeof input?.code !== 'string' || input.code.length > 128) { send(response, 400, { error: 'Enter a NIGHTWATCH sign-in code.' }); return }
    const key = request.socket.remoteAddress ?? 'local'
    const now = Date.now()
    const rate = attempts.get(key)
    if (rate && rate.until > now && rate.count >= 20) { send(response, 429, { error: 'Too many attempts. Try again in a minute.' }); return }
    attempts.set(key, rate && rate.until > now ? { ...rate, count: rate.count + 1 } : { count: 1, until: now + 60_000 })
    const supplied = digest(input.code.trim())
    const operator = timingSafeEqual(Buffer.from(supplied), Buffer.from(digest(controlCode)))
    const value = token()
    const person = await store.update((state) => {
      const now = Date.now()
      const invite = operator ? undefined : state.invites.find((item) => item.digest === supplied && item.expires > now)
      if (!operator && !invite) return undefined
      const person = operator ? controlPerson : invite!.person
      state.invites = state.invites.filter((item) => item.digest !== invite?.digest && item.expires > now)
      state.sessions = state.sessions.filter((item) => item.expires > now && item.digest !== current)
      const active = new Set(state.sessions.map((item) => item.digest))
      state.subscriptions = state.subscriptions.filter((item) => active.has(item.session))
      state.shifts = state.shifts.filter((item) => active.has(item.session))
      state.sessions.push({ digest: digest(value), person, expires: now + sessionLifetime })
      return person
    })
    if (!person) {
      send(response, 401, { error: 'This sign-in code is invalid, expired, or already used.' })
      return
    }
    attempts.delete(key)
    cookie(request, response, value, sessionLifetime / 1000)
    send(response, 200, { person, configured: true })
  }

  async function invite(incident: WorkflowCase, role: 'foreman' | 'lease') {
    const value = token()
    const expires = Date.now() + inviteLifetime
    const person = personFor(incident, role)
    await store.update((state) => {
      state.invites = state.invites.filter((item) => item.expires > Date.now() && item.person.id !== person.id)
      state.invites.push({ digest: digest(value), person, expires })
    })
    return { code: value, expires, person }
  }
  return { session, handle, invite }
}

export type SessionAuth = ReturnType<typeof sessionAuth>
