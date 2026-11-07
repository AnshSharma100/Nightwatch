import { sensorMetrics, STEP_SECONDS } from './model.ts'
import type { Asset, Dataset, Facility, Metric, Point, System } from './model.ts'

type JsonObject = Record<string, unknown>
const fail = (path: string, message: string): never => { throw new Error(path + ' · ' + message) }

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object')
  return value as JsonObject
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'expected a nonempty list')
  return value as unknown[]
}

function number(value: unknown, path: string, min = 0, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return fail(path, 'number outside permitted range')
  }
  return value
}

function id(value: unknown, path: string) {
  if (typeof value !== 'string' || !value.trim()) return fail(path, 'expected an asset identifier')
  return value
}

function location(lat: unknown, lon: unknown, path: string): [number, number] {
  return [number(lat, path + '.lat', -90, 90), number(lon, path + '.lon', -180, 180)]
}

function pair(value: unknown, path: string) {
  if (!Array.isArray(value) || value.length !== 2) return fail(path, 'expected [latitude, longitude]')
  return location(value[0], value[1], path)
}

function json(text: string, path: string): JsonObject {
  let value: unknown
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { return fail(path, 'invalid JSON') }
  return object(value, path)
}

function csvRow(line: string): string[] {
  if (!line.includes('"')) return line.split(',')
  const fields = []
  let position = 0
  while (position <= line.length) {
    if (line[position] !== '"') {
      const comma = line.indexOf(',', position)
      const end = comma < 0 ? line.length : comma
      const field = line.slice(position, end)
      if (field.includes('"')) throw new Error('invalid CSV quote')
      fields.push(field)
      position = end + 1
      continue
    }
    position++
    let field = ''
    for (;;) {
      if (position === line.length) throw new Error('unclosed CSV quote')
      const char = line[position++]
      if (char !== '"') { field += char; continue }
      if (line[position] === '"') { field += '"'; position++; continue }
      if (position < line.length && line[position] !== ',') throw new Error('invalid quoted field')
      break
    }
    fields.push(field)
    position++
  }
  return fields
}

