import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useCurrentVessel } from '../VesselContext'
import { pickDetails } from '../lib/vessels'
import { useAuth } from '../AuthContext'
import { certStatus, certUrgency, CERT_LEAD_DAYS } from '../lib/certs/certStatus'
import { parseVesselCertFile } from '../lib/certs/parseCert'
import { downscaleImage } from '../lib/downscale'
import UnattachedFiles from '../components/UnattachedFiles'

const BUCKET = 'vessel-certs'
const safeName = (s) => String(s || 'file').replace(/[^\w.\-]+/g, '_').slice(-80)

// The vessel's own certificates, as distinct from the crew's.
//
// Same shape as the crew register on purpose — same certStatus helper, same
// 60-day lead, same colours — so "expired" means the same thing on both pages.
//
// A cert is filed against a CATEGORY chosen on entry rather than guessed from
// its name. That is the one point where this beats Aegir, whose matrix carries
// several spellings of the same certificate because it keys off typed text.

// Aegir's own three, kept so the two records can be compared, plus a bucket
// for anything that fits none of them.
/* The categories a vessel's papers are actually filed under at sea.
 *
 * "Safety" was doing far too much: liferafts, lifejackets, fire suppression,
 * extinguishers, medical stores and a Certificate of Measurement all sat in one
 * bundle of seven, which is no more use than no grouping at all — a surveyor
 * asking for the LSA file does not want the medical stores certificate.
 *
 * Split along the lines the trade already uses. LSA and FFA are the two that
 * matter most because they are inspected together and expire on their own
 * service cycles.
 *
 * `Safety` is kept at the end so certificates filed under it before the split
 * still land somewhere sensible rather than falling into Other. */
export const VESSEL_CERT_CATEGORIES = [
  'Statutory',      // registry, tonnage, fishing vessel certificate, ILO 188
  'LSA',            // life-saving: liferafts, lifejackets, EPIRB, flares
  'FFA',            // fire-fighting: extinguishers, fixed systems
  'Radio',          // GMDSS, radio licence
  'Pollution',      // MARPOL, anti-fouling, oil record
  'Medical',        // ships medical stores, first aid
  'Machinery',      // engine, gearbox, shaft, crane and lifting gear
  'Insurance',
  'Equipment',
  'Safety',         // legacy bucket — kept so old filings still show
  'Other',
]

const fmt = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—')
const blank = () => ({ cert_type: '', category: 'Statutory', cert_number: '', issuer: '', issue_date: '', expiry_date: '', notes: '', file_path: null, file_name: null })

