import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export function useTheme() {
  const [night, setNight] = useState(() => {
    try { return localStorage.getItem('nightwatch-theme') === 'night' }
    catch { return false }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = night ? 'night' : 'atlas'
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', night ? '#101f27' : '#f3f1ea')
    try { localStorage.setItem('nightwatch-theme', night ? 'night' : 'atlas') } catch { /* Theme works for this visit. */ }
  }, [night])
  return { night, toggle: () => setNight((value) => !value) }
}

export function ThemeToggle({ night, toggle }: ReturnType<typeof useTheme>) {
  return <button type="button" className="soft-btn theme-toggle" aria-label="Night Shift" aria-pressed={night} title="Night Shift" onClick={toggle}>
    {night ? <Sun size={16} /> : <Moon size={16} />}<span>Night Shift</span>
  </button>
}

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 9 10-5.5L22 9l-10 5.5L2 9Zm0 4 10 5.5L22 13M5 18l7 3.5 7-3.5" />
      <circle cx="12" cy="9" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  </span>
}
