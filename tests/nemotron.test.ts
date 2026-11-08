import assert from 'node:assert/strict'
import { test } from 'node:test'
import { investigate } from '../src/agent/investigate.ts'
import type { AuditEntry, Investigation } from '../src/agent/investigate.ts'
import type { Call } from '../src/agent/contracts.ts'
import { activeAlerts, detectIncidents } from '../packages/domain/incidents.ts'
import { optimize } from '../packages/domain/optimize.ts'
import { scenarioAt } from '../packages/domain/simulate.ts'
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
    const tools = Object.fromEntries(messages.filter((message) => message.role === 'tool').map((message) => [message.tool_call_id, JSON.parse(message.content).data]))
    assert.equal(tools.get_incidents.incidents[0].asset_id, 'A/pump')
    assert.equal(tools.forecast_shutdown[0].shutdown_limit_pct, 92)
    assert.equal(tools.compare_plans.recommended.costs_usd.total, snapshot.recommended.costs.total)
    assert.ok(tools.get_sensor_window.every((point: { timestamp: string }) => Date.parse(point.timestamp) / 1000 <= snapshot.scenario.at))
    return { role: 'assistant', content: 'The response compares measured conditions and simulated costs. [[F1]]' }
  }, (entry) => audit.push(entry))
  assert.match(result, /measured conditions/)
  assert.equal(audit.length, 4)
  assert.ok(audit.every((entry) => entry.ok))
})

test('passes tool errors back to the model and requires an evidence trail', async () => {
  const audit: AuditEntry[] = []
  let round = 0
  await assert.rejects(investigate(context(), async (messages, mustUseTool) => {
    round++
    if (round === 1) return { role: 'assistant', content: null, tool_calls: [call('get_sensor_window', '{"asset_id":"unknown","metric":"level_pct"}')] }
    if (round === 2) assert.match(messages.at(-1)!.content ?? '', /asset in the current system/)
    else {
      assert.equal(mustUseTool, true)
      assert.match(messages.at(-1)!.content ?? '', /Required tool results still missing/)
    }
    return { role: 'assistant', content: 'Unsupported conclusion' }
  }, (entry) => audit.push(entry)), /did not finish checking/)
  assert.equal(round, 4)
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
    assert.equal(JSON.parse(output.content!).data.alternative.costs_usd.trucking, 200)
    return { role: 'assistant', content: 'The simulator calculated the cost of dedicating the shared fleet to this site. [[F1]]' }
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
    assert.equal(payload.chat_template_kwargs.enable_thinking, false)
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
    assert.match(messages.at(-1)!.content ?? '', /Revise/)
    return { role: 'assistant', content: 'The comparison shows the projected costs for the simulated plans. [[F1]]' }
  }, () => {})
  assert.equal(round, 3)
  assert.match(result, /projected costs/)
})


test('rejects fabricated claims instead of silently deleting the useful answer', async () => {
  let round = 0
  await assert.rejects(investigate(context(), async () => {
    round++
    if (round === 1) return { role: 'assistant', content: null, tool_calls: [call('get_incidents'), call('forecast_shutdown'), call('compare_plans')] }
    return { role: 'assistant', content: 'It costs $999999. [[F1]]' }
  }, () => {}), /could not ground/)
  assert.equal(round, 4)
})

test('asks for the missing evidence when the model ends an investigation early', async () => {
  let round = 0
  const audit: AuditEntry[] = []
  const result = await investigate(context(), async (messages, mustUseTool) => {
    round++
    if (round === 1) return { role: 'assistant', content: null, tool_calls: [call('get_incidents')] }
    if (round === 2) return { role: 'assistant', content: 'Premature conclusion.' }
    if (round === 3) {
      assert.equal(mustUseTool, true)
      assert.match(messages.at(-1)!.content ?? '', /missing: forecast_shutdown, compare_plans/)
      return { role: 'assistant', content: null, tool_calls: [call('compare_plans'), call('forecast_shutdown')] }
    }
    assert.equal(mustUseTool, false)
    return { role: 'assistant', content: 'The recorded fault and verified plan comparison explain the response. [[F1]]' }
  }, (entry) => audit.push(entry))
  assert.match(result, /verified plan comparison/)
  assert.deepEqual(audit.map(({ name }) => name), ['get_incidents', 'compare_plans', 'forecast_shutdown'])
})


