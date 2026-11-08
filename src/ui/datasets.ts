import { parseDataset } from '../engine/load.ts'
import type { Dataset } from '../engine/model.ts'
import { jsonRequest, workflowJson } from './useWorkflow.ts'

const filenames = ['network.json', 'ops.json', 'telemetry.csv'] as const
const practice = import.meta.env.BASE_URL + 'practice/'
const sources = new WeakMap<Dataset, { practice: string } | { name: string; network: File; ops: File; telemetry: File }>()
const registered = new WeakMap<Dataset, string>()

async function fetchText(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load ' + url.split('/').pop())
  return response.text()
}

export async function practiceNames(): Promise<string[]> {
  const names: unknown = JSON.parse(await fetchText(practice + 'index.json'))
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) {
    throw new Error('Invalid practice dataset index')
  }
  return names
}

export async function loadPractice(name: string) {
  const [network, ops, telemetry] = await Promise.all(
    filenames.map((file) => fetchText(practice + encodeURIComponent(name) + '/' + file)),
  )
  const data = parseDataset(name, network, ops, telemetry)
  sources.set(data, { practice: name })
  return data
}

export async function loadUpload(files: FileList) {
  const selected = Array.from(files)
  const [network, ops, telemetry] = filenames.map((name) => {
    const matches = selected.filter((file) => file.name.toLowerCase() === name)
    if (matches.length !== 1) throw new Error('Select exactly one ' + name)
    return matches[0]
  })
  const contents = await Promise.all([network.text(), ops.text(), telemetry.text()] as const)
  const data = parseDataset(network.webkitRelativePath.split('/')[0] || 'Imported dataset', ...contents)
  sources.set(data, { name: data.name, network, ops, telemetry })
  return data
}

export async function registerInvestigationDataset(data: Dataset, signal: AbortSignal, refresh = false) {
  const cached = registered.get(data)
  if (cached && !refresh) return cached
  const source = sources.get(data)
  if (!source) throw new Error('Reload this recording before investigating.')
  const payload = 'practice' in source ? source : {
    name: source.name, network: await source.network.text(), ops: await source.ops.text(), telemetry: await source.telemetry.text(),
  }
  const result = await workflowJson<{ id: string }>('/api/nemotron/datasets', { ...jsonRequest(payload), signal })
  registered.set(data, result.id)
  return result.id
}
