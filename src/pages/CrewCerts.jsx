import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { certStatus, certUrgency, CERT_LEAD_DAYS } from '../lib/certs/certStatus'
import { parseCertFile } from '../lib/certs/parseCert'
import { downscaleImage } from '../lib/downscale'

const BUCKET = 'crew-certs'
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—'
const safeName = n => String(n || 'cert').replace(/[^\w.\-]+/g, '_').slice(-80)

// The buckets the fleet-wide matrix groups by. Tick one per certificate so the
// many cert-name variants collapse to a clean set of columns.
//
// Radio was added Aug 2026: GMDSS and the Long Range Radiotelephone ticket had
// no bucket at all, so four certificates sat uncategorised with nowhere sensible
// to go.
// 'Other' is a real, pickable category — not just the bucket the matrix used
// to sweep unfiled certificates into. Without it a ticket that genuinely fits
// none of the above could never be filed, so it stayed "uncategorised" and the
// register nagged about it forever.
export const CERT_CATEGORIES = ['Medical', 'Fire Fighting', 'Sea Survival', 'First Aid', 'Safety Awareness', 'Radio', 'Deck Officer', 'Engineer Officer', 'Other']

// Suggestions for the categoriser on the register page. First match wins, so
// the order matters — "GMDSS General Certificate of Competence" must be caught
// as Radio before "Competence" pulls it toward an officer ticket.
//
// These are only suggestions. Nothing is filed without the skipper confirming
// it, because he knows his own tickets better than a regex does.
export const CATEGORY_HINTS = [
  [/gmdss|radiotele|radio|\bvhf\b|src\b/i, 'Radio'],
  [/medical|eng\s?1/i, 'Medical'],
  [/fire/i, 'Fire Fighting'],
  [/survival|life\s?raft|liferaft/i, 'Sea Survival'],
  [/first aid|elementary first/i, 'First Aid'],
  [/man overboard|social responsibilit|security awareness|safety awareness|safety cert|personal safety/i, 'Safety Awareness'],
  [/engineer|engine/i, 'Engineer Officer'],
  [/stability|bridge watch|navigation|deck|skipper|mate|fishing vessel/i, 'Deck Officer'],
]

export function suggestCategory(certType) {
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(certType || '')) return cat
  return ''
}

