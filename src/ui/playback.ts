import type { Frame } from '../../packages/domain/simulate.ts'

export function frameAt(frames: readonly Frame[], minute: number): Frame | undefined {
  const nextIndex = frames.findIndex((frame) => frame.minute > minute)
  if (nextIndex === -1) return frames.at(-1)
  return frames[Math.max(0, nextIndex - 1)]
}
