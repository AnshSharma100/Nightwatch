import type { Dataset, Facility, System } from '../engine/model.ts'

export type Position = [number, number, number]
type Ground = [x: number, z: number]
export interface FacilityLayout { facility: Facility; pad: Position }
export interface RegionLayout {
  system: System; center: Position; localCenter: Position; size: Ground
  disposal: Position; yard: Position; facilities: FacilityLayout[]
}
export interface WorldLayout { regions: RegionLayout[]; center: Position; size: Ground }

function project(coords: [number, number][], scale: number): Ground[] {
  const origin = coords[0]
  const lonFactor = Math.cos(origin[0] * Math.PI / 180)
  const positions: Ground[] = coords.map(([lat, lon]) => [((lon - origin[1] + 540) % 360 - 180) * lonFactor, origin[0] - lat])
  const extent = Math.max(1e-8, ...positions.flatMap(([x, z]) => [Math.abs(x), Math.abs(z)]))
  return positions.map(([x, z]) => [x / extent * scale, z / extent * scale])
}

function separate(points: Ground[], minimum: number) {
  for (let iteration = 0; iteration < 24; iteration++) {
    for (let a = 0; a < points.length; a++) {
      for (let b = a + 1; b < points.length; b++) {
        let dx = points[b][0] - points[a][0]
        let dz = points[b][1] - points[a][1]
        if (Math.hypot(dx, dz) < 0.001) { dx = Math.cos(b * 2.4) * 0.01; dz = Math.sin(b * 2.4) * 0.01 }
        const length = Math.hypot(dx, dz)
        if (length >= minimum) continue
        const push = (minimum - length) / length * .5
        points[a][0] -= dx * push
        points[a][1] -= dz * push
        points[b][0] += dx * push
        points[b][1] += dz * push
      }
    }
  }
  return points
}

const to3 = ([x, z]: Ground, y = 0): Position => [x, y, z]
function extent(points: Ground[], padding: number) {
  const xs = points.map((point) => point[0])
  const zs = points.map((point) => point[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minZ = Math.min(...zs), maxZ = Math.max(...zs)
  return { center: to3([(minX + maxX) / 2, (minZ + maxZ) / 2]), size: [maxX - minX + padding, maxZ - minZ + padding] as Ground }
}

export function layoutWorld(data: Dataset): WorldLayout {
  const regions = data.systems.map((system): RegionLayout => {
    const facilityPositions = project([system.center, ...system.facilities.map((facility) => facility.location), system.disposal.location], 10 + Math.sqrt(system.facilities.length) * 2).slice(1)
    const yardPosition = project([system.center, system.truckYard], 14)[1]
    const ground = separate([...facilityPositions, yardPosition], 8.8)
    const { center, size } = extent(ground, 9)
    return {
      system, center: [0, 0, 0], localCenter: center, size,
      disposal: to3(ground[ground.length - 2]), yard: to3(ground[ground.length - 1]),
      facilities: system.facilities.map((facility, index) => ({ facility, pad: to3(ground[index]) })),
    }
  })
  const largest = Math.max(...regions.flatMap((region) => region.size))
  const scale = largest * Math.max(1, Math.sqrt(regions.length)) * 0.54
  const positions = separate(project(data.systems.map((system) => system.center), scale), largest * 1.03)
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]
    region.center = [positions[i][0] - region.localCenter[0], 0, positions[i][1] - region.localCenter[2]]
  }
  return { regions, ...extent(positions, largest + 12) }
}

export function add(a: Position, b: Position): Position { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }

export const tankPosition: Position = [-.8, .13, -.4]
export const pumpPosition: Position = [1.55, .17, -.5]
export const pipeStart: Position = [2.25, .38, -.5]
export function wellPosition(index: number, count: number): Position {
  const columns = Math.min(4, count)
  return [(index % columns - (columns - 1) / 2) * 1.22, .11, 1.47 + Math.floor(index / columns) * 1.18]
}
