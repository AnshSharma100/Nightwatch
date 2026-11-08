import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/styles.css'

const App = lazy(() => import('./ui/App.tsx').then(({ App }) => ({ default: App })))
const FieldDesk = lazy(() => import('./ui/FieldDesk.tsx').then(({ FieldDesk }) => ({ default: FieldDesk })))
const assignment = /^\/field\/assignments\/([0-9a-f-]{36})$/i.exec(location.pathname)
const fieldView = location.pathname === '/field' || location.pathname.startsWith('/field/') ||
  new URLSearchParams(location.search).get('view') === 'field'
createRoot(document.getElementById('root')!).render(<Suspense fallback={<p role="status" className="notice">Loading NIGHTWATCH…</p>}>
  {fieldView ? <FieldDesk assignmentId={assignment?.[1]} /> : <App />}
</Suspense>)
