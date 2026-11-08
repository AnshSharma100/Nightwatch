import { Component, lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Compass, List, Mouse } from 'lucide-react'
import { NetworkMap } from './NetworkMap.tsx'
import type { MapProps } from './NetworkMap.tsx'

const Scene = lazy(() => import('../scene/NetworkScene.tsx'))

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export function SpatialView({ focusRequest, ...props }: MapProps & { focusRequest: number }) {
  const [mode, setMode] = useState<'3d' | 'list'>('3d')
  const [lost, setLost] = useState(() => {
    try { return !document.createElement('canvas').getContext('webgl2') }
    catch { return true }
  })
  const list = <NetworkMap {...props} />
  return <>
    {mode === 'list' || lost ? list : <SceneBoundary fallback={list}>
      <Suspense fallback={<span className="scene-unavailable">Building network geometry…</span>}>
        <Scene {...props} focusRequest={focusRequest} onContextLost={() => setLost(true)} />
      </Suspense>
    </SceneBoundary>}
    <div className={'scene-toolbar' + (mode === 'list' || lost ? ' toolbar-list' : '')} aria-label="Map mode">
      <button className="small-btn" aria-pressed={mode === '3d' && !lost} disabled={lost} onClick={() => setMode('3d')}><Box size={13} /> 3D</button>
      <button className="small-btn" aria-pressed={mode === 'list' || lost} onClick={() => setMode('list')}><List size={13} /> List</button>
    </div>
    {mode === '3d' && !lost && <div className="scene-overlay">
      <span className="scene-schematic"><Compass size={14} /> Schematic layout</span>
      <span className="scene-gestures"><Mouse size={14} /> Drag to orbit · Scroll to zoom</span>
    </div>}
  </>
}
