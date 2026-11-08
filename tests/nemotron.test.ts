import assert from 'node:assert/strict'
import { test } from 'node:test'
import { investigate } from '../src/agent/investigate.ts'
import type { AuditEntry, Investigation } from '../src/agent/investigate.ts'
import type { Call } from '../src/agent/contracts.ts'
import { activeAlerts, detectIncidents } from '../src/engine/incidents.ts'
import { optimize } from '../src/engine/optimize.ts'
import { scenarioAt } from '../src/engine/simulate.ts'
import { sampleDataset } from './fixture.ts'

function context(): Investigation {
  const data = sampleDataset((asset, metric, _step, value) => asset === 'A/pump' && metric === 'status' ? 2 : value)
  const at = data.now - 300
  const alerts = activeAlerts(data, detectIncidents(data), at)
  const scenario = scenarioAt(data, alerts, data.systems[0].id, at)
  const { baseline, best } = optimize(scenario)
  return { data, alerts, scenario, baseline, manual: baseline, recommended: best }
}

function call(name: string, args = '{}'): Call {
  return { id: name, type: 'function', function: { name, arguments: args } }
}

test('executes real analysis tools on the frozen snapshot and returns model explanation', async () => {
  const snapshot = context()
  const audit: AuditEntry[] = []
  const result = await investigate(snapshot, async (messages, first) => {
    if (first) return {
      role: 'assistant', content: null, tool_calls: [
        call('get_incidents'), call('forecast_shutdown'), call('compare_plans'),
        call('get_sensor_window', '{"asset_id":"A/tank","metric":"level_pct"}'),
      ],
    }
    const tools = Object.fromEntries(messages.filter((message) => message.role === 'tool').map((message) => [message.tool_call_id, JSON.parse(message.content)]))
    assert.equal(tools.get_incidents.incidents[0].asset_id, 'A/pump')
    assert.equal(tools.forecast_shutdown[0].shutdown_limit_pct, 92)
    assert.equal(tools.compare_plans.recommended.costs_usd.total, snapshot.recommended.costs.total)
    assert.ok(tools.get_sensor_window.every((point: { timestamp: string }) => Date.parse(point.timestamp) / 1000 <= snapshot.scenario.at))
    return { role: 'assistant', content: 'The response compares measured conditions and simulated costs.' }
  }, (entry) => audit.push(entry))
  assert.match(result, /measured conditions/)
  assert.equal(audit.length, 4)
  assert.ok(audit.every((entry) => entry.ok))
})

test('passes tool errors back to the model and requires an evidence trail', async () => {
  const audit: AuditEntry[] = []
  await assert.rejects(investigate(context(), async (messages, first) => {
    if (first) return { role: 'assistant', content: null, tool_calls: [call('get_sensor_window', '{"asset_id":"unknown","metric":"level_pct"}')] }
    const result = messages.at(-1)!
    assert.match(result.content ?? '', /asset in the current system/)
    return { role: 'assistant', content: 'Unsupported conclusion' }
  }, (entry) => audit.push(entry)), /did not finish checking/)
  assert.deepEqual(audit.map(({ name, ok }) => ({ name, ok })), [{ name: 'get_sensor_window', ok: false }])
})

test('uses the same simulator for an operator question about a truck alternative', async () => {
  const snapshot = context()
  const audit: AuditEntry[] = []
  const question = 'What happens if I send both trucks to A?'
  const job = (truck: number) => ({ truck, facility_id: 'A', dispatch_min: 0, trips: 1 })
  let round = 0
  const result = await investigate(snapshot, async (messages) => {
    assert.equal(messages[1].content, question)
    round++
    if (round === 1) return {
      role: 'assistant', content: null, tool_calls: [call('get_incidents'), call('forecast_shutdown'),
        call('inspect_fleet'), call('get_equipment', '{"asset_id":"A/pump"}'),
        call('simulate_alternative', JSON.stringify({ jobs: [job(1), job(2)], shut_ins: [] }))],
    }
    if (round === 2) return {
      role: 'assistant', content: null, tool_calls: [call('compare_plans', '{"alternative_id":"alternative-1"}'),
        call('optimize_interventions'), call('draft_briefing', '{"audience":"field"}')],
    }
    const output = messages.find((message) => message.role === 'tool' && message.tool_call_id === 'compare_plans')
    assert.ok(output)
    assert.equal(JSON.parse(output.content!).alternative.costs_usd.trucking, 200)
    return { role: 'assistant', content: 'The simulator calculated the cost of dedicating the shared fleet to this site.' }
  }, (entry) => audit.push(entry), question)
  assert.match(result, /simulator calculated/)
  assert.ok(audit.every((entry) => entry.ok))
})

test('scopes registered recordings to the operator session and rejects invalid model output', async () => {
  const { recordingRegistry } = await import('../server/datasets.ts')
  const { nvidiaCompletion, parseCompletion, prepareInvestigation } = await import('../server/nemotron.ts')
  const { fixture } = await import('./fixture.ts')
  const source = fixture()
  const registry = recordingRegistry()
  const id = registry.register('session-one', { network: source.network, ops: source.ops, telemetry: source.csv })
  assert.equal(registry.find(id, 'unrelated-session'), undefined)
  const recording = registry.find(id, 'session-one')!
  assert.throws(() => prepareInvestigation(recording, { at: recording.data.now + 10, systemId: 'new/region' }), /recorded timestamp/)
  assert.throws(() => parseCompletion({ choices: [{ message: { role: 'assistant', tool_calls: [{ type: 'function', function: {} }] } }] }), /invalid tool calls/)
  const mocked = (async (url, init) => {
    assert.equal(url, 'https://integrate.api.nvidia.com/v1/chat/completions')
    assert.equal(init?.redirect, 'error')
    const payload = JSON.parse(String(init?.body))
    assert.equal(payload.tool_choice, 'required')
    assert.ok(payload.tools.some((tool: { function: { name: string } }) => tool.function.name === 'simulate_alternative'))
    return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [call('get_incidents')] } }] })
  }) as typeof fetch
  const complete = nvidiaCompletion({ apiKey: 'fixture-token' }, AbortSignal.timeout(1000), mocked)
  assert.equal((await complete([{ role: 'user', content: 'Inspect this system.' }], true)).tool_calls?.[0].function.name, 'get_incidents')
  const upstreamError = nvidiaCompletion({}, AbortSignal.timeout(1000), (async () => new Response(null, { status: 429 })) as typeof fetch)
  await assert.rejects(upstreamError([], false), /HTTP 429/)
})

test('requests a qualitative rewrite instead of publishing unverified numbers', async () => {
  const snapshot = context()
  let round = 0
  const result = await investigate(snapshot, async (messages) => {
    round++
    if (round === 1) return { role: 'assistant', content: null, tool_calls: [call('get_incidents'), call('forecast_shutdown'), call('compare_plans')] }
    if (round === 2) return { role: 'assistant', content: 'It will cost $999999.' }
    assert.match(messages.at(-1)!.content ?? '', /Rewrite/)
    return { role: 'assistant', content: 'The comparison shows the projected costs for the simulated plans.' }
  }, () => {})
  assert.equal(round, 3)
  assert.match(result, /projected costs/)
})
