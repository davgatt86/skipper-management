import { useEffect, useState } from 'react'

// Day / Dark / Auto. 'auto' follows the device (and live-updates if the phone
// flips to dark at sunset). Choice is remembered on this device.
const KEY = 'sm-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function applyTheme(mode){
  const dark = mode === 'dark' || (mode === 'auto' && media().matches)
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
}
export function initTheme(){
  const mode = localStorage.getItem(KEY) || 'auto'
  applyTheme(mode)
  // keep 'auto' in step with the device
  const m = media()
  const onChange = () => { if ((localStorage.getItem(KEY) || 'auto') === 'auto') applyTheme('auto') }
  m.addEventListener ? m.addEventListener('change', onChange) : m.addListener(onChange)
  return mode
}

const OPTS = [['day','Day'], ['dark','Dark'], ['auto','Auto']]

export default function ThemeToggle(){
  const [mode, setMode] = useState(() => localStorage.getItem(KEY) || 'auto')
  useEffect(() => { applyTheme(mode === 'day' ? 'light' : mode) }, [mode])
  function pick(m){
    setMode(m)
    localStorage.setItem(KEY, m === 'day' ? 'light' : m)
    applyTheme(m === 'day' ? 'light' : m)
  }
  const cur = mode === 'light' ? 'day' : mode
  return (
    <div className="no-print" style={{ display:'inline-flex', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }} title="Screen brightness">
      {OPTS.map(([m,label]) => (
        <button key={m} onClick={()=>pick(m)}
          style={{ padding:'3px 9px', border:'none', cursor:'pointer', fontSize:'0.74rem', fontWeight: cur===m?700:500,
                   background: cur===m ? 'var(--navy)' : 'var(--surface)', color: cur===m ? 'var(--on-navy)' : 'var(--grey-400)' }}>
          {label}
        </button>
      ))}
    </div>
  )
}
