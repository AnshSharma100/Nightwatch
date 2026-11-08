import type { Category } from '../engine/incidents.ts'

export const titleFor: Record<Category, string> = {
  pump_failure: 'Pump failure',
  pipeline_leak: 'Pipeline leak',
  pump_degradation: 'Pump degradation',
}
export const number = (value: number | undefined, digits = 1) => value === undefined ? '—' :
  new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
export const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
export const utc = (at: number) => new Date(at * 1000).toISOString().slice(11, 16) + ' UTC'
export const stamp = (at: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(at * 1000) + ' UTC'
export const duration = (minutes: number | null) => {
  if (minutes === null) return '—'
  const rounded = Math.max(0, Math.ceil(minutes))
  const hours = Math.floor(rounded / 60)
  return hours ? hours + 'h ' + String(rounded % 60).padStart(2, '0') + 'm' : rounded + ' min'
}
export const practiceLabel = (name: string) => {
  if (name === 'full_week') return 'Full week · Oct 5–11'
  if (name === 'test') return 'Judging dataset'
  const match = /^(snapshot|mock_test)_(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})$/.exec(name)
  if (!match) return name
  return (match[1] === 'snapshot' ? 'Snapshot' : 'Mock test') + ' · ' +
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(+match[2], +match[3] - 1, +match[4])) +
    ' ' + match[5] + ':' + match[6] + ' UTC'
}
