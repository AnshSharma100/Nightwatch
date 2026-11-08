import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseDataset } from '../packages/domain/load.ts'
import { detectIncidents } from '../packages/domain/incidents.ts'
import type { Incident } from '../packages/domain/incidents.ts'
import type { Dataset } from '../packages/domain/model.ts'
import type { DatasetUpload } from '../packages/contracts/operations.ts'

export interface Recording { data: Dataset; incidents: Incident[] }
const practicePattern = /^[\w-]{1,100}$/
const importPattern = /^[0-9a-f-]{36}$/
const cookieName = 'nw_recordings'

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function browserToken(request: IncomingMessage) {
  const value = request.headers.cookie?.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
  return value && /^[\w-]{32}$/.test(value) ? value : undefined
}

function readPractice(root: string, name: string): Recording {
  const path = join(root, name)
  const load = (file: string) => readFileSync(join(path, file), 'utf8')
  const data = parseDataset(name, load('network.json'), load('ops.json'), load('telemetry.csv'))
  return { data, incidents: detectIncidents(data) }
}

function readUpload(bundle: DatasetUpload): Recording {
  const data = parseDataset(bundle.name || 'Imported dataset', bundle.network, bundle.ops, bundle.telemetry)
  return { data, incidents: detectIncidents(data) }
}

function privateRecording(bundle: DatasetUpload) {
  const recording = readUpload(bundle)
  recording.data.networkKey = 'import:' + digest(recording.data.networkKey + '\n' + bundle.telemetry)
  return recording
}

export function operationalRecordings(root: string, archive: string, secure: boolean) {
  interface Stored { owner: string; bundle: DatasetUpload }
  interface Cached { owner?: string; recording: Recording }
  const cache = new Map<string, Cached>()

  function names() {
    if (!existsSync(join(root, 'index.json'))) return []
    const index: unknown = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))
    if (!Array.isArray(index)) throw new Error('Invalid practice dataset index.')
    return index.filter((name): name is string => typeof name === 'string' && practicePattern.test(name))
  }

  function remember(id: string, item: Cached) {
    cache.delete(id)
    if (cache.size >= 4) cache.delete(cache.keys().next().value!)
    cache.set(id, item)
    return item.recording
  }

  function find(id: string, request: IncomingMessage) {
    if (id.startsWith('practice-')) {
      const name = id.slice('practice-'.length)
      if (!practicePattern.test(name) || !names().includes(name)) return undefined
      const item = cache.get(id)
      return remember(id, item ?? { recording: readPractice(root, name) })
    }
    const token = browserToken(request)
    if (!token || !importPattern.test(id)) return undefined
    const owner = digest(token)
    const cached = cache.get(id)
    if (cached) return cached.owner === owner ? remember(id, cached) : undefined
    const path = join(archive, id + '.json')
    if (!existsSync(path)) return undefined
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Stored
    if (stored.owner !== owner) return undefined
    return remember(id, { owner, recording: privateRecording(stored.bundle) })
  }

  function upload(bundle: DatasetUpload, request: IncomingMessage, response: ServerResponse) {
    const recording = privateRecording(bundle)
    const existing = browserToken(request)
    const token = existing ?? randomBytes(24).toString('base64url')
    const owner = digest(token)
    const id = randomUUID()
    mkdirSync(archive, { recursive: true, mode: 0o700 })
    const target = join(archive, id + '.json')
    const temp = target + '.tmp'
    try {
      writeFileSync(temp, JSON.stringify({ owner, bundle } satisfies Stored), { flag: 'wx', mode: 0o600 })
      renameSync(temp, target)
    } finally {
      rmSync(temp, { force: true })
    }
    if (!existing) response.setHeader('Set-Cookie', cookieName + '=' + token + '; Path=/api; HttpOnly; SameSite=Strict; Max-Age=604800' + (secure ? '; Secure' : ''))
    remember(id, { owner, recording })
    return { id, recording }
  }

  return { find, names, upload }
}

export function recordingRegistry(root = 'public/practice') {
  const recordings = new Map<string, Recording & { owner: string }>()

  function attach(owner: string, recording: Recording) {
    const key = randomUUID()
    if (recordings.size >= 8) recordings.delete(recordings.keys().next().value!)
    recordings.set(key, { owner, ...recording })
    return key
  }

  function register(owner: string, input: unknown) {
    if (!input || typeof input !== 'object') throw new Error('Choose a dataset first.')
    const bundle = input as Partial<DatasetUpload> & { practice?: string }
    if (typeof bundle.practice === 'string' && practicePattern.test(bundle.practice)) {
      return attach(owner, readPractice(root, bundle.practice))
    }
    if (typeof bundle.network === 'string' && typeof bundle.ops === 'string' && typeof bundle.telemetry === 'string') {
      return attach(owner, privateRecording({
        name: typeof bundle.name === 'string' ? bundle.name.slice(0, 120) : undefined,
        network: bundle.network, ops: bundle.ops, telemetry: bundle.telemetry,
      }))
    }
    throw new Error('Supply the EOG network, operations and telemetry files.')
  }

  function find(id: unknown, owner: string) {
    const recording = typeof id === 'string' ? recordings.get(id) : undefined
    return recording?.owner === owner ? recording : undefined
  }

  return { register, attach, find }
}
export type RecordingRegistry = ReturnType<typeof recordingRegistry>
export type OperationalRecordings = ReturnType<typeof operationalRecordings>