test('keeps invented shutdown outcomes out of prose and resolves complete computed statements', async () => {
  const { resolveEvidence } = await import('../src/agent/evidence.ts')
  const facts = new Map([['F1', 'Recommended plan: A avoids automatic shut-in through its simulated repair horizon.']])
  assert.throws(() => resolveEvidence('Both sites avoid shutting in. [[F1]]', facts, []), /complete answer_facts/)
  assert.throws(() => resolveEvidence('The cost is $905. [[F1]]', facts, []), /complete answer_facts/)
  assert.throws(() => resolveEvidence('[[F99]]', facts, []), /only fact IDs/)
  assert.equal(resolveEvidence('This is the calculated outcome. [[F1]]', facts, []), 'This is the calculated outcome. ' + facts.get('F1'))
})

test('places computed costs, truck jobs and shutdown facts in the actual answer', async () => {
  const snapshot = context()
  const result = await investigate(snapshot, async (messages, first) => {
    if (first) return { role: 'assistant', content: null, tool_calls: [call('get_incidents'), call('forecast_shutdown'), call('compare_plans')] }
    const payload = JSON.parse(messages.find((message) => message.role === 'tool' && message.tool_call_id === 'compare_plans')!.content!)
    const facts = payload.answer_facts.filter((fact: { statement: string }) => fact.statement.startsWith('Recommended plan'))
    return { role: 'assistant', content: 'Use the computed response and review its timing. ' + facts.map((fact: { id: string }) => '[[' + fact.id + ']]').join(' ') }
  }, () => {})
  assert.match(result, /estimated total/)
  assert.match(result, /lost oil\/gas revenue/)
  assert.match(result, /automati(?:c|cally)/)
  assert.doesNotMatch(result, /filtered|\[\[F/)
})

test('final answer tool preserves verified facts while rejecting invented numbers and unknown citations', async () => {
  let round = 0
  const audit: AuditEntry[] = []
  const result = await investigate(context(), async () => {
    round++
    if (round === 1) return { role: 'assistant', content: null, tool_calls: [call('get_incidents'), call('forecast_shutdown'), call('compare_plans')] }
    if (round === 2) return { role: 'assistant', content: null, tool_calls: [call('answer_investigation', JSON.stringify({ explanation: 'Unsupported', fact_ids: 'F9999' }))] }
    return { role: 'assistant', content: null, tool_calls: [call('answer_investigation', JSON.stringify({ explanation: 'It costs $999999.', fact_ids: 'F1,F2,F1' }))] }
  }, (entry) => audit.push(entry))
  assert.match(result, /recorded pump failure/)
  assert.match(result, /tank fill/)
  assert.doesNotMatch(result, /999999|F9999|filtered/)
  assert.equal(result.split('recorded pump failure').length, 2)
  assert.equal(audit.at(-2)?.ok, false)
  assert.equal(audit.at(-1)?.ok, true)
})

test('field briefing remains an inspection draft scoped to the selected facility', async () => {
  const snapshot = { ...context(), selectedFacilityId: 'A' }
  const audit: AuditEntry[] = []
  await investigate(snapshot, async (_messages, first) => first
    ? { role: 'assistant', content: null, tool_calls: [call('get_incidents'), call('forecast_shutdown'), call('compare_plans'), call('draft_briefing', '{"audience":"field"}')] }
    : { role: 'assistant', content: 'Review the evidence before approving the inspection. [[F1]]' }, (entry) => audit.push(entry))
  const briefing = audit.find((entry) => entry.name === 'draft_briefing')!.result as { instructions: string[] }
  assert.equal(briefing.instructions.length, 1)
  assert.match(briefing.instructions[0], /Inspect A\/pump at A/)
  assert.match(briefing.instructions[0], /does not authorize equipment changes/)
  assert.ok(briefing.instructions[0].length <= 500)
})

test('requires comparison of the actual simulated alternative before publishing an answer', async () => {
  let round = 0
  const audit: AuditEntry[] = []
  const result = await investigate(context(), async () => {
    round++
    if (round === 1) return { role: 'assistant', content: null, tool_calls: [call('get_incidents'), call('forecast_shutdown'), call('compare_plans'), call('simulate_alternative', '{"jobs":[{"truck":1,"facility_id":"A","dispatch_min":0,"trips":1}],"shut_ins":[]}')] }
    if (round === 2) return { role: 'assistant', content: null, tool_calls: [call('answer_investigation', '{"explanation":"Compare the plans.","fact_ids":"F1"}')] }
    if (round === 3) return { role: 'assistant', content: null, tool_calls: [call('compare_plans', '{"alternative_id":"alternative-1"}')] }
    return { role: 'assistant', content: null, tool_calls: [call('answer_investigation', '{"explanation":"Compare the plans.","fact_ids":"F1"}')] }
  }, (entry) => audit.push(entry))
  assert.equal(audit.find((entry) => entry.name === 'answer_investigation')?.ok, false)
  assert.match(result, /The proposed alternative costs/)
  assert.match(result, /Compared with the recommended plan/)
})
