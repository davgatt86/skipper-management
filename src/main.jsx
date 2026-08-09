import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'

// Fonts are bundled, not fetched. A boat on patchy signal still gets the
// right typeface — and there is no third-party request on sign-in.
// No .css extension — @fontsource v5 maps the subpath "./*" to "./*.css",
// so "/700.css" would resolve to "700.css.css" and fail the build.
import '@fontsource/big-shoulders-display/700'
import '@fontsource/big-shoulders-display/800'
import '@fontsource/ibm-plex-sans/400'
import '@fontsource/ibm-plex-sans/500'
import '@fontsource/ibm-plex-sans/600'
import '@fontsource/ibm-plex-mono/400'
import '@fontsource/ibm-plex-mono/500'
import '@fontsource/ibm-plex-mono/600'

import './index.css'
import { initTheme } from './ThemeToggle'

initTheme()   // set Day/Dark/Auto before first paint (no white flash at night)

// Cache the shell so the app OPENS with no signal. Offline capture is no use if
// the page will not load in the first place — see public/sw.js. Registered
// after load so it never competes with the first paint, and failure is silent:
// a browser without service workers still gets a working online app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
