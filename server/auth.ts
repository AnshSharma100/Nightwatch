import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { controlPerson, personFor } from '../src/engine/personnel.ts'
import type { WorkflowCase } from '../src/engine/workflow.ts'
import { requestBody, send } from './http.ts'
import type { Session, WorkspaceStore } from './store.ts'

const cookieName = 'nw_session'
const token = () => randomBytes(24).toString('base64url')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const inviteLifetime = 15 * 60 * 1000
const sessionLifetime = 7 * 24 * 60 * 60 * 1000

export function sessionAuth(store: WorkspaceStore, controlCode: string | undefined, publicOrigin?: string) {
  const attempts = new Map<string, { count: number; until: number }>()
  function secure(request: IncomingMessage) {
    return publicOrigin?.startsWith('https:') && request.headers.host === new URL(publicOrigin).host
  }
  function session(request: IncomingMessage): Session | undefined {
    const value = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
    if (!value || !/^[A-Za-z0-9_-]{32}$/.test(value)) return
    return store.read().sessions.find((item) => item.digest === digest(value) && item.expires > Date.now())
  }
  function cookie(request: IncomingMessage, response: ServerResponse, value: string, maxAge: number) {
    response.setHeader('Set-Cookie', cookieName + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure(request) ? '; Secure' : ''))
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === 'GET') {
      send(response, 200, { person: session(request)?.person ?? null, configured: Boolean(controlCode) })
      return
    }
    if (request.method !== 'POST') { send(response, 405, { error: 'Expected GET or POST.' }); return }
    const input = await requestBody(request, 4096, publicOrigin) as { code?: unknown; signOut?: boolean } | null
    if (input?.signOut === true) {
      const current = session(request)
      if (current) store.update((state) => {
        state.sessions = state.sessions.filter((item) => item.digest !== current.digest)
        state.subscriptions = state.subscriptions.filter((item) => item.session !== current.digest)
      })
      cookie(request, response, '', 0)
      send(response, 200, { person: null, configured: Boolean(controlCode) })
      return
    }
    if (!controlCode) { send(response, 503, { error: 'Run npm run setup:field and restart NIGHTWATCH.' }); return }
    if (typeof input?.code !== 'string' || input.code.length > 128) { send(response, 400, { error: 'Enter a NIGHTWATCH sign-in code.' }); return }
    const code = input.code.trim()
    const now = Date.now()
    const key = request.socket.remoteAddress ?? 'local'
    const rate = attempts.get(key)
    if (rate && rate.until > now && rate.count >= 20) { send(response, 429, { error: 'Too many attempts. Try again in a minute.' }); return }
    const supplied = digest(code)
    const operator = timingSafeEqual(Buffer.from(supplied), Buffer.from(digest(controlCode)))
    const invite = operator ? undefined : store.read().invites.find((item) => item.digest === supplied && item.expires > now)
    if (!operator && !invite) {
      attempts.set(key, rate && rate.until > now ? { ...rate, count: rate.count + 1 } : { count: 1, until: now + 60_000 })
      send(response, 401, { error: 'This sign-in code is invalid, expired, or already used.' })
      return
    }
    const value = token()
    const person = operator ? controlPerson : invite!.person
    const replaced = session(request)
    store.update((state) => {
      if (invite) state.invites = state.invites.filter((item) => item.digest !== invite.digest && item.expires > now)
      state.sessions = state.sessions.filter((item) => item.expires > now && item.digest !== replaced?.digest)
      const active = new Set(state.sessions.map((item) => item.digest))
      state.subscriptions = state.subscriptions.filter((item) => active.has(item.session))
      state.sessions.push({ digest: digest(value), person, expires: now + sessionLifetime })
    })
    cookie(request, response, value, sessionLifetime / 1000)
    send(response, 200, { person, configured: true })
  }

  function invite(incident: WorkflowCase, role: 'foreman' | 'lease') {
    const value = token()
    const expires = Date.now() + inviteLifetime
    const person = personFor(incident, role)
    store.update((state) => {
      state.invites = state.invites.filter((item) => item.expires > Date.now() && item.person.id !== person.id)
      state.invites.push({ digest: digest(value), person, expires })
    })
    return { code: value, expires, person }
  }
  return { session, handle, invite }
}
export type SessionAuth = ReturnType<typeof sessionAuth>
