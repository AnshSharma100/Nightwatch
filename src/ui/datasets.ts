import { hydrateRecording } from '../../packages/contracts/operations.ts'
import type { ComparisonRequest, OpenRecording, PlanComparison, RecordedSnapshot } from '../../packages/contracts/operations.ts'
import type { Dataset } from '../../packages/domain/model.ts'
import { jsonRequest, workflowJson } from './useWorkflow.ts'

const filenames = ['network.json', 'ops.json', 'telemetry.csv'] as const
const endpoint = '/api/datasets'
const recordingIds = new WeakMap<Dataset, string>()
const registered = new WeakMap<Dataset, string>()

function path(data: Dataset, suffix: string) {
  const id = recordingIds.get(data)
  if (!id) throw new Error('Reload this recording before continuing.')
  return endpoint + '/' + encodeURIComponent(id) + suffix
}

function hydrate(result: OpenRecording) {
  const data = hydrateRecording(result.data)
  recordingIds.set(data, result.id)
  return { ...result, data }
}

export type LoadedRecording = ReturnType<typeof hydrate>

export async function practiceNames() {
  const names = await workflowJson<{ id: string; name: string }[]>(endpoint)
  return names.map(({ name }) => name)
}

export async function loadRecording(id: string) {
  return hydrate(await workflowJson<OpenRecording>(endpoint + '/' + encodeURIComponent(id)))
}

export function loadPractice(name: string) {
  return loadRecording('practice-' + name)
}

export async function loadUpload(files: FileList) {
  const selected = Array.from(files)
  const [network, ops, telemetry] = filenames.map((name) => {
    const matches = selected.filter((file) => file.name.toLowerCase() === name)
    if (matches.length !== 1) throw new Error('Select exactly one ' + name)
    return matches[0]
  })
  if (network.size > 1_000_000 || ops.size > 1_000_000 || telemetry.size > 60_000_000) throw new Error('One of the EOG files exceeds the import size limit.')
  const [networkText, opsText, telemetryText] = await Promise.all([network.text(), ops.text(), telemetry.text()])
  return hydrate(await workflowJson<OpenRecording>(endpoint + '/import', jsonRequest({
    name: network.webkitRelativePath.split('/')[0].slice(0, 120) || 'Imported dataset',
    network: networkText, ops: opsText, telemetry: telemetryText,
  })))
}

export function recordedSnapshot(data: Dataset, at: number, signal: AbortSignal) {
  return workflowJson<RecordedSnapshot>(path(data, '/snapshot?at=' + at), { signal })
}

export function comparePlans(data: Dataset, input: ComparisonRequest, signal: AbortSignal) {
  return workflowJson<PlanComparison>(path(data, '/compare'), { ...jsonRequest(input), signal })
}

export async function registerInvestigationDataset(data: Dataset, signal: AbortSignal, refresh = false) {
  const cached = registered.get(data)
  if (cached && !refresh) return cached
  const result = await workflowJson<{ id: string }>(path(data, '/control'), { ...jsonRequest({}), signal })
  registered.set(data, result.id)
  return result.id
}
