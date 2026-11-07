import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { CatmullRomCurve3, Group, Mesh, Quaternion, Vector3 } from 'three'
import type { Position } from './layout.ts'

type Click = (event: ThreeEvent<MouseEvent>) => void

export const palette = {
  metal: '#d1d0b6', edge: '#626b60', roof: '#a98560', ground: '#55614c',
  water: '#66b7b7', dryPipe: '#637c78', fault: '#f28168', caution: '#efb36d', light: '#eed29b',
}

export function Block({ at, size, color, rotation = 0, cast = false }: {
  at: Position; size: Position; color: string; rotation?: number; cast?: boolean
}) {
  return <mesh position={at} rotation={[0, rotation, 0]} castShadow={cast} receiveShadow>
    <boxGeometry args={size} /><meshStandardMaterial color={color} roughness={.86} flatShading />
  </mesh>
}

export function Cylinder({ at, top, bottom = top, height, color, rotation, sides = 12 }: {
  at: Position; top: number; bottom?: number; height: number; color: string; rotation?: Position; sides?: number
}) {
  return <mesh position={at} rotation={rotation} castShadow receiveShadow><cylinderGeometry args={[top, bottom, height, sides]} /><meshStandardMaterial color={color} flatShading roughness={.8} /></mesh>
}

export function Marker({ radius, color, at = [0, .02, 0] }: { radius: number; color: string; at?: Position }) {
  return <mesh position={at} rotation={[-Math.PI / 2, 0, 0]}>
    <ringGeometry args={[radius - .065, radius, 32]} /><meshBasicMaterial color={color} transparent opacity={.9} depthWrite={false} />
  </mesh>
}

export function Tank({ at, fill, limit, selected, onClick }: {
  at: Position; fill?: number; limit: number; selected: boolean; onClick: Click
}) {
  const fraction = Math.min(1, Math.max(0, (fill ?? 0) / 100))
  const height = 1.55
  const liquid = useRef<Mesh>(null)
  useFrame((_, delta) => {
    if (!liquid.current) return
    const next = liquid.current.scale.y + (fraction - liquid.current.scale.y) * Math.min(1, delta * 9)
    liquid.current.scale.y = Math.max(.002, next)
    liquid.current.position.y = .21 + next * height / 2
  })
  return <group position={at} onClick={onClick}>
    <Cylinder at={[0, .11, 0]} top={.9} height={.2} color="#7c8070" />
    <mesh ref={liquid} position={[0, .21 + fraction * height / 2, 0]} scale={[1, Math.max(.002, fraction), 1]} visible={fill !== undefined}>
      <cylinderGeometry args={[.75, .75, height, 20]} />
      <meshStandardMaterial color={fraction >= limit / 100 ? '#c29568' : '#64adad'} flatShading roughness={.35} metalness={.1} />
    </mesh>
    <mesh position={[0, .99, 0]}>
      <cylinderGeometry args={[.84, .84, height, 20, 1, true]} />
      <meshStandardMaterial color="#a7bab0" transparent opacity={.28} depthWrite={false} side={2} />
    </mesh>
    {[.22, .72, 1.25, 1.77].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[.83, y > 1.7 ? .062 : .035, 5, 20]} /><meshStandardMaterial color={y > 1.7 ? '#d6d5b9' : '#9eae9b'} flatShading />
    </mesh>)}
    {[0, 1, 2, 3, 4, 5].map((i) => <Block key={i} at={[Math.cos(i * Math.PI / 3) * .835, .94, Math.sin(i * Math.PI / 3) * .835]} size={[.075, 1.52, .075]} color="#8b9c87" />)}
    <Block at={[.67, .95, .55]} size={[.12, 1.64, .09]} color="#d2ba8c" />
    {selected && <Marker radius={1.05} color={palette.light} />}
  </group>
}

