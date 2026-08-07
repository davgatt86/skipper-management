import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

// Identity details used on the vessel crew list (IMO FAL 5).
//
// rank_code, place_of_birth, embarked_date and passport_issued_at come from
// crew_voyage_fields.sql / crew_aegir_migration.sql. Before those, the crew
// list had to ask for a rank on every voyage and defaulted everyone to
// Deckhand; rank now belongs to the crewman.
const FIELDS = [
  { key: 'nationality', label: 'Nationality', ph: 'Filipino' },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'place_of_birth', label: 'Place of birth', ph: 'Oslob, Cebu' },
  { key: 'passport_number', label: 'Passport number', ph: '' },
  { key: 'passport_country', label: 'Passport issuing country', ph: 'Philippines' },
  { key: 'passport_expiry', label: 'Passport expiry', type: 'date' },
  { key: 'passport_issued_at', label: 'Passport issued at', ph: 'Manila' },
  { key: 'embarked_date', label: 'Embarked', type: 'date' },
  { key: 'emergency_contact', label: 'Next of kin (name & phone)', ph: 'e.g. Maria Rusiana — +63 …', wide: true },
]

// The rank lookup is shared and identical for every fleet, so it is fetched
// once per mounted panel rather than threaded through props.
export function CrewDetails({ crew, canEdit, onSaved }) {
  const start = () => {
    const o = FIELDS.reduce((acc, f) => ((acc[f.key] = crew[f.key] ?? ''), acc), {})
    o.rank_code = crew.rank_code ?? ''
    return o
  }
  const [form, setForm] = useState(start)
  const [ranks, setRanks] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('crew_ranks').select('code, label').order('sort')
      .then(({ data }) => setRanks(data || []))
  }, [])

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  async function save() {
    if (!canEdit) return
    setSaving(true); setMsg('')
    const payload = {}
    for (const f of FIELDS) payload[f.key] = form[f.key] === '' ? null : form[f.key]
    payload.rank_code = form.rank_code === '' ? null : form.rank_code
    const { error } = await supabase.from('crew').update(payload).eq('id', crew.id)
    setSaving(false)
    setMsg(error ? `Couldn’t save: ${error.message}` : 'Saved ✓')
    if (!error) { onSaved && onSaved(); setTimeout(() => setMsg(''), 2000) }
  }

  const labelStyle = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600 }
  const inputStyle = { padding: '0.5rem 0.55rem', borderRadius: 7, border: '1px solid var(--border, #ccc)', fontSize: '0.95rem', fontWeight: 400 }

  return (
    <div style={{ padding: '0.6rem 0.2rem' }}>
      <div style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        <label style={labelStyle}>
          Rank
          <select
            value={form.rank_code}
            disabled={!canEdit}
            onChange={(e) => set('rank_code', e.target.value)}
            style={inputStyle}
          >
            <option value="">— not set —</option>
            {ranks.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} style={{ ...labelStyle, gridColumn: f.wide ? '1 / -1' : undefined }}>
            {f.label}
            <input
              type={f.type || 'text'}
              value={form[f.key]}
              placeholder={f.ph}
              disabled={!canEdit}
              onChange={(e) => set(f.key, e.target.value)}
              style={inputStyle}
            />
          </label>
        ))}
      </div>
      {canEdit && (
        <div style={{ marginTop: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <button onClick={save} disabled={saving} style={{ padding: '0.45rem 1rem' }}>
            {saving ? 'Saving…' : 'Save details'}
          </button>
          {msg && <span style={{ color: msg.startsWith('Saved') ? 'var(--green)' : 'var(--red)', fontWeight: 600, fontSize: '0.85rem' }}>{msg}</span>}
        </div>
      )}
    </div>
  )
}
