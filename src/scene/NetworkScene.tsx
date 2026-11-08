import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Object3D, Vector3 } from 'three'
import type { ComponentRef } from 'react'
import { read, yardId } from '../../packages/domain/model.ts'
import type { Dataset } from '../../packages/domain/model.ts'
import type { MapProps } from '../ui/NetworkMap.tsx'
import { Block, Cylinder, Disposal, Marker, palette, Pipe, Pump, Tank, WellHead, Yard } from './Equipment.tsx'
import { add, layoutWorld, pipeStart, pumpPosition, tankPosition, wellPosition } from './layout.ts'
import './labels.css'
import type { FacilityLayout, Position, RegionLayout, WorldLayout } from './layout.ts'

interface SceneProps extends MapProps {
  focusRequest: number
  onContextLost: () => void
}

const cameraDirection = new Vector3(.9, .98, 1.16).normalize()
const cameraRight = new Vector3(cameraDirection.z, 0, -cameraDirection.x).normalize()
const cameraUp = cameraDirection.clone().cross(cameraRight)
const halfFov = Math.tan(39 / 2 * Math.PI / 180)

function CameraRig({ target, span, bounds, focusRequest, reduced }: {
  target: Position; span: number; bounds?: Position[]; focusRequest: number; reduced: boolean
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const move = useRef(true)
  const initial = useRef(true)
  const { camera, size } = useThree()
  const destination = useMemo(() => new Vector3(...target), [target[0], target[1], target[2]])
  const aspect = Math.max(.3, size.width / Math.max(1, size.height))
  const fit = useMemo(() => {
    if (!bounds) return span / Math.min(1, aspect)
    const margin = .83
    const relative = new Vector3()
    return Math.max(4, ...bounds.map((point) => {
      relative.set(...point).sub(destination)
      const horizontal = Math.abs(relative.dot(cameraRight)) / (halfFov * aspect * margin)
      const vertical = Math.abs(relative.dot(cameraUp)) / (halfFov * margin)
      return relative.dot(cameraDirection) + Math.max(horizontal, vertical)
    }))
  }, [aspect, bounds, destination, span])
  const end = useMemo(() => destination.clone().addScaledVector(cameraDirection, fit), [destination, fit])
  useEffect(() => {
    move.current = true
    if (controls.current && (reduced || initial.current)) {
      controls.current.target.copy(destination)
      camera.position.copy(end)
      controls.current.update()
      initial.current = false
      move.current = false
    }
  }, [destination, end, reduced, camera, focusRequest])
  useFrame((_, delta) => {
    if (!move.current || !controls.current) return
    const amount = 1 - Math.exp(-delta * 5)
    controls.current.target.lerp(destination, amount)
    camera.position.lerp(end, amount)
    controls.current.update()
    if (camera.position.distanceTo(end) < .025 && controls.current.target.distanceTo(destination) < .025) move.current = false
  })
  return <OrbitControls ref={controls} makeDefault minDistance={4} maxDistance={Math.max(470, fit * 2)} enableDamping dampingFactor={.09} maxPolarAngle={Math.PI * .47}
    onStart={() => { move.current = false }} />
}

function ContextWatcher({ onLost }: { onLost: () => void }) {
  const element = useThree((state) => state.gl.domElement)
  useEffect(() => {
    element.addEventListener('webglcontextlost', onLost)
    return () => element.removeEventListener('webglcontextlost', onLost)
  }, [element, onLost])
  return null
}

function clickable(id: string, callback: (id: string) => void) {
  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.delta <= 4) callback(id)
  }
}

function siteName(id: string, systemId: string) {
  return id.startsWith(systemId + '_FACILITY_') ? 'Facility ' + id.slice(systemId.length + 10) : id
}

function Road({ a, b }: { a: Position; b: Position }) {
  const dx = b[0] - a[0], dz = b[2] - a[2]
  const length = Math.hypot(dx, dz)
  const angle = -Math.atan2(dz, dx)
  const at: Position = [(a[0] + b[0]) / 2, .012, (a[2] + b[2]) / 2]
  const count = Math.max(0, Math.floor(length / 2.4) - 1)
  return <group position={at} rotation={[0, angle, 0]}>
    <Block at={[0, 0, 0]} size={[length, .028, 1.55]} color="#7c7d66" />
    <Block at={[0, .018, 0]} size={[length, .015, 1.34]} color="#4f5d55" />
    {Array.from({ length: count }, (_, i) => <Block key={i} at={[(i - (count - 1) / 2) * 2.25, .03, 0]} size={[.68, .012, .04]} color="#abb098" />)}
  </group>
}

