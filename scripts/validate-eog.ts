import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseDataset } from '../packages/domain/load.ts'
import { activeAlerts, detectIncidents } from '../packages/domain/incidents.ts'

const upstream = process.argv[2] ?? (existsSync('../.eog-reference') ? '../.eog-reference' : '.eog-reference')
const history = resolve(upstream, 'history')
const folders = readdirSync(history, { withFileTypes: true }).filter((dir) => dir.isDirectory()).map((dir) => join(history, dir.name))
if (existsSync(join(upstream, 'test', 'telemetry.csv'))) folders.push(resolve(upstream, 'test'))
let missed = 0
let extra = 0
let activeMismatches = 0
for (const folder of folders) {
  const name = folder.split(/[\\/]/).at(-1)!
  const load = (file: string) => readFileSync(join(folder, file), 'utf8')
  const data = parseDataset(name, load('network.json'), load('ops.json'), load('telemetry.csv'))
  const incidents = detectIncidents(data)
  const alerts = activeAlerts(data, incidents, data.now)
  console.log(name + ': ' + data.systems.map((system) => system.id + ' [' + system.facilities.map((facility) => facility.id).join(', ') + ']').join(' · '))
  console.log('  ' + incidents.length + ' episodes, ' + alerts.length + ' active: ' + alerts.map((alert) => alert.assetId + '/' + alert.category).join(', '))
  if (!existsSync(join(folder, 'answer_key.json'))) continue
  const answers: { id: string; asset: string; category: string; onset_unix: number; end_unix: number | null; status: string }[] = JSON.parse(load('answer_key.json'))
  const available = new Set(incidents)
  const missing = answers.filter((answer) => {
    const match = [...available].find((item) => item.assetId === answer.asset && item.category === answer.category &&
      item.detectedAt >= answer.onset_unix && item.detectedAt < (answer.end_unix ?? data.now + 300))
    if (match) available.delete(match)
    return !match
  })
  const expectedActive = answers.filter((answer) => answer.status === 'ongoing').map((item) => item.asset + '/' + item.category).sort()
  const actualActive = alerts.filter((alert) => alert.verified).map((alert) => alert.assetId + '/' + alert.category).sort()
  for (const alert of alerts.filter((alert) => !alert.verified)) console.log('  awaiting running evidence: ' + alert.assetId)
  console.log('  offline: ' + missing.length + ' missed (' + missing.map((answer) => answer.id).join(', ') + '), ' + available.size + ' extra (' + [...available].map((item) => item.assetId + '/' + item.category).join(', ') + ')')
  if (JSON.stringify(expectedActive) !== JSON.stringify(actualActive)) {
    activeMismatches++
    console.log('  expected active: ' + expectedActive.join(', '))
  }
  missed += missing.length
  extra += available.size
}
assert.equal(missed, 0, 'missed reference incidents')
assert.equal(extra, 0, 'extra incident episodes')
assert.equal(activeMismatches, 0, 'incorrect snapshot alert sets')
