import { createRoot } from 'react-dom/client'
import { App } from './ui/App.tsx'
import { FieldDesk } from './ui/FieldDesk.tsx'
import './ui/styles.css'

const fieldView = new URLSearchParams(location.search).get('view') === 'field'
createRoot(document.getElementById('root')!).render(fieldView ? <FieldDesk /> : <App />)