function Terrain({ region }: { region: RegionLayout }) {
  const { size, localCenter, facilities, disposal, yard } = region
  const props = useMemo(() => {
    const keepOut = [...facilities.map(({ pad }) => pad), disposal, yard]
    return Array.from({ length: 32 }, (_, index) => {
      const x = localCenter[0] + Math.sin(index * 17.72 + 1) * (size[0] / 2 - .7)
      const z = localCenter[2] + Math.sin(index * 11.23 + 2) * (size[1] / 2 - .7)
      return { at: [x, 0, z] as Position, index, height: .32 + (index % 4) * .12 }
    }).filter(({ at }) => keepOut.every((point) => Math.hypot(at[0] - point[0], at[2] - point[2]) > 4.1))
  }, [region])
  return <group>
    <Block at={[localCenter[0], -.69, localCenter[2]]} size={[size[0] - .4, .57, size[1] - .4]} color="#414942" />
    <Block at={[localCenter[0], -.28, localCenter[2]]} size={[size[0], .56, size[1]]} color="#68725b" />
    <Block at={[localCenter[0], -.095, localCenter[2]]} size={[size[0] - .34, .2, size[1] - .34]} color="#72775c" />
    {props.map(({ at, height, index }) => <group key={index} position={at}>
      {index % 3 === 0 ? <Cylinder at={[0, .12, 0]} top={.12} bottom={.36} height={.24} color="#8c8772" sides={5} /> :
        <><Cylinder at={[0, .14, 0]} top={.064} height={.27} color="#806e50" sides={5} />
          <Cylinder at={[0, height / 2 + .16, 0]} top={.02} bottom={height * .47} height={height} color={index % 2 ? '#526d53' : '#8b9661'} sides={5} /></>}
    </group>)}
  </group>
}

function FacilityPad({ layout, data, at, alertColor, selected, detailed, reduced, onSelect }: {
  layout: FacilityLayout; data: Dataset; at: number; alertColor: string | undefined; selected: string | null
  detailed: boolean; reduced: boolean; onSelect: (id: string) => void
}) {
  const { facility, pad } = layout
  const fill = read(data, facility.tank.id, 'level_pct', at)
  const state = read(data, facility.pump.id, 'status', at)
  const flowing = state === 1 && (read(data, facility.pump.id, 'flow_bpd', at) ?? 0) > 0
  const scale = Math.min(1, 3.2 / Math.max(3.2, Math.ceil(facility.wells.length / 4) * 1.17))
  const wellPipes = useMemo(() => facility.wells.map((well, index) => {
    const position = wellPosition(index, facility.wells.length)
    return {
      well, position,
      points: [add(position, [-.41, .16, -.14]), [position[0] - .41, .27, .92], [-.8 / scale, .27, .74], [-.8 / scale, .28, .27]] as Position[],
    }
  }), [facility, scale])
  return <group position={pad}>
    <group onClick={clickable(facility.id, onSelect)}>
      <Block at={[0, .045, .4]} size={[5.85, .1, 5.17]} color="#887c62" />
      <Block at={[0, .1, .4]} size={[5.65, .09, 4.97]} color="#b2a281" />
      <Block at={[1.93, .53, -1.47]} size={[1.27, .76, .76]} color="#a89371" cast />
      <Block at={[1.93, .94, -1.47]} size={[1.41, .13, .87]} color="#647c70" cast />
      <Block at={[1.96, .57, -1.06]} size={[.53, .23, .025]} color="#829c88" />
      <Block at={[-2.46, .19, -.53]} size={[.13, .16, 2.66]} color="#d2bb90" />
      <Block at={[2.59, .19, 1.19]} size={[.13, .16, 2.2]} color="#d2bb90" />
    </group>
    {selected === facility.id && <Marker radius={3.52} at={[0, .17, .35]} color={palette.light} />}
    <Tank at={tankPosition} fill={fill} limit={data.warningPct} selected={selected === facility.tank.id} onClick={clickable(facility.tank.id, onSelect)} />
    <Pump at={pumpPosition} status={state} warning={alertColor === palette.caution} selected={selected === facility.pump.id} onClick={clickable(facility.pump.id, onSelect)} />
    <Pipe points={internalTransfer} color={flowing ? palette.water : palette.dryPipe} active={flowing} reduced={reduced || !detailed} small />
    <group scale={scale}>
      {wellPipes.map(({ well, position, points }) => {
        const status = read(data, well.id, 'status', at)
        return <group key={well.id}>
          <WellHead at={position} status={status} selected={selected === well.id} onClick={clickable(well.id, onSelect)} reduced={reduced || !detailed} />
          <Pipe points={points} color={status === 1 ? '#73968a' : '#7d8274'} active={status === 1} reduced={reduced || !detailed} small />
        </group>
      })}
    </group>
  </group>
}
const internalTransfer: Position[] = [[-.05, .5, -.4], [.48, .5, -.4], [.94, .5, -.5], [1.38, .5, -.5]]

