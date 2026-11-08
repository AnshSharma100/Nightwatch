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
  const [permission, setPermission] = useState<NotificationPermission | null>(() => 'Notification' in window ? Notification.permission : null)
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
      setPermission(permission)
      if (permission !== 'granted') { setNotice('Notifications are off. You can enable permission in your device settings. Your assignments remain available below.'); return }
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

  const enabled = config?.registered && permission === 'granted'
  const status = enabled ? 'Enabled on this device' : permission === 'denied' ? 'Blocked in device settings' : !supported ? 'Unavailable in this browser' :
    config && !config.publicKey ? 'Not set up on this server' : config ? 'Not enabled yet' : notice ? 'Setup unavailable' : 'Checking this device…'
  return <section className="field-notifications" aria-label="Phone notifications">
    <div className="field-notifications-heading"><Bell size={18} /><h3>Phone notifications</h3><span>{status}</span></div>
    <p>{enabled ? 'Approved assignments can alert this device while the app is closed. Open an alert, review the assignment, then tap Acknowledge.' :
      !supported ? 'Your inbox works here. For background phone alerts, use the shared HTTPS address in a supported browser. On iPhone, add NIGHTWATCH Field to your Home Screen and open it there.' :
      config && !config.publicKey ? 'The operator needs to finish notification setup. Approved assignments still appear in your inbox.' :
      'Enable alerts on this device, then allow notifications when asked. Only assignments approved for you can send a phone alert.'}</p>
    {supported && config?.publicKey && <button className="small-btn" disabled={busy || !registration} onClick={() => void (config.registered ? disable() : enable())}>
      {config.registered ? 'Disable notifications' : 'Enable notifications'}</button>}
    <details className="field-notification-help"><summary>How does the phone get an assignment?</summary><ol>
      <li>You clock in and allow notifications on this device.</li><li>The operator reviews an incident, selects you, and presses Send to Field.</li>
      <li>A phone alert opens the current assignment. Your acknowledgment tells the control room you received it.</li>
    </ol><p>If a phone alert does not arrive, open My assignments here. An accepted push request alone does not mean you have read it.</p>
      <p>For a separate phone, both devices must use the same reachable HTTPS address. A phone’s 127.0.0.1 address does not reach the laptop.</p>
    </details>
    {notice && <p role="status">{notice}</p>}
  </section>
}
