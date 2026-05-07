import { useEffect, useState } from 'react'

type ThemeMode = 'light' | 'dark' | 'auto'

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'auto'
  }

  const stored = window.localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored
  }

  return 'auto'
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode

  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(resolved)

  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }

  document.documentElement.style.colorScheme = resolved
}

function AutoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="w-4 h-4" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" />
      <path d="M8 2.5A5.5 5.5 0 0 1 8 13.5V2.5Z" fill="currentColor" />
    </svg>
  )
}

function LightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="w-4 h-4" strokeWidth="1.5">
      <circle cx="8" cy="8" r="3" stroke="currentColor" />
      <path d="M8 1v1.5M8 13.5V15M2.5 8H1M15 8h-1.5M4.11 4.11l-1.06-1.06M12.95 12.95l-1.06-1.06M4.11 11.89l-1.06 1.06M12.95 3.05l-1.06 1.06" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

function DarkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" className="w-4 h-4" strokeWidth="1.5">
      <path d="M13.5 10.5A6.5 6.5 0 1 1 5.5 2.5a5.5 5.5 0 0 0 8 8Z" stroke="currentColor" />
    </svg>
  )
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('auto')

  useEffect(() => {
    const initialMode = getInitialMode()
    setMode(initialMode)
    applyThemeMode(initialMode)
  }, [])

  useEffect(() => {
    if (mode !== 'auto') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyThemeMode('auto')

    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [mode])

  function toggleMode() {
    const nextMode: ThemeMode =
      mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light'
    setMode(nextMode)
    applyThemeMode(nextMode)
    window.localStorage.setItem('theme', nextMode)
  }

  const label =
    mode === 'auto'
      ? 'Theme: auto'
      : mode === 'dark'
        ? 'Theme: dark'
        : 'Theme: light'

  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)] transition-colors"
    >
      {mode === 'auto' ? <AutoIcon /> : mode === 'dark' ? <DarkIcon /> : <LightIcon />}
    </button>
  )
}
