import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const webPush = createRequire(import.meta.url)('web-push')
const file = resolve('.env.local')
let text = existsSync(file) ? readFileSync(file, 'utf8') : ''
const line = (name) => new RegExp('^\\s*' + name + '\\s*=([^\\r\\n]*)', 'm')
const filled = (name) => Boolean(line(name).exec(text)?.[1]?.split('#')[0].trim())
function set(name, value) {
  const existing = line(name)
  const setting = name + '=' + value
  text = existing.test(text) ? text.replace(existing, '\n' + setting) : text.trimEnd() + '\n' + setting + '\n'
}
const publicKey = filled('VAPID_PUBLIC_KEY')
const privateKey = filled('VAPID_PRIVATE_KEY')
if (publicKey !== privateKey) throw new Error('Both VAPID keys must be present together. Check .env.local.')
if (!line('NVIDIA_API_KEY').test(text)) set('NVIDIA_API_KEY', '')
if (!filled('NIGHTWATCH_CONTROL_CODE')) set('NIGHTWATCH_CONTROL_CODE', randomBytes(24).toString('base64url'))
if (!filled('VAPID_SUBJECT')) set('VAPID_SUBJECT', 'mailto:field@example.com')
if (!publicKey) {
  const keys = webPush.generateVAPIDKeys()
  set('VAPID_PUBLIC_KEY', keys.publicKey)
  set('VAPID_PRIVATE_KEY', keys.privateKey)
}
writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 })
console.log('Field settings are ready in .env.local. Read NIGHTWATCH_CONTROL_CODE there and restart the server.')