function CertBadge({ expiry }) {
  const s = certStatus(expiry)
  return (
    <span style={{
      display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.78rem',
      fontWeight: 700, color: '#fff', background: s.color, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

const blankDraft = () => ({ id: null, cert_type: '', category: '', cert_number: '', holder_name: '', issuer: '', issue_date: '', expiry_date: '', file_path: null, file_name: null })

// ---------------- Per-crew certificates panel ----------------
export function CrewCerts({ crew, canEdit }) {
  const [certs, setCerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')          // '' | 'reading' | 'saving'
  const [draft, setDraft] = useState(null)      // null = no open form

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('crew_certificates').select('*')
      .eq('crew_id', crew.id).order('expiry_date', { ascending: true, nullsFirst: false })
    if (error) setError(error.message); else setCerts(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [crew.id]) // eslint-disable-line

  async function onFile(e) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    setError(''); setBusy('reading')
    // Shrink the photo before it goes anywhere. A phone snap of a certificate
    // is ~4 MB; 1600px reads just as well at a tenth of that. It is also what
    // gets sent to the reader, so the parse call is smaller too. PDFs are left
    // alone. See src/lib/downscale.js.
    const file = await downscaleImage(picked)
    const path = `${crew.fleet_id}/${crew.id}/${Date.now()}-${safeName(file.name)}`
    // upload original first so it's kept even if parsing fails
    const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (up.error) { setError('Upload failed: ' + up.error.message); setBusy(''); return }
    let fields = {}
    try { fields = await parseCertFile(file) }
    catch (err) {
      /* WHAT IT MEANS, not the API's own words — and deliberately WITHOUT the
         "go and top up the account" advice the invoices page gives. An officer
         files crew tickets and has no access to the billing console; sending
         him there is advice he cannot act on. Here the answer is always the
         same: the file is saved, type the details in, mention it to the
         skipper. The reader is a convenience on this page, never a gate. */
      setError('Saved the file, but couldn’t auto-read it — '
        + explainReadError(err.message).what
        + ' Fill the details in by hand.')
    }
    setDraft({ ...blankDraft(), ...fields, file_path: path, file_name: file.name })
    setBusy('')
  }

  function editCert(c) {
    setError('')
    setDraft({
      id: c.id, cert_type: c.cert_type || '', category: c.category || '',
      cert_number: c.cert_number || '', holder_name: c.holder_name || '', issuer: c.issuer || '',
      issue_date: c.issue_date || '', expiry_date: c.expiry_date || '',
      file_path: c.file_path, file_name: c.file_name,
    })
  }

  async function save() {
    if (!draft.cert_type.trim()) { setError('Give the certificate a type/name.'); return }
    setBusy('saving'); setError('')
    const row = {
      crew_id: crew.id, fleet_id: crew.fleet_id,
      cert_type: draft.cert_type.trim(),
      category: draft.category || null,
      cert_number: draft.cert_number?.trim() || null,
      holder_name: draft.holder_name?.trim() || null,
      issuer: draft.issuer?.trim() || null,
      issue_date: draft.issue_date || null,
      expiry_date: draft.expiry_date || null,
      file_path: draft.file_path, file_name: draft.file_name,
    }
    const { error } = draft.id
      ? await supabase.from('crew_certificates').update(row).eq('id', draft.id)
      : await supabase.from('crew_certificates').insert(row)
    if (error) { setError(error.message); setBusy(''); return }
    setDraft(null); setBusy(''); await load()
  }

  async function cancelDraft() {
    // if a NEW file was uploaded for this unsaved draft, clean it up (only when adding, not editing)
    if (!draft?.id && draft?.file_path) await supabase.storage.from(BUCKET).remove([draft.file_path])
    setDraft(null); setError('')
  }

  async function viewFile(c) {
    if (!c.file_path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(c.file_path, 3600)
    if (error) { setError(error.message); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function del(c) {
    if (!window.confirm(`Delete ${c.cert_type} for ${crew.full_name}?`)) return
    const { error } = await supabase.from('crew_certificates').delete().eq('id', c.id)
    if (error) { setError(error.message); return }
    if (c.file_path) await supabase.storage.from(BUCKET).remove([c.file_path])
    await load()
  }

  const fld = { display: 'block', marginBottom: '0.5rem' }
  const lab = { fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.15rem' }

  return (
    <div style={{ padding: '0.4rem 0.2rem 0.2rem' }}>
      {error && <p className="error" style={{ fontSize: '0.85rem' }}>{error}</p>}

      {loading ? <p className="muted" style={{ fontSize: '0.85rem' }}>Loading certificates…</p> : (
        certs.length === 0 ? <p className="muted" style={{ fontSize: '0.85rem' }}>No certificates on file yet.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
            <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '0.3rem 0.4rem' }}>Certificate</th>
              <th style={{ padding: '0.3rem 0.4rem' }}>Category</th>
              <th style={{ padding: '0.3rem 0.4rem' }}>Issued</th>
              <th style={{ padding: '0.3rem 0.4rem' }}>Expires</th>
              <th style={{ padding: '0.3rem 0.4rem' }}>Status</th>
              <th style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}></th>
            </tr></thead>
            <tbody>
              {certs.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.35rem 0.4rem' }}>
                    <strong>{c.cert_type}</strong>
                    {c.cert_number && <span className="muted" style={{ fontSize: '0.78rem' }}> · {c.cert_number}</span>}
                    {c.issuer && <div className="muted" style={{ fontSize: '0.76rem' }}>{c.issuer}</div>}
                  </td>
                  <td style={{ padding: '0.35rem 0.4rem' }}>
                    {c.category
                      ? <span style={{ fontSize: '0.76rem', fontWeight: 600, background: 'var(--grey-50)', border: '1px solid var(--border)', borderRadius: 999, padding: '0.05rem 0.5rem', whiteSpace: 'nowrap' }}>{c.category}</span>
                      : <span className="muted" style={{ fontSize: '0.76rem' }}>—</span>}
                  </td>
                  <td style={{ padding: '0.35rem 0.4rem' }}>{fmtDate(c.issue_date)}</td>
                  <td style={{ padding: '0.35rem 0.4rem' }}>{fmtDate(c.expiry_date)}</td>
                  <td style={{ padding: '0.35rem 0.4rem' }}><CertBadge expiry={c.expiry_date} /></td>
                  <td style={{ padding: '0.35rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {c.file_path && <button className="secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => viewFile(c)}>View</button>}
                    {canEdit && <button className="secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.3rem' }} onClick={() => editCert(c)}>Edit</button>}
                    {canEdit && <button className="secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.3rem' }} onClick={() => del(c)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {canEdit && !draft && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem', alignItems: 'center' }}>
          <label className="secondary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem', borderRadius: 6, cursor: busy ? 'default' : 'pointer', display: 'inline-block' }}>
            {busy === 'reading' ? 'Reading…' : '+ Upload & auto-read cert'}
            <input type="file" accept="image/*,application/pdf" onChange={onFile} disabled={!!busy} style={{ display: 'none' }} />
          </label>
          <button className="secondary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }} disabled={!!busy} onClick={() => setDraft(blankDraft())}>Add manually</button>
        </div>
      )}

      {draft && (
        <div className="card" style={{ marginTop: '0.6rem', background: 'var(--bg-soft, #f8fafc)' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>
            {draft.id ? 'Edit certificate' : (draft.file_name ? 'Check the details we read, then save' : 'New certificate')}
            {draft.file_name && <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}> · {draft.file_name}</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ ...fld, flex: 2, minWidth: 180 }}><div style={lab}>Certificate type *</div>
              <input value={draft.cert_type} onChange={e => setDraft({ ...draft, cert_type: e.target.value })} placeholder="e.g. ENG1 Medical" /></label>
            <label style={{ ...fld, flex: 1, minWidth: 150 }}><div style={lab}>Category (for the matrix)</div>
              <select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
                <option value="">— uncategorised —</option>
                {CERT_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select></label>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ ...fld, flex: 1, minWidth: 140 }}><div style={lab}>Cert number</div>
              <input value={draft.cert_number || ''} onChange={e => setDraft({ ...draft, cert_number: e.target.value })} /></label>
            <label style={{ ...fld, flex: 1, minWidth: 140 }}><div style={lab}>Issuer</div>
              <input value={draft.issuer || ''} onChange={e => setDraft({ ...draft, issuer: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ ...fld, flex: 1, minWidth: 140 }}><div style={lab}>Issue date</div>
              <input type="date" value={draft.issue_date || ''} onChange={e => setDraft({ ...draft, issue_date: e.target.value })} /></label>
            <label style={{ ...fld, flex: 1, minWidth: 140 }}><div style={lab}>Expiry date</div>
              <input type="date" value={draft.expiry_date || ''} onChange={e => setDraft({ ...draft, expiry_date: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
            <button onClick={save} disabled={busy === 'saving'}>{busy === 'saving' ? 'Saving…' : (draft.id ? 'Save changes' : 'Save certificate')}</button>
            <button className="secondary" onClick={cancelDraft} disabled={busy === 'saving'}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- Fleet-wide "certificates due" banner ----------------
export function CertAlerts() {
  const [due, setDue] = useState([])

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('crew_certificates')
        .select('id, cert_type, expiry_date, crew_id, crew(full_name)')
      if (error || !data) return
      const flagged = data
        .map(c => ({ ...c, s: certStatus(c.expiry_date) }))
        .filter(c => c.s.state === 'expired' || c.s.state === 'due')
        .sort((a, b) => certUrgency(a.expiry_date) - certUrgency(b.expiry_date))
      setDue(flagged)
    })()
  }, [])

  if (!due.length) return null
  return (
    <div className="card" style={{ borderColor: 'var(--amber)', marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>⚠ Certificates due for renewal <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>(within {CERT_LEAD_DAYS} days or expired)</span></h2>
      <div style={{ display: 'grid', gap: '0.3rem' }}>
        {due.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.88rem' }}>
            <CertBadge expiry={c.expiry_date} />
            <strong>{c.crew?.full_name || 'Crew'}</strong>
            <span>{c.cert_type}</span>
            <span className="muted">expires {fmtDate(c.expiry_date)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
