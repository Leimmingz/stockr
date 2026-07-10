import { useState, useEffect } from 'react'

const THEMES = ['system', 'light', 'dark']
const ICONS  = { system: '💻', light: '☀️', dark: '🌙' }
const NEXT   = { system: 'light', light: 'dark', dark: 'system' }

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem('theme') || 'system' } catch { return 'system' }
  })

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    // En mode système, re-appliquer si l'OS change de thème
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  function setTheme(t) {
    setThemeState(t)
    applyTheme(t)
    try { localStorage.setItem('theme', t) } catch {}
  }

  function cycleTheme() { setTheme(NEXT[theme]) }

  return { theme, setTheme, cycleTheme, themeIcon: ICONS[theme] }
}
