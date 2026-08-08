import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'

const FIELDS = [
  { key: 'vessel_name', label: 'Vessel name', ph: 'AUDACIOUS' },
  { key: 'pln', label: 'PLN (port letters & number)', ph: 'BF83' },
  { key: 'call_sign', label: 'Call sign', ph: 'MBJM6' },
  { key: 'mmsi', label: 'MMSI', ph: '232009468' },
  { key: 'home_port', label: 'Home port', ph: 'Peterhead' },
  // FAL 5 field 4. Blank until set — a crew list should not guess the flag it
  // sails under.
  { key: 'flag_state', label: 'Flag State', ph: 'United Kingdom' },
  // Off the Certificate of Registry. Official forms ask for these by name, so
  // they are columns rather than a note.
  { key: 'imo_number', label: 'IMO number', ph: '9785342' },
  { key: 'official_number', label: 'Official number', ph: 'C21004' },
  { key: 'length_registered', label: 'Registered length (m)', ph: '23.96' },
  { key: 'length_overall', label: 'Overall length (m)', ph: '29.80' },
  { key: 'breadth', label: 'Breadth (m)', ph: '10.50' },
  { key: 'depth', label: 'Depth (m)', ph: '7.20' },
  { key: 'gross_tonnage', label: 'Gross tonnage', ph: '498.00' },
  { key: 'net_tonnage', label: 'Net tonnage', ph: '289.00' },
  { key: 'year_built', label: 'Year built', ph: '2017' },
  { key: 'engine_make', label: 'Engine make and model', ph: 'MAK 8M20C' },
  { key: 'engine_kw', label: 'Engine power (kW)', ph: '1060' },
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
  const [heroPath, setHeroPath] = useState(null)
  const [heroBusy, setHeroBusy] = useState(false)

  useEffect(() => {
    if (!appUser?.fleet_id) return
    supabase.from('fleets').select('hero_path').eq('id', appUser.fleet_id).maybeSingle()
      .then(({ data }) => setHeroPath(data?.hero_path || null))
  }, [appUser?.fleet_id])

  // One photo per fleet: the old file is removed rather than left orphaned in
  // the bucket, the way an abandoned certificate upload was.
  async function onHero(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !appUser?.fleet_id) return
    setHeroBusy(true); setMsg('')
    const path = `${appUser.fleet_id}/${Date.now()}-${String(file.name).replace(/[^\w.\-]+/g, '_').slice(-60)}`
    const up = await supabase.storage.from('fleet-photos').upload(path, file, { contentType: file.type || undefined })
    if (up.error) { setMsg('Upload failed: ' + up.error.message); setHeroBusy(false); return }
    const { error } = await supabase.from('fleets').update({ hero_path: path }).eq('id', appUser.fleet_id)
    if (error) { setMsg(error.message); setHeroBusy(false); return }
    if (heroPath) await supabase.storage.from('fleet-photos').remove([heroPath])
    setHeroPath(path); setHeroBusy(false); setMsg('Photo saved ✓')
  }

  async function clearHero() {
    if (!heroPath || !appUser?.fleet_id) return
    setHeroBusy(true)
    await supabase.from('fleets').update({ hero_path: null }).eq('id', appUser.fleet_id)
    await supabase.storage.from('fleet-photos').remove([heroPath])
    setHeroPath(null); setHeroBusy(false); setMsg('Photo removed — the plate is solid cobalt again.')
  }

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
    <AppShell maxWidth={640}>
      <PageHeader title="Vessel Details" />
      <p style={{ color: 'var(--grey-400)', marginTop: '0.4rem' }}>
        Enter your vessel’s constants once — they’ll fill in automatically on every crew list.
      </p>

      {isSkipper && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Vessel photo</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Shown behind the registration plate on the dashboard, under a cobalt veil so the
            lettering stays readable. Leave it empty and the plate is solid cobalt — that is the
            designed look, not a gap.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="secondary" style={{ padding: '0.45rem 0.9rem', borderRadius: 7, cursor: heroBusy ? 'wait' : 'pointer', border: '1px solid var(--border)', display: 'inline-block' }}>
              {heroBusy ? 'Uploading…' : heroPath ? 'Replace photo' : '📷 Choose a photo'}
              <input type="file" accept="image/*" disabled={heroBusy} style={{ display: 'none' }} onChange={onHero} />
            </label>
            {heroPath && (
              <button className="secondary" onClick={clearHero} disabled={heroBusy} style={{ fontSize: '0.85rem' }}>
                Remove
              </button>
            )}
            {heroPath && <span className="muted" style={{ fontSize: '0.8rem' }}>A photo is set.</span>}
          </div>
        </div>
      )}

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
    </AppShell>
  )
}