function Region({ region, data, at, scope, selected, alerts, onSelect, reduced }: SceneProps & { region: RegionLayout; reduced: boolean }) {
  const { system, center, disposal, yard, facilities } = region
  const inSystem = scope.systemId === system.id
  const yardAsset = yardId(system.id)
  const regionAlerts = alerts.filter((alert) => alert.systemId === system.id && alert.verified)
  const routes = useMemo(() => facilities.map(({ facility, pad }, i) => {
    const start = add(pad, pipeStart)
    const end = add(disposal, [1.12, .31, .71 + (i - (facilities.length - 1) / 2) * .21])
    const offset = (i - (facilities.length - 1) / 2) * .29
    const midway = (start[0] + end[0]) * .5 + offset
    return {
      facility, pad, points: [start, [start[0] + .64, .32, start[2]], [midway, .29, start[2] + offset], [midway, .29, end[2]], end] as Position[],
    }
  }), [facilities, disposal])
  return <group position={center}>
    <Terrain region={region} />
    {routes.map(({ facility, pad, points }) => {
      const hasLeak = regionAlerts.some((alert) => alert.assetId === facility.pipeline.id)
      const flow = read(data, facility.pipeline.id, 'receive_flow_bpd', at) ?? 0
      const isSelected = selected === facility.pipeline.id
      return <group key={facility.id}>
        <Road a={yard} b={pad} />
        <Pipe points={points} color={hasLeak ? palette.caution : isSelected ? palette.light : flow > 0 ? palette.water : palette.dryPipe} active={flow > 0} reduced={reduced} onClick={clickable(facility.pipeline.id, onSelect)} />
      </group>
    })}
    {facilities.map((layout) => {
      const warnings = regionAlerts.filter((alert) => alert.facilityId === layout.facility.id)
      const alertColor = warnings.some((alert) => alert.category === 'pump_failure') ? palette.fault :
        warnings.some((alert) => alert.category === 'pump_degradation') ? palette.caution : undefined
      return <FacilityPad key={layout.facility.id} layout={layout} data={data} at={at} alertColor={alertColor} selected={selected}
        detailed={inSystem} reduced={reduced} onSelect={onSelect} />
    })}
    <Disposal at={disposal} selected={selected === system.disposal.id} onClick={clickable(system.disposal.id, onSelect)} />
    <Yard at={yard} slots={system.fleetSize} selected={selected === yardAsset} onClick={clickable(yardAsset, onSelect)} />
  </group>
}

function corners(region: RegionLayout): Position[] {
  const center = add(region.center, region.localCenter)
  return [-1, 1].flatMap((x) => [-1, 1].flatMap((z) => [-1, 2.4].map((y) =>
    add(center, [x * region.size[0] / 2, y, z * region.size[1] / 2]))))
}

function framing(world: WorldLayout, { scope, selected, data }: SceneProps): { target: Position; span: number; bounds?: Position[] } {
  const region = world.regions.find(({ system }) => system.id === scope.systemId)
  const site = region?.facilities.find(({ facility }) => facility.id === scope.facilityId)
  if (region && site) {
    let offset: Position = [0, .52, .42]
    const kind = selected ? data.assets.get(selected)?.kind : null
    if (kind === 'pump') offset = add(pumpPosition, [0, .4, .37])
    if (kind === 'pipeline') offset = add(pipeStart, [0, .2, .5])
    if (kind === 'tank') offset = add(tankPosition, [0, .64, .56])
    if (kind === 'well') offset = add(wellPosition(site.facility.wells.findIndex((well) => well.id === selected), site.facility.wells.length), [0, .37, 0])
    return { target: add(add(region.center, site.pad), offset), span: 14 }
  }
  if (region) return { target: add(region.center, region.localCenter), span: Math.hypot(...region.size), bounds: corners(region) }
  return { target: world.center, span: Math.hypot(...world.size), bounds: world.regions.flatMap(corners) }
}

interface SceneLabel {
  id: string
  title: string
  detail?: string
  kind: 'region' | 'facility' | 'minor'
  state?: 'flagged' | 'failed'
  position: Position
  onClick: () => void
}

