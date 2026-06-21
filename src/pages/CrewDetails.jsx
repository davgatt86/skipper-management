import { useState } from 'react'
import { supabase } from '../supabaseClient'

// Identity details used on the vessel crew list. passport_number and
// emergency_contact already existed on crew; nationality / passport_country /
// passport_expiry are added by crew_lists_and_vessel.sql.
const FIELDS = [
  { key: 'nationality', label: 'Nationality', ph: 'Filipino' },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'passport_number', label: 'Passport number', ph: '' },
  { key: 'passport_country', label: 'Passport issuing country', ph: 'Philippines' },
  { key: 'passport_expiry', label: 'Passport expiry', type: 'date' },
  { key: 'emergency_contact', label: 'Next of kin (name & phone)', ph: 'e.g. Maria Rusiana — +63 …', wide: true },
]

export function CrewDetails({ crew, canEdit, onSaved }) {
  const start = () => FIELDS.reduce((o, f) => ((o[f.key] = crew[f.key] ?? ''), o), {})
  const [form, setForm] = useState(start)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  async function save() {
    if (!canEdit) return
    setSaving(true); setMsg('')
    const payload = {}
    for (const f of FIELDS) payload[f.key] = form[f.key] === '' ? null : form[f.key]
    const { error } = await supabase.from('crew').update(payload).eq('id', crew.id)
    setSaving(false)
    setMsg(error ? `Couldn’t save: ${error.message}` : 'Saved ✓')
    if (!error) { onSaved && onSaved(); setTimeout(() => setMsg(''), 2000) }
  }

  return (
    <div style={{ padding: '0.6rem 0.2rem' }}>
      <div style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {FIELDS.map((f) => (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600, gridColumn: f.wide ? '1 / -1' : undefined }}>
            {f.label}
            <input
              type={f.type || 'text'}
              value={form[f.key]}
              placeholder={f.ph}
              disabled={!canEdit}
              onChange={(e) => set(f.key, e.target.value)}
              style={{ padding: '0.5rem 0.55rem', borderRadius: 7, border: '1px solid var(--border, #ccc)', fontSize: '0.95rem', fontWeight: 400 }}
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
