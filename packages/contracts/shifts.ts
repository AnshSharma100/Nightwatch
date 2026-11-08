import type { Person } from '../domain/personnel.ts'

export type ShiftStatus = 'off' | 'available' | 'busy'
export interface Shift {
  status: ShiftStatus
  clockedInAt: number | null
  changedAt: number | null
  expiresAt: number | null
}
export interface EngineerOnShift { person: Person; shift: Shift }

export const shiftLabel: Record<ShiftStatus, string> = {
  off: 'Off shift', available: 'Available', busy: 'Busy',
}
export function isShiftStatus(value: unknown): value is ShiftStatus {
  return value === 'off' || value === 'available' || value === 'busy'
}
