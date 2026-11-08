import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDataset } from '../src/engine/load.ts'
import { detectIncidents } from '../src/engine/incidents.ts'
import type { Incident } from '../src/engine/incidents.ts'
import type { Dataset } from '../src/engine/model.ts'

interface Recording { owner: string; data: Dataset; incidents: Incident[] }

export function recordingRegistry() {
  const recordings = new Map<string, Recording>()

  function register(owner: string, input: unknown) {
    if (!input || typeof input !== 'object') throw new Error('Choose a dataset first.')
    const bundle = input as { practice?: string; name?: string; network?: string; ops?: string; telemetry?: string }
    let data: Dataset
    if (typeof bundle.practice === 'string' && /^[\w-]{1,100}$/.test(bundle.practice)) {
      const path = join('public', 'practice', bundle.practice)
      const load = (file: string) => readFileSync(join(path, file), 'utf8')
      data = parseDataset(bundle.practice, load('network.json'), load('ops.json'), load('telemetry.csv'))
    } else if (typeof bundle.network === 'string' && typeof bundle.ops === 'string' && typeof bundle.telemetry === 'string') {
      data = parseDataset(typeof bundle.name === 'string' ? bundle.name.slice(0, 120) : 'Imported dataset', bundle.network, bundle.ops, bundle.telemetry)
    } else throw new Error('Supply the EOG network, operations and telemetry files.')
    const key = randomUUID()
    if (recordings.size >= 4) recordings.delete(recordings.keys().next().value!)
    recordings.set(key, { owner, data, incidents: detectIncidents(data) })
    return key
  }

  function find(id: unknown, owner: string) {
    const recording = typeof id === 'string' ? recordings.get(id) : undefined
    return recording?.owner === owner ? recording : undefined
  }

  return { register, find }
}
export type RecordingRegistry = ReturnType<typeof recordingRegistry>
