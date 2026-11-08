import { createRequire } from 'node:module'
import type { PushSubscription } from 'web-push'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Session, WorkspaceStore } from './store.ts'
import { requestBody, send } from './http.ts'
import { deviceShift } from './shifts.ts'

export interface PushConfig { publicKey: string; privateKey: string; subject: string }
export type PushSend = (subscription: PushSubscription, payload: string, config: PushConfig) => Promise<unknown>

function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname) ||
       /\.(?:push\.apple\.com|notify\.windows\.com|wns\.windows\.com)$/.test(url.hostname))
  } catch { return false }
}

function subscription(value: unknown): PushSubscription | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PushSubscription>
  const key = (value: unknown, length: number) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) &&
    Buffer.from(value, 'base64url').length === length
  if (!validEndpoint(candidate.endpoint) || !key(candidate.keys?.p256dh, 65) || !key(candidate.keys?.auth, 16)) return null
  return { endpoint: candidate.endpoint, keys: { p256dh: candidate.keys!.p256dh, auth: candidate.keys!.auth } }
}

const webPush = createRequire(import.meta.url)('web-push') as typeof import('web-push')
const sendWebPush: PushSend = (target, payload, config) => webPush.sendNotification(target, payload, {
  vapidDetails: config, TTL: 3600, timeout: 12_000,
})

export function pushService(store: WorkspaceStore, config: PushConfig | null, publicOrigin?: string, deliver: PushSend = sendWebPush) {
  const sending = new Set<Promise<void>>()
  async function subscriptionApi(request: IncomingMessage, response: ServerResponse, session: Session) {
    if (session.person.role === 'control') { send(response, 403, { error: 'Field sign-in is required.' }); return }
    if (request.method === 'GET') {
      send(response, 200, { publicKey: config?.publicKey ?? null,
        registered: (await store.read()).subscriptions.some((item) => item.session === session.digest) })
      return
    }
    if (request.method !== 'POST' && request.method !== 'DELETE') { send(response, 405, { error: 'Expected GET, POST or DELETE.' }); return }
    const body = await requestBody(request, 8192, publicOrigin)
    if (request.method === 'DELETE') {
      await store.update((state) => { state.subscriptions = state.subscriptions.filter((item) => item.session !== session.digest) })
      send(response, 200, { registered: false })
      return
    }
    if (!config) { send(response, 503, { error: 'Web Push is not configured on the server.' }); return }
    const value = subscription(body)
    if (!value) { send(response, 400, { error: 'Invalid or unsupported browser subscription.' }); return }
    const registered = await store.update((state) => {
      if (!state.sessions.some((item) => item.digest === session.digest && item.expires > Date.now())) return null
      const existing = state.subscriptions.find((item) => item.value.endpoint === value.endpoint)
      if (existing && existing.personId !== session.person.id &&
          state.sessions.some((item) => item.digest === existing.session && item.expires > Date.now())) return false
      state.subscriptions = state.subscriptions.filter((item) => item.session !== session.digest && item.value.endpoint !== value.endpoint)
      state.subscriptions.push({ session: session.digest, personId: session.person.id, value })
      return true
    })
    if (registered === null) { send(response, 401, { error: 'This field session has ended.' }); return }
    send(response, registered ? 200 : 409, registered ? { registered } : { error: 'This device is subscribed to another account. Sign out there or reset this browser subscription.' })
  }

  async function dispatch(id: string) {
    const work = await store.update((state) => {
      const row = state.deliveries.find((item) => item.id === id)
      if (!row || row.status !== 'queued') return
      const entry = state.entries.find((item) => item.assignment?.id === row.assignmentId)
      const current = entry?.assignment?.recipient.id === row.recipientId && entry.stage !== 'resolved'
      const now = Date.now()
      const sessions = new Set(state.sessions.filter((item) => item.person.id === row.recipientId && item.expires > now &&
        (!row.requiresAvailable || deviceShift(state, item.digest, now).status === 'available')).map((item) => item.digest))
      const targets = state.subscriptions.filter((item) => item.personId === row.recipientId && sessions.has(item.session))
      if (!current) row.status = 'superseded'
      else if (row.requiresAvailable && !sessions.size) row.status = 'off_shift'
      else if (!config) row.status = 'disabled'
      else row.status = targets.length ? 'requested' : 'no_subscription'
      row.at = now
      if (row.status === 'requested') return { targets, assignmentId: row.assignmentId }
    })
    if (!work || !config) return
    const payload = JSON.stringify({
      title: 'NIGHTWATCH · Field assignment', body: 'You have a new approved assignment. Open NIGHTWATCH Field for details.',
      assignmentId: work.assignmentId,
    })
    const results = await Promise.all(work.targets.map(async (target) => {
      try { await deliver(target.value, payload, config); return { target, accepted: true, expired: false } }
      catch (error) {
        const status = (error as { statusCode?: number })?.statusCode
        return { target, accepted: false, expired: status === 404 || status === 410 }
      }
    }))
    await store.update((state) => {
      const row = state.deliveries.find((item) => item.id === id)
      if (!row) return
      row.accepted = results.filter((item) => item.accepted).length
      row.failed = results.length - row.accepted
      row.status = row.accepted ? 'accepted' : 'failed'
      row.at = Date.now()
      state.subscriptions = state.subscriptions.filter((item) => !results.some(({ target, expired }) =>
        expired && target.session === item.session && target.value.endpoint === item.value.endpoint))
    })
  }

  function schedule(id: string) {
    const promise = dispatch(id).catch(() => console.warn('NIGHTWATCH could not update Web Push delivery status.'))
    sending.add(promise)
    void promise.finally(() => sending.delete(promise))
  }

  async function recover() {
    for (const item of (await store.read()).deliveries) if (item.status === 'queued') schedule(item.id)
  }
  async function close() { await Promise.all(sending) }
  return { subscriptionApi, dispatch, schedule, recover, close }
}

export type PushService = ReturnType<typeof pushService>
