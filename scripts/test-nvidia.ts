import assert from 'node:assert/strict'
import { loadEnv } from 'vite'
import { nvidiaCompletion, prepareInvestigation } from '../server/nemotron.ts'
import { recordingRegistry } from '../server/datasets.ts'
import { investigate } from '../src/agent/investigate.ts'
import { defaultModel } from '../src/agent/contracts.ts'

const env = loadEnv('development', process.cwd(), 'NVIDIA_')
if (!env.NVIDIA_API_KEY) {
  console.error('Missing NVIDIA_API_KEY. Add it to .env.local in the NIGHTWATCH repository root.')
  process.exitCode = 2
} else {
  const registry = recordingRegistry()
  const single = process.argv.includes('--s2') || process.argv.includes('--briefing')
  const id = registry.register('local-smoke', { practice: single ? 'full_week' : 'snapshot_2026-10-10T0900' })
  const recording = registry.find(id, 'local-smoke')!
  const context = prepareInvestigation(recording, single
    ? { at: Date.parse('2026-10-08T09:00:00Z') / 1000, systemId: 'S2', facilityId: 'S2_FACILITY_B' }
    : { at: recording.data.now, systemId: 'S4', facilityId: 'S4_FACILITY_A' })
  const successful = new Set<string>()
  let recommended: number | undefined
  let alternative: number | undefined
  try {
    const explanation = await investigate(context, nvidiaCompletion({
      apiKey: env.NVIDIA_API_KEY, baseUrl: env.NVIDIA_BASE_URL, model: env.NVIDIA_MODEL,
    }, AbortSignal.timeout(80_000)), (entry) => {
      if (entry.ok) {
        successful.add(entry.name)
        if (entry.name === 'compare_plans') {
          type Cost = { costs_usd?: { total?: number } }
          const result = entry.result as { recommended?: Cost; alternative?: Cost }
          recommended = result.recommended?.costs_usd?.total ?? recommended
          alternative = result.alternative?.costs_usd?.total ?? alternative
        }
      }
      console.log(entry.name, entry.ok ? 'completed' : 'returned a tool error: ' + (entry.result as { error: string }).error)
    }, process.argv.includes('--briefing') ? 'Draft a concise field briefing for the selected pump failure, for the operator to review before assigning an inspection.' : single
      ? 'What is wrong at this facility, what evidence supports it, and what should I do next?'
      : 'Why should I not send both trucks to S4_FACILITY_A? Simulate one trip from each available truck sent there now and compare the alternative with the recommended plan.')
    if (!single) assert.ok(successful.has('simulate_alternative'), 'Model did not simulate the requested alternative.')
    if (!single) assert.ok(alternative !== undefined, 'Model did not compare the alternative it simulated.')
    if (process.argv.includes('--briefing')) assert.ok(successful.has('draft_briefing'), 'Model did not prepare the briefing evidence.')
    assert.ok(successful.has('compare_plans'), 'Model did not compare computed plans.')
    assert.match(explanation, /\$/)
    assert.doesNotMatch(explanation, /filtered forecast|\[\[F\d+\]\]/)
    console.log('Live investigation passed:', env.NVIDIA_MODEL || defaultModel)
    if (recommended !== undefined) console.log('Best plan found · USD', recommended.toFixed(2))
    if (alternative !== undefined) console.log('Proposed alternative · USD', alternative.toFixed(2))
    console.log('Nemotron explanation:', explanation)
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
