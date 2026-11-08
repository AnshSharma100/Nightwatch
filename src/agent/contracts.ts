export const defaultModel = 'nvidia/nemotron-3.5-super-vl-120b-a12b'

interface Schema {
  type: string
  description?: string
  enum?: string[]
  properties?: Record<string, Schema>
  items?: Schema
  required?: string[]
  additionalProperties?: boolean
  maxItems?: number
  maxLength?: number
}

const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema =>
  ({ type: 'object', properties, required, additionalProperties: false })

const tool = (name: string, description: string, parameters = object({})) =>
  ({ type: 'function', function: { name, description, parameters } })

const assetId = { type: 'string', description: 'Exact asset ID in the current system' }
export const tools = [
  tool('answer_investigation', 'Answer the actual question directly, then explain why. fact_ids provides exact computed quantities and outcomes in expandable evidence. Do not replace the direct answer with a recommendation report.', object({
    explanation: { type: 'string', maxLength: 900, description: 'Required direct qualitative answer, two to five sentences. No numeric literals, percentages or currency amounts. Put supporting numerical facts in fact_ids. Explain the specific tradeoff or operating rule in plain language.' },
    fact_ids: { type: 'string', maxLength: 2000, description: 'Comma-separated exact F IDs from answer_facts, for example F1,F3,F8. Choose only the facts needed to answer the question.' },
  })),
  tool('get_operating_rules', 'Read authoritative simulation and field-work rules: truck mitigation, repair timing, automatic shut-in, late arrival, playback, and assignment completion.'),
  tool('get_incidents', 'Read active incidents and their detection evidence at the frozen recorded timestamp.'),
  tool('get_equipment', 'Inspect configuration and current readings for an asset in the system.', object({ asset_id: assetId })),
  tool('get_sensor_window', 'Read recorded sensor samples ending at the frozen timestamp.', object({
    asset_id: assetId,
    metric: { type: 'string', description: 'A metric listed for the equipment' },
    window_minutes: { type: 'integer', description: 'Optional lookback in minutes between 5 and 360. Defaults to 55.' },
  }, ['asset_id', 'metric'])),
  tool('forecast_shutdown', 'Calculate the tank limit countdown and remaining time to repair for each active failure.'),
  tool('inspect_fleet', 'Read shared truck availability, trip costs, travel times, and return constraints.'),
  tool('optimize_interventions', 'Run deterministic search for the least-cost response found across all failed facilities in this system.'),
  tool('simulate_alternative', 'Run a hypothetical plan through the deterministic simulator. Invalid or double-booked jobs return an error.', object({
    jobs: { type: 'array', items: object({
      truck: { type: 'integer', description: 'Fleet slot number, starting at 1' },
      facility_id: { type: 'string', description: 'Exact ID of a failed facility' },
      dispatch_min: { type: 'number', description: 'Minutes from the decision timestamp' },
      trips: { type: 'integer', description: 'Number of full trips' },
    }) },
    shut_ins: { type: 'array', items: object({
      well_id: { type: 'string', description: 'Exact well ID' },
      start_min: { type: 'number', description: 'Minutes from the decision timestamp' },
    }) },
  })),
  tool('compare_plans', 'Compare baseline, manual, recommended, and optionally a simulated alternative using calculated costs and facility outcomes.', object({
    alternative_id: { type: 'string', description: 'Optional ID returned by simulate_alternative' },
  }, [])),
  tool('draft_briefing', 'Gather verified evidence and calculated response options for a draft operator or field briefing. This tool never sends a message.', object({
    audience: { type: 'string', enum: ['operator', 'field'] },
  })),
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