function Badge({ expiry }) {
  const s = certStatus(expiry)
  return (
    <span style={{
      display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.78rem',
      fontWeight: 700, color: '#fff', background: s.color, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: accent, fontFamily: 'var(--font-mono, monospace)' }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
    </div>
  )
}

export default function VesselCerts() {
  const { appUser } = useAuth()
  const canEdit = appUser?.role === 'skipper'

  const [rows, setRows] = useState([])
  const [vessel, setVessel] = useState(null)
  // The certificate register prints the boat's name and PLN on its header, so
  // it needs to know which boat — one row per boat since Aug 2026.
  const boat = useCurrentVessel()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(blank())
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState('')

  async function load() {
    setLoading(true); setError('')
    const [cRes, vRes] = await Promise.all([
      supabase.from('vessel_certificates').select('*'),
      supabase.from('vessel_details').select('vessel_name, pln, vessel_id'),
    ])
    if (cRes.error) setError(cRes.error.message)
    setRows(cRes.data || [])
    setVessel(pickDetails(vRes.data, boat.current))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const enriched = useMemo(() => rows
    .map((c) => ({ ...c, s: certStatus(c.expiry_date) }))
    .sort((a, b) => certUrgency(a.expiry_date) - certUrgency(b.expiry_date)), [rows])

  const counts = useMemo(() => {
    const c = { all: enriched.length, expired: 0, due: 0, valid: 0, none: 0 }
    for (const r of enriched) {
      if (r.s.state === 'expired') c.expired++
      else if (r.s.state === 'due') c.due++
      else if (r.s.state === 'valid') c.valid++
      else c.none++
    }
    return c
  }, [enriched])

  const visible = useMemo(() => enriched.filter((r) => {
    if (filter !== 'all' && r.s.state !== filter) return false
    if (!q.trim()) return true
    const hay = `${r.cert_type} ${r.category} ${r.cert_number} ${r.issuer} ${r.notes}`.toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  }), [enriched, filter, q])

  const byCategory = useMemo(() => {
    const g = {}
    for (const r of visible) (g[r.category || 'Other'] = g[r.category || 'Other'] || []).push(r)
    return VESSEL_CERT_CATEGORIES
      .filter((c) => g[c]?.length)
      .map((c) => [c, g[c]])
      .concat(Object.entries(g).filter(([k]) => !VESSEL_CERT_CATEGORIES.includes(k)))
  }, [visible])

  // Upload the original FIRST, so a photo is kept even if the reader fails or
  // the skipper walks away — same order as the crew certificate page.
  async function onFile(e) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked || !appUser?.fleet_id) return
    setError(''); setReading('uploading')
    // Shrink first — see the note on the crew certificate page and
    // src/lib/downscale.js. PDFs pass through untouched.
    const file = await downscaleImage(picked)
    const path = `${appUser.fleet_id}/${Date.now()}-${safeName(file.name)}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (up.error) { setError('Upload failed: ' + up.error.message); setReading(''); return }
    setReading('reading')
    let fields = {}
    try { fields = await parseVesselCertFile(file) }
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
    setDraft({
      ...blank(),
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null)),
      file_path: path, file_name: file.name,
    })
    setEditing(null); setAdding(true); setReading('')
  }

  async function viewFile(r) {
    if (!r.file_path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.file_path, 3600)
    if (error) { setError(error.message); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function save(e) {
    e.preventDefault()
    if (!draft.cert_type.trim()) return
    setBusy(true)
    const payload = {
      cert_type: draft.cert_type.trim(),
      category: draft.category,
      cert_number: draft.cert_number.trim() || null,
      issuer: draft.issuer.trim() || null,
      issue_date: draft.issue_date || null,
      expiry_date: draft.expiry_date || null,
      notes: draft.notes.trim() || null,
      file_path: draft.file_path || null,
      file_name: draft.file_name || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = editing
      ? await supabase.from('vessel_certificates').update(payload).eq('id', editing)
      : await supabase.from('vessel_certificates').insert(payload)
    setBusy(false)
    if (error) { setError(error.message); return }
    setDraft(blank()); setAdding(false); setEditing(null)
    load()
  }

  function startEdit(r) {
    setDraft({
      cert_type: r.cert_type || '', category: r.category || 'Statutory',
      cert_number: r.cert_number || '', issuer: r.issuer || '',
      issue_date: r.issue_date || '', expiry_date: r.expiry_date || '', notes: r.notes || '',
      file_path: r.file_path || null, file_name: r.file_name || null,
    })
    setEditing(r.id); setAdding(true)
  }

  async function remove(r) {
    if (!confirm(`Delete "${r.cert_type}"? This can't be undone.`)) return
    const { error } = await supabase.from('vessel_certificates').delete().eq('id', r.id)
    if (error) { setError(error.message); return }
    // Take the stored document with it, or the bucket fills with files nothing
    // points at.
    if (r.file_path) await supabase.storage.from(BUCKET).remove([r.file_path])
    load()
  }

  const th = { padding: '0.5rem 0.4rem', textAlign: 'left' }
  const title = [vessel?.vessel_name, vessel?.pln].filter(Boolean).join(' ')

  return (
    <AppShell>
      <PageHeader title="Vessel Certificates" sub={title || 'The vessel’s own papers'}>
        {canEdit && !adding && (
          <>
            <label className="secondary" style={{ padding: '0.45rem 0.9rem', borderRadius: 7, cursor: reading ? 'wait' : 'pointer', border: '1px solid var(--border)', marginRight: '0.4rem', display: 'inline-block' }}>
              {reading === 'uploading' ? 'Uploading…' : reading === 'reading' ? 'Reading…' : '📷 Photo or PDF'}
              <input type="file" accept="image/*,application/pdf" onChange={onFile} disabled={!!reading} style={{ display: 'none' }} />
            </label>
            <button onClick={() => { setDraft(blank()); setEditing(null); setAdding(true) }}>+ Add by hand</button>
          </>
        )}
      </PageHeader>

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      {/* Photos uploaded but never attached to a certificate — see the note in
          the component. Renders nothing when there are none. */}
      <UnattachedFiles
        bucket={BUCKET}
        fleetId={appUser?.fleet_id}
        referenced={rows.map((r) => r.file_path).filter(Boolean)}
        canDelete={canEdit}
        onChange={load}
      />

      <div className="card">
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
          <Stat label="On file" value={counts.all} accent="var(--hull)" />
          <Stat label="Expired" value={counts.expired} accent="var(--rust)" />
          <Stat label={`Due (≤${CERT_LEAD_DAYS}d)`} value={counts.due} accent="var(--brass)" />
          <Stat label="Valid" value={counts.valid} accent="var(--kelp)" />
          <Stat label="No expiry" value={counts.none} accent="var(--mute)" />
        </div>
      </div>

      {counts.expired > 0 && (
        <div className="card" style={{ borderColor: 'var(--rust)' }}>
          <h2 style={{ marginTop: 0, color: 'var(--rust)' }}>
            {counts.expired} certificate{counts.expired === 1 ? '' : 's'} expired
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {enriched.filter((r) => r.s.state === 'expired').map((r) => (
              <li key={r.id} style={{ padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
                <strong>{r.cert_type}</strong>{' '}
                <span style={{ color: 'var(--rust)', fontWeight: 700, fontSize: '0.85rem' }}>{r.s.label}</span>
                <span className="muted" style={{ fontSize: '0.8rem' }}> · {r.issuer || 'no issuer'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding && canEdit && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{editing ? 'Edit certificate' : 'Add certificate'}</h2>
          <form onSubmit={save}>
            <div style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <Field label="Certificate"><input value={draft.cert_type} onChange={(e) => setDraft((p) => ({ ...p, cert_type: e.target.value }))} placeholder="UK Fishing Vessel Certificate" required /></Field>
              <Field label="Category">
                <select value={draft.category} onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}>
                  {VESSEL_CERT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Issuer"><input value={draft.issuer} onChange={(e) => setDraft((p) => ({ ...p, issuer: e.target.value }))} placeholder="Maritime & Coastguard Agency" /></Field>
              <Field label="Certificate number"><input value={draft.cert_number} onChange={(e) => setDraft((p) => ({ ...p, cert_number: e.target.value }))} /></Field>
              <Field label="Issued"><input type="date" value={draft.issue_date} onChange={(e) => setDraft((p) => ({ ...p, issue_date: e.target.value }))} /></Field>
              <Field label="Expires"><input type="date" value={draft.expiry_date} onChange={(e) => setDraft((p) => ({ ...p, expiry_date: e.target.value }))} /></Field>
            </div>
            <div style={{ marginTop: '0.7rem' }}>
              <Field label="Notes"><input value={draft.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} placeholder="Anything worth knowing at renewal" /></Field>
            </div>
            <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
              Leave Expires blank for a certificate that does not run out.
              {draft.file_name && <> Document attached: <strong>{draft.file_name}</strong>.</>}
              {' '}Everything read off a photo is a suggestion — check it against the paper before saving.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem' }}>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add'}</button>
              <button type="button" className="secondary" onClick={() => { setAdding(false); setEditing(null); setDraft(blank()) }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
          {[['all', 'All'], ['expired', 'Expired'], ['due', 'Due'], ['valid', 'Valid'], ['none', 'No expiry']].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? '' : 'secondary'}
              onClick={() => setFilter(id)}
              style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}
            >{label}</button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ maxWidth: 220, marginLeft: 'auto' }} />
          {visible.length > 0 && <button onClick={() => makePdf(vessel, visible)} style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }}>Export PDF</button>}
        </div>

        {loading ? <p className="muted">Loading…</p>
          : enriched.length === 0 ? (
            <p className="muted">
              No vessel certificates on file yet. {canEdit && 'Add the first with the button above.'}
            </p>
          ) : visible.length === 0 ? <p className="muted">Nothing matches that filter.</p>
            : byCategory.map(([cat, list]) => (
              <div key={cat} style={{ marginBottom: '1.2rem' }}>
                <h3 style={{ marginBottom: '0.4rem' }}>{cat} <span className="muted" style={{ fontWeight: 400, fontSize: '0.85rem' }}>({list.length})</span></h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)' }}>
                        <th style={th}>Certificate</th>
                        <th style={th}>Issuer</th>
                        <th style={th}>Number</th>
                        <th style={th}>Issued</th>
                        <th style={th}>Expires</th>
                        <th style={th}>Status</th>
                        {canEdit && <th style={{ ...th, textAlign: 'right' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ ...th, fontWeight: 600 }}>
                            {r.cert_type}
                            {r.notes && <div className="muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}>{r.notes}</div>}
                            {r.file_path ? (
                              <button onClick={() => viewFile(r)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--hull)', fontWeight: 400, fontSize: '0.75rem', textDecoration: 'underline' }}>
                                📄 {r.file_name || 'view document'}
                              </button>
                            ) : r.file_name ? (
                              <div className="muted" style={{ fontWeight: 400, fontSize: '0.72rem' }} title="Recorded in Aegir; the file itself was never carried over">
                                {r.file_name} — in Aegir only
                              </div>
                            ) : null}
                          </td>
                          <td style={th} className="muted">{r.issuer || '—'}</td>
                          <td style={{ ...th, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem' }}>{r.cert_number || '—'}</td>
                          <td style={th}>{fmt(r.issue_date)}</td>
                          <td style={th}>{fmt(r.expiry_date)}</td>
                          <td style={th}><Badge expiry={r.expiry_date} /></td>
                          {canEdit && (
                            <td style={{ ...th, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button className="secondary" onClick={() => startEdit(r)} style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem', marginRight: '0.3rem' }}>Edit</button>
                              <button className="secondary" onClick={() => remove(r)} style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>Delete</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
      </div>

      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Crew tickets and medicals are on the <Link to="/crew-certs">crew certificates</Link> page.
      </p>
    </AppShell>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600 }}>
      {label}{children}
    </label>
  )
}

function makePdf(vessel, list) {
  const v = vessel || {}
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  let y = 46

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('VESSEL CERTIFICATES', W / 2, y, { align: 'center' }); y += 20
  doc.setFontSize(11)
  doc.text([v.vessel_name, v.pln].filter(Boolean).join('  ·  ') || '—', W / 2, y, { align: 'center' }); y += 22

  autoTable(doc, {
    startY: y,
    head: [['Certificate', 'Category', 'Issuer', 'Number', 'Issued', 'Expires', 'Status']],
    body: list.map((r) => [
      r.cert_type || '', r.category || '', r.issuer || '', r.cert_number || '',
      fmt(r.issue_date), fmt(r.expiry_date), certStatus(r.expiry_date).label,
    ]),
    styles: { fontSize: 8, cellPadding: 3, valign: 'top' },
    headStyles: { fillColor: [23, 73, 168], textColor: 255 },
    margin: { left: M, right: M },
  })

  const endY = (doc.lastAutoTable?.finalY || y) + 22
  doc.setFontSize(9)
  doc.text(`${list.length} certificate${list.length === 1 ? '' : 's'}`, M, endY)
  doc.setFontSize(7); doc.setTextColor(130)
  doc.text(`Generated ${new Date().toLocaleString('en-GB')} · Skipper Management`, M, doc.internal.pageSize.getHeight() - 22)

  doc.save(`vessel-certificates-${(v.pln || v.vessel_name || 'vessel').toString().replace(/[^\w]+/g, '-')}.pdf`)
}