function mapLabels(world: WorldLayout, props: SceneProps): SceneLabel[] {
  const { data, at, scope, alerts, onSelect, onFocus } = props
  return world.regions.flatMap((region): SceneLabel[] => {
    const { system, center, size, localCenter } = region
    const incidents = alerts.filter((alert) => alert.verified && alert.systemId === system.id)
    if (!scope.systemId) {
      return [{
        id: system.id, title: system.id, kind: 'region',
        detail: incidents.length ? incidents.length + ' alerts' : system.facilities.length + ' sites',
        state: incidents.length ? 'flagged' : undefined,
        position: add(center, [localCenter[0] - size[0] * .24, 2.3, localCenter[2] + size[1] * .26]),
        onClick: () => onFocus(system.id),
      }]
    }
    if (scope.systemId !== system.id) return []
    const labels: SceneLabel[] = region.facilities
      .filter(({ facility }) => !scope.facilityId || scope.facilityId === facility.id)
      .map(({ facility, pad }) => {
        const fill = read(data, facility.tank.id, 'level_pct', at)
        const failed = read(data, facility.pump.id, 'status', at) === 2
        const flagged = incidents.some((alert) => alert.facilityId === facility.id)
        return {
          id: facility.id, title: siteName(facility.id, system.id), detail: fill === undefined ? '—' : Math.round(fill) + '%', kind: 'facility',
          state: failed ? 'failed' : flagged ? 'flagged' : undefined, position: add(add(center, pad), [0, 2.53, .15]),
          onClick: () => onFocus(facility.id),
        }
      })
    if (!scope.facilityId) {
      labels.push({
        id: system.disposal.id, title: 'Disposal', kind: 'minor', position: add(add(center, region.disposal), [0, 2, 0]),
        onClick: () => onSelect(system.disposal.id),
      }, {
        id: yardId(system.id), title: 'Yard · ' + system.fleetSize, kind: 'minor', position: add(add(center, region.yard), [0, 1.8, 0]),
        onClick: () => onSelect(yardId(system.id)),
      })
    }
    return labels
  })
}

function ProjectLabels({ labels, nodes }: { labels: SceneLabel[]; nodes: Map<string, HTMLButtonElement> }) {
  const position = useMemo(() => new Vector3(), [])
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld()
    for (const label of labels) {
      const node = nodes.get(label.id)
      if (!node) continue
      position.set(...label.position).project(camera)
      const visible = position.z > -1 && position.z < 1 && Math.abs(position.x) < .99 && Math.abs(position.y) < .97
      node.style.visibility = visible ? 'visible' : 'hidden'
      if (visible) node.style.transform = 'translate(' + ((position.x + 1) / 2 * size.width) + 'px,' + ((1 - position.y) / 2 * size.height) + 'px) translate(-50%, -50%)'
    }
  })
  return null
}

function World({ world, labels, nodes, ...props }: SceneProps & { world: WorldLayout; labels: SceneLabel[]; nodes: Map<string, HTMLButtonElement> }) {
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const { target, span, bounds } = useMemo(() => framing(world, props), [world, props.scope, props.selected, props.data])
  const lightTarget = useMemo(() => new Object3D(), [])
  const shadowWidth = Math.min(65, Math.max(12, span * .6))
  return <>
    <ContextWatcher onLost={props.onContextLost} />
    <color attach="background" args={['#213b42']} />
    <hemisphereLight args={['#dfebdf', '#778273', 2.15]} />
    <primitive object={lightTarget} position={target} />
    <directionalLight position={add(target, [-40, 60, 25])} target={lightTarget} intensity={2.4} color="#ffe5b9"
      castShadow={Boolean(props.scope.systemId)} shadow-mapSize={[1024, 1024]} shadow-normalBias={.055}
      shadow-camera-left={-shadowWidth} shadow-camera-right={shadowWidth} shadow-camera-top={shadowWidth} shadow-camera-bottom={-shadowWidth} />
    <directionalLight position={[35, 12, -30]} intensity={.62} color="#a1cecf" />
    <gridHelper args={[1200, 240, '#355054', '#2a4549']} position={[0, -1.08, 0]} />
    {world.regions.map((region) => <Region key={region.system.id} {...props} region={region} reduced={reduced} />)}
    <CameraRig target={target} span={span} bounds={bounds} focusRequest={props.focusRequest} reduced={reduced} />
    <ProjectLabels labels={labels} nodes={nodes} />
  </>
}

export default function NetworkScene(props: SceneProps) {
  const world = useMemo(() => layoutWorld(props.data), [props.data])
  const labels = mapLabels(world, props)
  const nodes = useRef(new Map<string, HTMLButtonElement>())
  return <>
    <Canvas shadows="percentage" dpr={[1, 1.5]} camera={{ position: [100, 95, 130], fov: 39, near: .2, far: 2000 }} gl={{ antialias: true }}
      fallback={<span className="scene-unavailable">WebGL is unavailable. Choose List to browse equipment.</span>}>
      <World {...props} world={world} labels={labels} nodes={nodes.current} />
    </Canvas>
    <div className="scene-label-overlay" aria-label="Spatial asset labels">
      {labels.map((label) => <button key={label.id}
        className={'scene-label ' + label.kind + '-label' + (label.state ? ' ' + label.state : '')}
        ref={(element) => { if (element) nodes.current.set(label.id, element); else nodes.current.delete(label.id) }}
        onClick={label.onClick}>
        {label.kind !== 'minor' && <i />}<strong>{label.title}</strong>{label.detail && <span>{label.detail}</span>}
      </button>)}
    </div>
  </>
}
