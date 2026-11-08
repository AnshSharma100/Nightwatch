import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { hydrateRecording } from '../packages/contracts/operations.ts'
import type { OpenRecording, PlanComparison, RecordedSnapshot } from '../packages/contracts/operations.ts'
import { detectIncidents, activeAlerts } from '../packages/domain/incidents.ts'
import { parseDataset } from '../packages/domain/load.ts'
import { optimize } from '../packages/domain/optimize.ts'
import { scenarioAt } from '../packages/domain/simulate.ts'
import { sessionAuth } from '../server/auth.ts'
import { operationalRecordings, recordingRegistry } from '../server/datasets.ts'
import { operationsHandler } from '../server/operations.ts'
import { workspaceStore } from '../server/store.ts'
import { fixture } from './fixture.ts'

test('recording API isolates imported evidence and computes both plans from the same recorded snapshot', async () => {
  const root = join(process.cwd(), '.nightwatch')
  mkdirSync(root, { recursive: true })
  const path = mkdtempSync(join(root, 'test-recordings-'))
  try {
    const auth = sessionAuth(workspaceStore(join(path, 'workflow.json')), 'control-code')
    const aliases = recordingRegistry()
    const createHandler = () => operationsHandler(operationalRecordings(path, path, false), aliases, auth)
    let handler = createHandler()
    async function request<T>(route: string, body?: unknown, cookie?: string) {
      const url = new URL(route, 'http://localhost')
      const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {
        method: body ? 'POST' : 'GET',
        headers: { host: 'localhost', 'content-type': 'application/json', cookie },
      }) as unknown as IncomingMessage
      let status = 0
      let data: T | undefined
      let setCookie = ''
      const res = {
        setHeader(_name: string, value: string) { setCookie = value },
        writeHead(code: number) { status = code },
        end(json: string) { data = JSON.parse(json) as T },
      } as unknown as ServerResponse
      await handler(req, res, url)
      return { status, data: data!, cookie: setCookie.split(';')[0] }
    }

    const samples = fixture((id, metric, step, value) =>
      id === 'A/pump' && metric === 'status' && step >= 2 ? 2 : value)
    const imported = await request<OpenRecording>('/api/datasets/import', { network: samples.network, ops: samples.ops, telemetry: samples.csv })
    assert.equal(imported.status, 201)
    const { id, latest } = imported.data
    const source = parseDataset('original', samples.network, samples.ops, samples.csv)
    assert.deepEqual(hydrateRecording(imported.data.data).telemetry, source.telemetry)
    const expected = optimize(scenarioAt(source, activeAlerts(source, detectIncidents(source), source.now), 'new/region', source.now))
    assert.equal(latest.alerts[0]?.assetId, 'A/pump')
    assert.equal((await request('/api/datasets/' + id)).status, 404)

    handler = createHandler()
    const restored = await request<OpenRecording>('/api/datasets/' + id, undefined, imported.cookie)
    assert.equal(restored.data.data.networkKey, imported.data.data.networkKey)
    const at = source.times[0]
    const past = await request<RecordedSnapshot>('/api/datasets/' + id + '/snapshot?at=' + at, undefined, imported.cookie)
    assert.deepEqual(past.data.alerts, [])
    const input = { at: source.now, systemId: 'new/region' }
    const first = await request<PlanComparison>('/api/datasets/' + id + '/compare', input, imported.cookie)
    assert.equal(first.data.operator, null)
    assert.deepEqual(first.data.search.best.costs, expected.best.costs)
    const run = await request<PlanComparison>('/api/datasets/' + id + '/compare', { ...input, plan: expected.best.plan }, imported.cookie)
    assert.deepEqual(run.data.operator?.costs, expected.best.costs)
    const invalid = await request('/api/datasets/' + id + '/compare', {
      ...input, plan: { jobs: [{ facilityId: 'A', truck: 1, trips: 1000000, dispatchMin: 0 }], shutIns: [] },
    }, imported.cookie)
    assert.equal(invalid.status, 422)
    assert.equal((await request('/api/datasets/' + id + '/control', {}, imported.cookie)).status, 403)

    const another = await request<OpenRecording>('/api/datasets/import', {
      network: samples.network, ops: samples.ops, telemetry: samples.csv.replace(',A/well,water_bpd,1440', ',A/well,water_bpd,1430'),
    }, imported.cookie)
    assert.notEqual(another.data.data.networkKey, imported.data.data.networkKey)
  } finally {
    for (const name of readdirSync(path)) rmSync(join(path, name))
    rmdirSync(path)
  }
});
