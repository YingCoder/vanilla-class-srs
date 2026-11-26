import { useTheme } from './ThemeProvider'

interface ThemeToggleButtonProps {
  compact?: boolean
  className?: string
}

export default function ThemeToggleButton({ compact = false, className = '' }: ThemeToggleButtonProps) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      className={`candy-pill theme-toggle-btn ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={isDark ? '切换为浅色主题' : '切换为深色护眼主题'}
      title={isDark ? '点击切换草莓日间模式' : '点击切换深夜可可护眼模式'}
    >
      <span aria-hidden="true">{isDark ? '☀' : '☾'}</span>
      <span>{compact ? (isDark ? '日间' : '夜间') : (isDark ? '草莓日间' : '夜间护眼')}</span>
    </button>
  )
}
