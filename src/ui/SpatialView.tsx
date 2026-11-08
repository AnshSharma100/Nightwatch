import { Component, lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Compass, List, Mouse } from 'lucide-react'
import { NetworkMap } from './NetworkMap.tsx'
import type { MapProps } from './NetworkMap.tsx'

const Scene = lazy(() => import('../scene/NetworkScene.tsx'))

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export function SpatialView({ focusRequest, ...props }: MapProps & { focusRequest: number }) {
  const [mode, setMode] = useState<'3d' | 'list'>('3d')
  const [lost, setLost] = useState(() => {
    try { return !document.createElement('canvas').getContext('webgl2') }
    catch { return true }
  })
  const in3d = mode === '3d' && !lost
  const list = <NetworkMap {...props} />
  return <>
    {in3d ? <SceneBoundary fallback={list} onFailure={() => setLost(true)}>
      <Suspense fallback={<span className="scene-unavailable">Building network geometry…</span>}>
        <Scene {...props} focusRequest={focusRequest} onContextLost={() => setLost(true)} />
      </Suspense>
    </SceneBoundary> : list}
    <div className={'scene-toolbar' + (!in3d ? ' toolbar-list' : '')}>
      {lost ? <span className="list-fallback-label"><List size={13} /> List view · WebGL unavailable</span> :
        <button className="small-btn" onClick={() => setMode(in3d ? 'list' : '3d')}>{in3d ? <List size={13} /> : <Box size={13} />} {in3d ? 'List view' : '3D view'}</button>}
    </div>
    {in3d && <div className="scene-overlay">
      <span className="scene-schematic"><Compass size={14} /> Schematic network</span>
      <span className="scene-gestures"><Mouse size={14} /> Drag to orbit · Scroll to zoom</span>
    </div>}
  </>
}
