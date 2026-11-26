import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type AppTheme = 'light' | 'dark'

interface ThemeContextValue {
  theme: AppTheme
  toggleTheme: () => void
  setTheme: (next: AppTheme) => void
}

const STORAGE_KEY = 'vanilla-srs-theme'
const ThemeContext = createContext<ThemeContextValue | null>(null)

function readInitialTheme(): AppTheme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark' || attr === 'light') return attr
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* ignore */ }
  return 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    const meta = document.getElementById('meta-theme-color')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#141117' : '#FFF0EC')
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch { /* ignore */ }
  }, [theme])

  const setTheme = (next: AppTheme) => setThemeState(next)
  const toggleTheme = () => setThemeState((t) => (t === 'light' ? 'dark' : 'light'))

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
