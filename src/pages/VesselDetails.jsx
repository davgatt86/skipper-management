import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

const FIELDS = [
  { key: 'vessel_name', label: 'Vessel name', ph: 'AUDACIOUS' },
  { key: 'pln', label: 'PLN (port letters & number)', ph: 'BF83' },
  { key: 'call_sign', label: 'Call sign', ph: 'MBJM6' },
  { key: 'mmsi', label: 'MMSI', ph: '232009468' },
  { key: 'home_port', label: 'Home port', ph: 'Peterhead' },
  { key: 'owner', label: 'Owner', ph: '' },
  { key: 'skipper_name', label: 'Skipper', ph: '' },
  { key: 'length_m', label: 'Registered length (m)', ph: '29.80', type: 'number' },
  { key: 'gross_tonnage', label: 'Gross tonnage (GT)', ph: '498', type: 'number' },
]

const blank = () => FIELDS.reduce((o, f) => ((o[f.key] = ''), o), {})

export default function VesselDetails() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const [form, setForm] = useState(blank())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await supabase.from('vessel_details').select('*').maybeSingle()
      if (!live) return
      if (!error && data) {
        const next = blank()
        for (const f of FIELDS) next[f.key] = data[f.key] ?? ''
        setForm(next)
      }
      setLoading(false)
    })()
    return () => { live = false }
  }, [])

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  async function save() {
    if (!isSkipper) return
    setSaving(true); setMsg('')
    const payload = { fleet_id: appUser.fleet_id, updated_at: new Date().toISOString() }
    for (const f of FIELDS) {
      const v = form[f.key]
      payload[f.key] = v === '' ? null : (f.type === 'number' ? Number(v) : v)
    }
    const { error } = await supabase.from('vessel_details').upsert(payload, { onConflict: 'fleet_id' })
    setSaving(false)
    setMsg(error ? `Couldn’t save: ${error.message}` : 'Saved ✓')
    if (!error) setTimeout(() => setMsg(''), 2500)
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
        <h1 style={{ marginBottom: 0 }}>Vessel Details</h1>
        <Link to="/">← Dashboard</Link>
      </div>
      <p style={{ color: 'var(--grey-400)', marginTop: '0.4rem' }}>
        Enter your vessel’s constants once — they’ll fill in automatically on every crew list.
      </p>

      <div className="card" style={{ marginTop: '1rem' }}>
        {loading ? (
          <div style={{ color: 'var(--grey-400)' }}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gap: '0.85rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {FIELDS.map((f) => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 600 }}>
                {f.label}
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  step={f.type === 'number' ? 'any' : undefined}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  value={form[f.key]}
                  placeholder={f.ph}
                  disabled={!isSkipper}
                  onChange={(e) => set(f.key, e.target.value)}
                  style={{ padding: '0.55rem 0.6rem', borderRadius: 8, border: '1px solid var(--grey-300, #ccc)', fontSize: '1rem', fontWeight: 400 }}
                />
              </label>
            ))}
          </div>
        )}

        {isSkipper ? (
          <div style={{ marginTop: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
            <button onClick={save} disabled={saving || loading}
              style={{ padding: '0.6rem 1.2rem', borderRadius: 8, border: 'none', background: 'var(--accent, #0b6)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save vessel details'}
            </button>
            {msg && <span style={{ color: msg.startsWith('Saved') ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{msg}</span>}
          </div>
        ) : (
          <p style={{ marginTop: '1rem', color: 'var(--grey-400)' }}>Only the skipper can edit vessel details.</p>
        )}
      </div>
    </div>
  )
}
