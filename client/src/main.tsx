import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './components/ThemeProvider'
import { HotUpdateProvider } from './components/HotUpdateBanner'
import './index.css'
import './world.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <HotUpdateProvider>
        <App />
      </HotUpdateProvider>
    </ThemeProvider>
  </StrictMode>,
)
