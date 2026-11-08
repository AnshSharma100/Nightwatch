import type { IncomingMessage, ServerResponse } from 'node:http'
import { isComparison, isDatasetUpload, recordingView } from '../packages/contracts/operations.ts'
import type { ComparisonRequest, OpenRecording, PlanComparison, RecordedSnapshot } from '../packages/contracts/operations.ts'
import { activeAlerts } from '../packages/domain/incidents.ts'
import { exposureInputs, summarizeOperations } from '../packages/domain/operations.ts'
import { optimize } from '../packages/domain/optimize.ts'
import { scenarioAt, simulate } from '../packages/domain/simulate.ts'
import type { Job, Plan, Scenario } from '../packages/domain/simulate.ts'
import type { SessionAuth } from './auth.ts'
import type { OperationalRecordings, Recording, RecordingRegistry } from './datasets.ts'
import { requestBody, send } from './http.ts'

function snapshot({ data, incidents }: Recording, at: number): RecordedSnapshot {
  const alerts = activeAlerts(data, incidents, at)
  return { at, alerts, summary: summarizeOperations(exposureInputs(data, alerts)) }
}

function open(id: string, recording: Recording): OpenRecording {
  return {
    id, data: recordingView(recording.data), incidents: recording.incidents,
    latest: snapshot(recording, recording.data.now),
  }
}

function immediateDispatch(scenario: Scenario): Plan {
  const jobs: Job[] = []
  for (const { facility, repairMin, alreadyShut } of scenario.failures) {
    if (jobs.length === scenario.system.fleetSize) break
    if (alreadyShut || facility.trucking.responseMin >= repairMin) continue
    const trial = { truck: jobs.length + 1, facilityId: facility.id, dispatchMin: 0, trips: 1 }
    try {
      simulate(scenario, { jobs: [...jobs, trial], shutIns: [] })
      jobs.push(trial)
    } catch {
      // Skip immediate dispatch if a truck cannot make a full trip.
    }
  }
  return { jobs, shutIns: [] }
}

function comparison(recording: Recording, input: ComparisonRequest): PlanComparison {
  const { data } = recording
  const failures = snapshot(recording, input.at).alerts.filter((alert) => alert.category === 'pump_failure' && alert.systemId === input.systemId)
  if (!data.systems.some((system) => system.id === input.systemId)) throw new Error('Select a system in this recording.')
  if (!failures.length) throw new Error('There is no ongoing pump failure in this system at that time.')
  if (failures.some((alert) => alert.levelPct === undefined)) throw new Error('Recorded tank readings are required for every failed facility in the system.')
  const scenario = scenarioAt(data, failures, input.systemId, input.at)
  const search = optimize(scenario)
  const plan = input.plan ?? (input.demo ? immediateDispatch(scenario) : null)
  return { scenario, search, operator: plan ? simulate(scenario, plan) : null }
}

export function operationsHandler(recordings: OperationalRecordings, aliases: RecordingRegistry, auth: SessionAuth, origin?: string) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const path = url.pathname
    const method = request.method
    if (path === '/api/datasets' && method === 'GET') {
      send(response, 200, recordings.names().map((name) => ({ id: 'practice-' + name, name })))
      return
    }
    if (path === '/api/datasets/import' && method === 'POST') {
      const input = await requestBody(request, 65_000_000, origin)
      if (!isDatasetUpload(input)) { send(response, 400, { error: 'Supply the EOG network, operations and telemetry files.' }); return }
      const { id, recording } = recordings.upload(input, request, response)
      send(response, 201, open(id, recording))
      return
    }
    const match = /^\/api\/datasets\/([\w-]{1,109})(?:\/(snapshot|compare|control))?$/.exec(path)
    const recording = match && recordings.find(match[1], request)
    if (!match || !recording) { send(response, 404, { error: 'Recording not found for this browser.' }); return }
    const route = match[2]
    if (!route && method === 'GET') {
      send(response, 200, open(match[1], recording))
      return
    }
    if (route === 'snapshot' && method === 'GET') {
      const at = Number(url.searchParams.get('at'))
      if (!recording.data.times.includes(at)) { send(response, 422, { error: 'Choose a timestamp in this recording.' }); return }
      send(response, 200, snapshot(recording, at))
      return
    }
    if (route === 'compare' && method === 'POST') {
      const input = await requestBody(request, 48_000, origin)
      if (!isComparison(input) || !recording.data.times.includes(input.at)) {
        send(response, 422, { error: 'Supply a recorded timestamp, system and valid plan.' }); return
      }
      send(response, 200, comparison(recording, input))
      return
    }
    if (route === 'control' && method === 'POST') {
      const session = auth.session(request)
      if (session?.person.role !== 'control') { send(response, 403, { error: 'Control-room sign-in is required.' }); return }
      await requestBody(request, 128, origin)
      send(response, 200, { id: aliases.attach(session.digest, recording) })
      return
    }
    send(response, 405, { error: 'Unsupported recording request.' })
  }
}
