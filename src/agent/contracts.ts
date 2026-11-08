export const defaultModel = 'nvidia/nemotron-3.5-super-vl-120b-a12b'

const tool = (name: string, description: string, properties: Record<string, { type: string; description: string }> = {}, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
})

export const tools = [
  tool('get_incidents', 'Read active incidents and detection evidence for this system at the frozen recorded timestamp.'),
  tool('get_sensor_window', 'Read up to 12 recorded samples for an asset in this system, ending at the decision timestamp.', {
    asset_id: { type: 'string', description: 'Exact asset ID returned by get_incidents' },
    metric: { type: 'string', description: 'A sensor metric listed for the asset' },
  }, ['asset_id', 'metric']),
  tool('forecast_shutdown', 'Read time to tank limit and the simulated no-action shutdown time through repair.'),
  tool('compare_plans', 'Read calculated system-wide costs, trip schedules, well shut-ins, and outcomes for the current manual response and recommendation.'),
]

export interface Call {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Call[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface Completion {
  role: 'assistant'
  content: string | null
  tool_calls?: Call[]
}
