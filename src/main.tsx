import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/install' // catch the browser's install prompt from the very start
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// A page opened before a deploy asks for code chunks the new deploy no longer has (the
// table, the admin panel…). Reload once to pick up the new version instead of breaking;
// a second failure within a minute is a real outage, so let it show.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'capicua.staleReload'
  let last = 0
  try { last = Number(sessionStorage.getItem(key) ?? 0) } catch { /* storage unavailable */ }
  if (Date.now() - last < 60_000) return
  try { sessionStorage.setItem(key, String(Date.now())) } catch { /* storage unavailable */ }
  event.preventDefault()
  location.reload()
})

// Makes the game installable (and shows a "no connection" page offline). It never caches the game.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