export function Pump({ at, status, warning, selected, onClick }: {
  at: Position; status?: number; warning: boolean; selected: boolean; onClick: Click
}) {
  const color = status === 2 ? palette.fault : warning ? palette.caution : status === 1 ? '#8fc4a2' : '#788d87'
  return <group position={at} onClick={onClick}>
    <Block at={[0, .05, 0]} size={[1.25, .12, .83]} color="#555f5a" />
    <Cylinder at={[.12, .37, 0]} top={.27} height={.72} color={color} rotation={[0, 0, Math.PI / 2]} sides={10} />
    <Cylinder at={[-.33, .37, 0]} top={.34} height={.23} color="#71867d" rotation={[0, 0, Math.PI / 2]} />
    {[-.03, .15, .31].map((x) => <Cylinder key={x} at={[x, .37, 0]} top={.285} height={.035} color="#758982" rotation={[0, 0, Math.PI / 2]} />)}
    <Block at={[.14, .67, 0]} size={[.37, .15, .32]} color={color} />
    <mesh position={[.23, .76, .02]}><sphereGeometry args={[.075, 7, 6]} /><meshBasicMaterial color={color} /></mesh>
    {(status === 2 || warning || selected) && <Marker radius={.8} color={status === 2 || warning ? color : palette.light} />}
  </group>
}

export function WellHead({ at, status, selected, onClick, reduced }: {
  at: Position; status?: number; selected: boolean; onClick: Click; reduced: boolean
}) {
  const beam = useRef<Group>(null)
  const active = status === 1
  useFrame(({ clock }) => {
    if (beam.current) beam.current.rotation.z = active && !reduced ? .12 * Math.sin(clock.elapsedTime * 2.1 + at[0]) : -.08
  })
  return <group position={at} onClick={onClick}>
    <Block at={[0, .07, 0]} size={[1.04, .14, .78]} color="#8c8066" />
    <mesh position={[0, .52, 0]} castShadow><cylinderGeometry args={[.09, .34, .8, 4]} /><meshStandardMaterial color="#765e46" flatShading /></mesh>
    <group position={[0, .92, 0]} ref={beam}>
      <Block at={[0, 0, 0]} size={[.94, .13, .16]} color={active ? '#ddac6e' : '#8c8e7c'} />
      <Cylinder at={[.45, -.05, 0]} top={.2} height={.26} color="#bb8c58" rotation={[Math.PI / 2, 0, 0]} sides={7} />
    </group>
    <Cylinder at={[.48, .42, 0]} top={.028} height={.55} color="#c1c0a5" sides={6} />
    {selected && <Marker radius={.58} color={palette.light} />}
  </group>
}

export function Pipe({ points, color, active, reduced, onClick, small = false }: {
  points: Position[]; color: string; active: boolean; reduced: boolean; onClick?: Click; small?: boolean
}) {
  const path = useMemo(() => new CatmullRomCurve3(points.map((point) => new Vector3(...point)), false, 'catmullrom', .15), [points])
  const arrows = useRef<(Mesh | null)[]>([])
  const heading = useMemo(() => new Quaternion(), [])
  const up = useMemo(() => new Vector3(0, 1, 0), [])
  const length = path.getLength()
  const count = Math.max(1, Math.min(7, Math.floor(length / 2.6)))
  useFrame(({ clock }) => {
    if (!active || reduced) return
    for (let index = 0; index < count; index++) {
      const arrow = arrows.current[index]
      if (!arrow) continue
      const progress = (clock.elapsedTime * 1.65 / Math.max(.5, length) + index / count) % 1
      arrow.position.copy(path.getPointAt(progress))
      arrow.position.y += .1
      heading.setFromUnitVectors(up, path.getTangentAt(progress).normalize())
      arrow.quaternion.copy(heading)
    }
  })
  return <group onClick={onClick}>
    <mesh><tubeGeometry args={[path, small ? 12 : 26, small ? .053 : .115, 6, false]} /><meshStandardMaterial color={color} roughness={.64} flatShading /></mesh>
    {active && !reduced && Array.from({ length: count }, (_, index) => <mesh key={index} ref={(mesh) => { arrows.current[index] = mesh }} position={points[0]}>
      <coneGeometry args={[small ? .055 : .12, small ? .18 : .34, 4]} /><meshBasicMaterial color={small ? '#9cddd0' : '#b0e5ce'} />
    </mesh>)}
  </group>
}

