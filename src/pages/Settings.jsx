import { useEffect, useState } from 'react'
import BackNav from '../BackNav'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

const labelStyle = { display: 'block', marginBottom: '1.1rem' }
const capStyle = { marginBottom: '0.3rem', fontWeight: 600 }
const hintStyle = { fontSize: '0.8rem', color: 'var(--grey-400)', marginTop: '0.25rem' }

export default function Settings() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'

  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  // form fields
  const [flat, setFlat] = useState('')
  const [box, setBox] = useState('')
  const [ghbPct, setGhbPct] = useState('')   // shown as a percentage (50), stored as a fraction (0.5)
  const [currency, setCurrency] = useState('')

  async function load() {
    setLoading(true); setError('')
    const { data, error } = await supabase.from('settings').select('*').maybeSingle()
    if (error) setError(error.message)
    setSettings(data || null)
    setFlat(data?.flat_rate_per_month ?? '')
    setBox(data?.box_rate ?? '')
    setGhbPct(data?.ghb_first_half_pct != null ? round1(Number(data.ghb_first_half_pct) * 100) : '')
    setCurrency(data?.currency ?? '')
    setLoading(false)
  }
  useEffect(() => { if (isSkipper) load() }, [isSkipper])

  if (!isSkipper) {
    return (
      <div className="container">
        <div style={{ marginBottom: '1rem' }}><BackNav /></div>
        <div className="card"><p className="muted">Bonus rates can only be changed by the skipper.</p></div>
      </div>
    )
  }

  async function save(e) {
    e.preventDefault()
    setError(''); setSaved(false)

    const flatN = Number(flat), boxN = Number(box), pctN = Number(ghbPct)
    if (flat === '' || isNaN(flatN) || flatN < 0) return setError('Monthly rate must be a number (0 or more).')
    if (box === '' || isNaN(boxN) || boxN < 0) return setError('Box bonus must be a number (0 or more).')
    if (ghbPct === '' || isNaN(pctN) || pctN < 0 || pctN > 100) return setError('GHB first-half split must be between 0 and 100%.')

    const payload = {
      flat_rate_per_month: round2(flatN),
      box_rate: round4(boxN),
      ghb_first_half_pct: round4(pctN / 100),   // back to a fraction, e.g. 50 -> 0.5
      currency: currency.trim(),
    }

    setBusy(true)
    let err
    if (settings?.id) {
      ({ error: err } = await supabase.from('settings').update(payload).eq('id', settings.id))
    } else {
      // no settings row yet for this fleet — create one
      ({ error: err } = await supabase.from('settings').insert({ fleet_id: appUser.fleet_id, ...payload }))
    }
    setBusy(false)
    if (err) return setError(err.message)
    setSaved(true)
    load()
  }

  const cur = currency || settings?.currency || '£'
  const flatPreview = Number(flat) || 0
  const boxPreview = (Number(box) || 0) * 1000

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}><BackNav /></div>

      <div className="card" style={{ maxWidth: 520 }}>
        <h1 style={{ marginBottom: '0.25rem' }}>Crew Bonus Settings</h1>
        <p className="muted" style={{ marginBottom: '1.25rem' }}>
          Rates for this boat. Changes apply to open and future months only — months you've already
          closed keep the amounts they were settled at, so your history never changes.
        </p>

        {loading ? <p className="muted">Loading…</p> : (
          <form onSubmit={save}>
            <label style={labelStyle}>
              <div style={capStyle}>Monthly flat rate ({cur})</div>
              <input type="number" step="0.01" min="0" value={flat}
                     onChange={e => { setFlat(e.target.value); setSaved(false) }} />
              <div style={hintStyle}>Paid per full calendar month, pro-rated by days a crew member is on contract.</div>
            </label>

            <label style={labelStyle}>
              <div style={capStyle}>Box bonus ({cur} per box)</div>
              <input type="number" step="0.01" min="0" value={box}
                     onChange={e => { setBox(e.target.value); setSaved(false) }} />
              <div style={hintStyle}>Multiplied by boxes landed in the month.</div>
            </label>

            <label style={labelStyle}>
              <div style={capStyle}>GHB first-half split (%)</div>
              <input type="number" step="1" min="0" max="100" value={ghbPct}
                     onChange={e => { setGhbPct(e.target.value); setSaved(false) }} />
              <div style={hintStyle}>Share of the GHB paid in the first half (e.g. 50 = an even 50/50 split).</div>
            </label>

            <label style={labelStyle}>
              <div style={capStyle}>Currency</div>
              <input type="text" value={currency} placeholder="£ or GBP"
                     onChange={e => { setCurrency(e.target.value); setSaved(false) }} />
              <div style={hintStyle}>A symbol (£) or a 3-letter code (GBP) — used for display only.</div>
            </label>

            <div className="muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
              Quick check: a full month = {cur}{flatPreview.toFixed(2)} flat; 1,000 boxes = {cur}{boxPreview.toFixed(2)} box bonus.
            </div>

            {error && <p style={{ color: 'var(--danger, #b00020)', marginBottom: '0.75rem' }}>{error}</p>}
            {saved && <p style={{ color: 'var(--success, #197b30)', marginBottom: '0.75rem' }}>Saved.</p>}

            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save rates'}</button>
          </form>
        )}
      </div>
    </div>
  )
}

function round1(n) { return Math.round(Number(n) * 10) / 10 }
function round2(n) { return Math.round(Number(n) * 100) / 100 }
function round4(n) { return Math.round(Number(n) * 10000) / 10000 }
