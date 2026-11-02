import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

// Identity details used on the vessel crew list (IMO FAL 5).
//
// rank_code, place_of_birth, embarked_date and passport_issued_at come from
// crew_voyage_fields.sql / crew_aegir_migration.sql. Before those, the crew
// list had to ask for a rank on every voyage and defaulted everyone to
// Deckhand; rank now belongs to the crewman.
//
// THE NAME IS EDITABLE HERE, AND IT WAS NOT UNTIL OCT 2026. The add form on
// Crew Status takes a name and tells you to use the one in the passport — and
// nothing in the app could change it afterwards, so a man entered under a
// wrong or shortened name was stuck with it. David: *"i have a crewman with
// the wrong name but can't edit it."* Every other field on his record could be
// corrected and the one that prints on a border document could not.
const FIELDS = [
  /* First, because it is the identity rather than a detail of it — and
     `required`, because `crew.full_name` is NOT NULL and a man with no name
     cannot appear on a crew list at all. */
  { key: 'full_name', label: 'Full name', ph: 'e.g. Lorenzo Rusiana', required: true, wide: true,
    hint: 'Exactly as it appears in the passport — a crew list is a border document.' },
  { key: 'nationality', label: 'Nationality', ph: 'Filipino' },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'place_of_birth', label: 'Place of birth', ph: 'Oslob, Cebu' },
  { key: 'passport_number', label: 'Passport number', ph: '' },
  { key: 'passport_country', label: 'Passport issuing country', ph: 'Philippines' },
  { key: 'passport_expiry', label: 'Passport expiry', type: 'date' },
  { key: 'passport_issued_at', label: 'Passport issued at', ph: 'Manila' },
  { key: 'embarked_date', label: 'Embarked', type: 'date' },
  { key: 'emergency_contact', label: 'Next of kin (name & phone)', ph: 'e.g. Maria Rusiana — +63 …', wide: true },
  /* `notes` has existed on `crew` since the table was built and was rendered
     NOWHERE, so anything written there went where nobody could read it. It is
     the obvious place for a full name given verbally before the passport turns
     up, which is no use at all if the page will not show it back. */
  { key: 'notes', label: 'Notes', rows: 3, wide: true,
    hint: 'Anything worth keeping that has no box of its own — a full name given before the passport arrives, say.' },
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
      .then(({ data, error }) => {
        /* An empty pick-list reads as a man with no rank on record, not as a
         * read that failed — so the message names the CONSEQUENCE rather than
         * the table. There is no built-in list to fall back on here: the
         * options are gone, and so is any rank already held. */
        if (error) setMsg(`The rank pick-list is incomplete — no rank can be chosen, and one already on record won’t show: ${error.message}`)
        setRanks(data || [])
      })
  }, [])

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  async function save() {
    if (!canEdit) return
    /* REFUSED BEFORE IT IS SENT. `full_name` is NOT NULL, so a blank would come
       back from the database as a constraint name — and the answer is the same
       either way, so it is said in words here instead. */
    const missing = FIELDS.filter((f) => f.required && !String(form[f.key] ?? '').trim())
    if (missing.length) {
      setMsg(`${missing[0].label} can’t be left empty — it is what prints on the crew list.`)
      return
    }
    setSaving(true); setMsg('')
    const payload = {}
    for (const f of FIELDS) {
      /* A required field is TRIMMED and never nulled; everything else keeps the
         value as typed, so a date input is not mangled on its way through. */
      if (f.required) payload[f.key] = String(form[f.key]).trim()
      else payload[f.key] = form[f.key] === '' ? null : form[f.key]
    }
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
            {f.rows ? (
              <textarea
                value={form[f.key]}
                rows={f.rows}
                placeholder={f.ph}
                disabled={!canEdit}
                onChange={(e) => set(f.key, e.target.value)}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            ) : (
              <input
                type={f.type || 'text'}
                value={form[f.key]}
                placeholder={f.ph}
                disabled={!canEdit}
                onChange={(e) => set(f.key, e.target.value)}
                style={inputStyle}
              />
            )}
            {/* The hint sits UNDER the box it belongs to. The add form carries
                the same sentence about the passport, and a man is far more
                likely to be renamed here than added twice. */}
            {f.hint && <span className="muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}>{f.hint}</span>}
          </label>
        ))}
      </div>
      {/* A read can fail on a viewer's login too, where there is no Save button
          to hang the message off. */}
      {(canEdit || msg) && (
        <div style={{ marginTop: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          {canEdit && (
            <button onClick={save} disabled={saving} style={{ padding: '0.45rem 1rem' }}>
              {saving ? 'Saving…' : 'Save details'}
            </button>
          )}
          {msg && <span style={{ color: msg.startsWith('Saved') ? 'var(--green)' : 'var(--red)', fontWeight: 600, fontSize: '0.85rem' }}>{msg}</span>}
        </div>
      )}
    </div>
  )
}
