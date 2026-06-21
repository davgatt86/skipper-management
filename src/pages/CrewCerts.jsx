import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { certStatus, certUrgency, CERT_LEAD_DAYS } from '../lib/certs/certStatus'
import { parseCertFile } from '../lib/certs/parseCert'

const BUCKET = 'crew-certs'
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—'
const safeName = n => String(n || 'cert').replace(/[^\w.\-]+/g, '_').slice(-80)

function CertBadge({ expiry }) {
  const s = certStatus(expiry)
  return (
    <span style={{
      display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.78rem',
      fontWeight: 700, color: '#fff', background: s.color, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

const blankDraft = () => ({ cert_type: '', cert_number: '', holder_name: '', issuer: '', issue_date: '', expiry_date: '', file_path: null, file_name: null })

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
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setBusy('reading')
    const path = `${crew.fleet_id}/${crew.id}/${Date.now()}-${safeName(file.name)}`
    // upload original first so it's kept even if parsing fails
    const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (up.error) { setError('Upload failed: ' + up.error.message); setBusy(''); return }
    let fields = {}
    try { fields = await parseCertFile(file) }
    catch (err) { setError('Saved the file, but couldn’t auto-read it (' + err.message + '). Fill the details in by hand.') }
    setDraft({ ...blankDraft(), ...fields, file_path: path, file_name: file.name })
    setBusy('')
  }

  async function save() {
    if (!draft.cert_type.trim()) { setError('Give the certificate a type/name.'); return }
    setBusy('saving'); setError('')
    const row = {
      crew_id: crew.id, fleet_id: crew.fleet_id,
      cert_type: draft.cert_type.trim(),
      cert_number: draft.cert_number?.trim() || null,
      holder_name: draft.holder_name?.trim() || null,
      issuer: draft.issuer?.trim() || null,
      issue_date: draft.issue_date || null,
      expiry_date: draft.expiry_date || null,
      file_path: draft.file_path, file_name: draft.file_name,
    }
    const { error } = await supabase.from('crew_certificates').insert(row)
    if (error) { setError(error.message); setBusy(''); return }
    setDraft(null); setBusy(''); await load()
  }

  async function cancelDraft() {
    // if a file was uploaded for this unsaved draft, clean it up
    if (draft?.file_path) await supabase.storage.from(BUCKET).remove([draft.file_path])
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
                  <td style={{ padding: '0.35rem 0.4rem' }}>{fmtDate(c.issue_date)}</td>
                  <td style={{ padding: '0.35rem 0.4rem' }}>{fmtDate(c.expiry_date)}</td>
                  <td style={{ padding: '0.35rem 0.4rem' }}><CertBadge expiry={c.expiry_date} /></td>
                  <td style={{ padding: '0.35rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {c.file_path && <button className="secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => viewFile(c)}>View</button>}
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
            {draft.file_name ? 'Check the details we read, then save' : 'New certificate'}
            {draft.file_name && <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}> · {draft.file_name}</span>}
          </div>
          <label style={fld}><div style={lab}>Certificate type *</div>
            <input value={draft.cert_type} onChange={e => setDraft({ ...draft, cert_type: e.target.value })} placeholder="e.g. ENG1 Medical" /></label>
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
            <button onClick={save} disabled={busy === 'saving'}>{busy === 'saving' ? 'Saving…' : 'Save certificate'}</button>
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