export function parseDataset(name: string, networkText: string, opsText: string, csv: string): Dataset {
  const network = json(networkText, 'network.json')
  const ops = json(opsText, 'ops.json')
  const limits = object(object(network.defaults, 'defaults').tank_limits_pct, 'tank_limits_pct')
  const warningPct = number(limits.warning, 'warning', 0, 100)
  const shutdownPct = number(limits.shutdown, 'shutdown', 0, 100)
  if (warningPct >= shutdownPct) fail('tank_limits_pct', 'warning must precede shutdown')
  const pricesJson = object(ops.prices, 'prices')
  const prices = { oil: number(pricesJson.oil_per_bbl, 'oil_per_bbl'), gas: number(pricesJson.gas_per_mcf, 'gas_per_mcf') }
  const repairHours = number(object(ops.expected_repair_hours, 'expected_repair_hours').pump_failure, 'pump_failure repair hours', Number.EPSILON)
  const trucking = object(ops.emergency_trucking, 'emergency_trucking')
  const truckCapacityBbl = number(trucking.truck_capacity_bbl, 'truck_capacity_bbl', Number.EPSILON)
  const truckCost = number(trucking.cost_per_trip, 'cost_per_trip')
  const systemOps = object(ops.systems, 'ops.systems')
  const assets = new Map<string, Asset>()
  const facilities = new Map<string, Facility>()
  function register(asset: Asset) {
    if (assets.has(asset.id)) fail(asset.id, 'duplicate asset ID')
    assets.set(asset.id, asset)
  }
  const systems: System[] = list(network.systems, 'network.systems').map((entry) => {
    const raw = object(entry, 'system')
    const systemId = id(raw.id, 'system.id')
    const config = object(Object.hasOwn(systemOps, systemId) ? systemOps[systemId] : undefined, 'ops.' + systemId)
    const facilityOps = object(config.facilities, 'ops.' + systemId + '.facilities')
    const fleetSize = number(config.emergency_fleet_size, systemId + ' fleet size')
    if (!Number.isSafeInteger(fleetSize)) fail(systemId, 'fleet size must be an integer')
    const disposal = object(raw.disposal_site, systemId + ' disposal_site')
    const disposalId = id(disposal.id, systemId + ' disposal.id')
    register({ id: systemId, kind: 'system', systemId })
    register({ id: disposalId, kind: 'disposal', systemId })
    return {
      id: systemId,
      center: pair(raw.center, systemId + ' center'),
      truckYard: pair(raw.truck_yard, systemId + ' truck_yard'),
      disposal: { id: disposalId, location: location(disposal.lat, disposal.lon, disposalId), pressurePsi: number(disposal.pressure_psi, disposalId + ' pressure_psi') },
      fleetSize,
      facilities: list(raw.facilities, systemId + ' facilities').map((entry) => {
        const raw = object(entry, systemId + ' facility')
        const facilityId = id(raw.id, systemId + ' facility.id')
        const travel = object(Object.hasOwn(facilityOps, facilityId) ? facilityOps[facilityId] : undefined, 'ops.' + facilityId)
        const tank = object(raw.tank, facilityId + ' tank')
        const pump = object(raw.pump, facilityId + ' pump')
        const pipeline = object(raw.pipeline, facilityId + ' pipeline')
        const tankId = id(tank.id, facilityId + ' tank.id')
        const pumpId = id(pump.id, facilityId + ' pump.id')
        const pipelineId = id(pipeline.id, facilityId + ' pipeline.id')
        register({ id: facilityId, kind: 'facility', systemId, facilityId })
        register({ id: tankId, kind: 'tank', systemId, facilityId })
        register({ id: pumpId, kind: 'pump', systemId, facilityId })
        register({ id: pipelineId, kind: 'pipeline', systemId, facilityId })
        const startPct = number(pump.start_level_pct, pumpId + ' start level', 0, 100)
        const stopPct = number(pump.stop_level_pct, pumpId + ' stop level', 0, 100)
        if (stopPct >= startPct || startPct >= shutdownPct) fail(pumpId, 'expected stop < start < shutdown')
        const facility: Facility = {
          id: facilityId,
          systemId,
          location: location(raw.lat, raw.lon, facilityId),
          tank: { id: tankId, capacityBbl: number(tank.capacity_bbl, tankId + ' capacity_bbl', Number.EPSILON) },
          pump: { id: pumpId, maxFlowBpd: number(pump.max_flow_bpd, pumpId + ' max_flow_bpd', Number.EPSILON), startPct, stopPct },
          pipeline: { id: pipelineId, maxBpd: number(pipeline.max_bpd, pipelineId + ' max_bpd', Number.EPSILON), maxPressurePsi: number(pipeline.max_pressure_psi, pipelineId + ' max_pressure_psi', Number.EPSILON) },
          trucking: { responseMin: number(travel.response_min, facilityId + ' response_min'), cycleMin: number(travel.cycle_min, facilityId + ' cycle_min', Number.EPSILON) },
          wells: list(raw.wells, facilityId + ' wells').map((entry) => {
            const well = object(entry, facilityId + ' well')
            const wellId = id(well.id, facilityId + ' well.id')
            register({ id: wellId, kind: 'well', systemId, facilityId })
            const oilBpd = number(well.oil_bpd, wellId + ' oil_bpd')
            const gasMcfd = number(well.gas_mcfd, wellId + ' gas_mcfd')
            return { id: wellId, oilBpd, gasMcfd, baselineWaterBpd: number(well.baseline_water_bpd, wellId + ' baseline_water_bpd'), revenuePerHour: (oilBpd * prices.oil + gasMcfd * prices.gas) / 24 }
          }),
        }
        facilities.set(facilityId, facility)
        return facility
      }),
    }
  })

  const telemetry = new Map<string, Map<Metric, Point[]>>()
  for (const asset of assets.values()) {
    const metrics = sensorMetrics[asset.kind]
    if (metrics) telemetry.set(asset.id, new Map(metrics.map((metric) => [metric, []])))
  }
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/)
  const headings = csvRow(lines[0]).map((field) => field.trim())
  const columns = ['timestamp', 'ts_unix', 'asset_id', 'metric', 'value'].map((key) => headings.indexOf(key))
  if (columns.includes(-1) || new Set(headings).size !== headings.length) fail('telemetry.csv', 'invalid sensor header')
  const timesSet = new Set<number>()
  let previousTimestamp = ''
  let parsedAt = NaN
  for (let index = 1; index < lines.length; index++) {
    if (!lines[index].trim()) continue
    const row = csvRow(lines[index])
    const [timestamp, unix, asset, metric, raw] = columns.map((column) => row[column])
    const at = Number(unix)
    if (timestamp !== previousTimestamp) {
      parsedAt = Date.parse(timestamp) / 1000
      previousTimestamp = timestamp
    }
    const value = Number(raw)
    const target = telemetry.get(asset)?.get(metric as Metric)
    const validStatus = metric !== 'status' || (Number.isInteger(value) && value >= 0 && value <= (assets.get(asset)?.kind === 'pump' ? 2 : 1))
    if (row.length !== headings.length || !unix?.trim() || !raw?.trim() || !Number.isSafeInteger(at) || at !== parsedAt ||
        !Number.isFinite(value) || !validStatus || !target) {
      fail('telemetry.csv row ' + (index + 1), 'invalid timestamp, value, asset or sensor')
    }
    target!.push({ at, value })
    timesSet.add(at)
  }
  const times = [...timesSet].sort((a, b) => a - b)
  if (times.length === 0) fail('telemetry.csv', 'no sensor readings')
  if (times.some((at) => (at - times[0]) % STEP_SECONDS !== 0)) fail('telemetry.csv', 'readings must follow the five-minute grid')
  for (const [asset, metrics] of telemetry) {
    for (const [metric, points] of metrics) {
      if (!points.length) fail(asset, 'missing telemetry series ' + metric)
      points.sort((a, b) => a.at - b.at)
      if (points.some((point, i) => i > 0 && point.at === points[i - 1].at)) fail(asset, 'duplicate reading for ' + metric)
    }
  }
  return { name, systems, facilities, assets, telemetry, times, start: times[0], now: times[times.length - 1], warningPct, shutdownPct, repairHours, truckCapacityBbl, truckCost, prices }
}