export function Disposal({ at, selected, onClick }: { at: Position; selected: boolean; onClick: Click }) {
  return <group position={at} onClick={onClick}>
    <Block at={[0, .06, 0]} size={[4.4, .12, 3.7]} color="#a09679" />
    <Block at={[-.55, .55, -.25]} size={[2.12, .9, 1.55]} color="#8e9a8a" cast />
    <Block at={[-.55, 1.04, -.25]} size={[2.3, .12, 1.75]} color="#435d56" cast />
    {[-1.23, -.7, -.17].map((x) => <Block key={x} at={[x, .71, .54]} size={[.31, .28, .035]} color="#9eb9aa" />)}
    <Block at={[-.58, .36, .55]} size={[.31, .52, .06]} color="#5c6b5e" />
    <Cylinder at={[1.2, .71, -.41]} top={.51} height={1.28} color="#98a591" />
    <Cylinder at={[1.2, 1.39, -.41]} top={.48} bottom={.55} height={.15} color="#b3b6a0" />
    <Cylinder at={[1.17, .26, .69]} top={.135} height={1.45} color="#688b81" rotation={[0, 0, Math.PI / 2]} />
    <Cylinder at={[-1.36, 1.37, -.65]} top={.13} height={.71} color="#697970" />
    {selected && <Marker radius={2} color={palette.light} />}
  </group>
}

export function TruckModel({ at, shade = '#bf9360', rotation = 0 }: { at: Position; shade?: string; rotation?: number }) {
  return <group position={at} rotation={[0, rotation, 0]}>
    <Block at={[0, .25, 0]} size={[1.67, .17, .62]} color="#444a48" />
    <Block at={[.56, .52, 0]} size={[.58, .48, .62]} color={shade} cast />
    <Block at={[.86, .61, 0]} size={[.025, .19, .47]} color="#536b68" />
    <Cylinder at={[-.3, .54, 0]} top={.29} height={1.01} color="#bec4b1" rotation={[0, 0, Math.PI / 2]} sides={9} />
    <Cylinder at={[-.34, .85, 0]} top={.09} height={.07} color="#798c80" sides={8} />
    {[-.63, -.29, .59].flatMap((x) => [-.34, .34].map((z) => <Cylinder key={x + ':' + z} at={[x, .2, z]} top={.14} height={.095} color="#303d3d" rotation={[Math.PI / 2, 0, 0]} sides={8} />))}
  </group>
}

export function Yard({ at, slots, selected, onClick }: { at: Position; slots: number; selected: boolean; onClick: Click }) {
  const visible = Math.min(slots, 12)
  const cols = Math.max(2, Math.min(4, visible))
  const rows = Math.max(1, Math.ceil(visible / cols))
  return <group position={at} onClick={onClick}>
    <Block at={[0, .055, 0]} size={[cols * 1.92 + .4, .11, rows * 1.02 + 1.75]} color="#6b7464" />
    <Block at={[0, .1, -rows * .5 - .57]} size={[cols * 1.72, .2, .72]} color="#b29e7c" />
    <Block at={[0, .65, -rows * .5 - .64]} size={[1.8, 1.02, .73]} color="#a99b7b" cast />
    <Block at={[0, 1.18, -rows * .5 - .64]} size={[1.95, .13, .85]} color="#657a6d" />
    {Array.from({ length: visible }, (_, i) => {
      const x = (i % cols - (cols - 1) / 2) * 1.87
      const z = Math.floor(i / cols) * 1.04 - rows * .5 + .7
      return <group key={i}><Block at={[x, .125, z + .43]} size={[1.7, .015, .038]} color="#b9ad88" /><TruckModel at={[x, .11, z]} shade={i % 2 ? '#b39d6d' : '#c2895a'} /></group>
    })}
    {selected && <Marker radius={2.25} color={palette.light} />}
  </group>
}
