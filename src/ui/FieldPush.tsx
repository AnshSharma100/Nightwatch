import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { jsonRequest, workflowJson } from './useWorkflow.ts'

const endpoint = '/api/field/push'
type Configuration = { publicKey: string | null; registered: boolean }

function keyBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0))
}

export function FieldPush() {
  const [config, setConfig] = useState<Configuration | null>(null)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    void Promise.all([
      workflowJson<Configuration>(endpoint),
      navigator.serviceWorker.register('/field-sw.js', { scope: '/field' }).then(() => navigator.serviceWorker.ready),
    ]).then(([settings, worker]) => {
      if (!cancelled) { setConfig(settings); setRegistration(worker) }
    }).catch(() => { if (!cancelled) setNotice('Push setup is unavailable in this browser. Your inbox stays available.') })
    return () => { cancelled = true }
  }, [supported])

  async function enable() {
    if (!registration || !config?.publicKey) return
    setBusy(true)
    setNotice('')
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      if (permission !== 'granted') { setNotice('Notifications are off. You can enable permission in your device settings.'); return }
      const key = keyBytes(config.publicKey)
      let subscription = await registration.pushManager.getSubscription()
      const existingKey = subscription?.options.applicationServerKey
      if (subscription && existingKey && (existingKey.byteLength !== key.length || new Uint8Array(existingKey).some((value, i) => value !== key[i]))) {
        await subscription.unsubscribe()
        subscription = null
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      await workflowJson(endpoint, jsonRequest(subscription.toJSON()))
      setConfig({ ...config, registered: true })
      setNotice('This device is registered for approved assignments.')
    } catch (error) { setNotice((error as Error).message || 'This device could not subscribe.') }
    finally { setBusy(false) }
  }

  async function disable() {
    if (!registration || !config) return
    setBusy(true)
    setNotice('')
    try {
      await workflowJson(endpoint, jsonRequest({}, 'DELETE'))
      setConfig({ ...config, registered: false })
      await (await registration.pushManager.getSubscription())?.unsubscribe()
      setNotice('Push is disabled for this device.')
    } catch (error) { setNotice((error as Error).message || 'Could not remove this subscription.') }
    finally { setBusy(false) }
  }

  return <details className="field-notifications">
    <summary><Bell size={17} /> Notifications <span>{config?.registered ? 'Enabled' : 'Optional'}</span></summary>
    <p>{!supported ? 'Use HTTPS and a supported browser. On iPhone, add this page to your Home Screen and open it there.' :
      config && !config.publicKey ? 'The server has not configured Web Push.' : 'Subscribe this device to approved assignments for your signed-in account.'}</p>
    {supported && config?.publicKey && <button className="small-btn" disabled={busy || !registration} onClick={() => void (config.registered ? disable() : enable())}>
      {config.registered ? 'Disable notifications' : 'Enable notifications'}</button>}
    {notice && <p role="status">{notice}</p>}
  </details>
}
