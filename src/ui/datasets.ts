import { parseDataset } from '../engine/load.ts'

const filenames = ['network.json', 'ops.json', 'telemetry.csv'] as const
const practice = import.meta.env.BASE_URL + 'practice/'

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
  return parseDataset(name, network, ops, telemetry)
}

export async function loadUpload(files: FileList) {
  const selected = Array.from(files)
  const [network, ops, telemetry] = filenames.map((name) => {
    const matches = selected.filter((file) => file.name.toLowerCase() === name)
    if (matches.length !== 1) throw new Error('Select exactly one ' + name)
    return matches[0]
  })
  const contents = await Promise.all([network.text(), ops.text(), telemetry.text()] as const)
  return parseDataset(network.webkitRelativePath.split('/')[0] || 'Imported dataset', ...contents)
}
