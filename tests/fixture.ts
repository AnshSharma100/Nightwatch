import { parseDataset } from '../src/engine/load.ts'

export const beginning = Date.UTC(2026, 10, 7) / 1000

export function fixture(change?: (id: string, metric: string, step: number, initial: number) => number) {
  const ids = ['A', 'B', 'C']
  const network = JSON.stringify({
    defaults: { tank_limits_pct: { warning: 85, shutdown: 92 } },
    systems: [{
      id: 'new/region', center: [31, -102], truck_yard: [31.2, -102.4],
      disposal_site: { id: 'sink', lat: 31.01, lon: -102.02, pressure_psi: 1000 },
      facilities: ids.map((id, i) => ({
        id, lat: 31 + i / 30, lon: -102 - i / 50,
        wells: [{ id: id + '/well', baseline_water_bpd: 1440, oil_bpd: 120, gas_mcfd: 0 }],
        tank: { id: id + '/tank', capacity_bbl: 600 },
        pump: { id: id + '/pump', start_level_pct: 70, stop_level_pct: 30, max_flow_bpd: 2400 },
        pipeline: { id: id + '/line', max_bpd: 3000, max_pressure_psi: 1600 },
      })),
    }],
  })
  const ops = JSON.stringify({
    prices: { oil_per_bbl: 60, gas_per_mcf: 3 }, expected_repair_hours: { pump_failure: 3 },
    emergency_trucking: { truck_capacity_bbl: 100, cost_per_trip: 100 },
    systems: { 'new/region': { emergency_fleet_size: 2,
      facilities: Object.fromEntries(ids.map((id) => [id, { response_min: 20, cycle_min: 45 }])),
    } },
  })
  const lines = ['timestamp,ts_unix,asset_id,metric,value']
  for (const step of [3, 0, 2, 1]) {
    const at = beginning + step * 300
    for (const id of ids) {
      const running = step > 0
      const readings: [string, string, number][] = [
        [id, 'inflow_bpd', 1440], [id + '/well', 'status', 1], [id + '/well', 'water_bpd', 1440],
        [id + '/tank', 'level_pct', running ? 70 - step / 10 : 69.9],
        [id + '/pump', 'status', running ? 1 : 0], [id + '/pump', 'flow_bpd', running ? 2400 : 0],
        [id + '/pump', 'discharge_psi', running ? 1150 : 1000],
        [id + '/line', 'receive_flow_bpd', running ? 2400 : 0], [id + '/line', 'pressure_psi', running ? 1050 : 1000],
      ]
      for (const [asset, metric, value] of readings) {
        lines.push([new Date(at * 1000).toISOString(), at, asset, metric, change?.(asset, metric, step, value) ?? value].join(','))
      }
    }
  }
  return { network, ops, csv: lines.join('\n') }
}

export function sampleDataset(change?: Parameters<typeof fixture>[0]) {
  const { network, ops, csv } = fixture(change)
  return parseDataset('sample', network, ops, csv)
}
