import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, loadThemePreference, resolveTheme } from './theme/themes'

// before the first render, so the window never flashes the wrong theme
applyTheme(resolveTheme(loadThemePreference()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
