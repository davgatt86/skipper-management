import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import BackNav from '../BackNav'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { certStatus, certUrgency, CERT_LEAD_DAYS } from '../lib/certs/certStatus'

const BUCKET = 'crew-certs'
const fmt = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB') : '—')

function CertBadge({ expiry }) {
  const s = certStatus(expiry)
  return (
    <span style={{
      display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.78rem',
      fontWeight: 700, color: '#fff', background: s.color, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

// Fleet-wide crew certificate register — a read-across of every crewman's
// tickets/medicals with renewal status, plus a crew x certificate matrix.
// Modelled on Ægir's fleet-wide certificate tracking + Crew Competency
// Matrix. Per-crew editing/upload lives on the Crew page (CrewCerts panel).
export default function CrewCertsRegister() {
  const { appUser } = useAuth()
  const [rows, setRows] = useState([])
  const [crew, setCrew] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('list')      // list | matrix
  const [filter, setFilter] = useState('all')    // all | expired | due | valid | none
  const [q, setQ] = useState('')

  async function load() {
    setLoading(true); setError('')
    const [cRes, certRes] = await Promise.all([
      supabase.from('crew').select('id, full_name, status').is('archived_at', null).neq('status', 'former').order('full_name'),
      supabase.from('crew_certificates').select('id, cert_type, cert_number, issuer, issue_date, expiry_date, file_path, crew_id, crew(full_name, status)'),
    ])
    if (certRes.error) setError(certRes.error.message)
    setCrew(cRes.data || [])
    setRows(certRes.data || [])
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
    if (q.trim()) {
      const hay = `${r.crew?.full_name || ''} ${r.cert_type || ''} ${r.issuer || ''} ${r.cert_number || ''}`.toLowerCase()
      if (!hay.includes(q.trim().toLowerCase())) return false
    }
    return true
  }), [enriched, filter, q])

  // --- Matrix: crew (rows) x distinct cert types (columns) ---
  const matrix = useMemo(() => {
    const types = [...new Set(rows.map((r) => r.cert_type).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    const byCrew = new Map()
    // seed with every active crewman so gaps show
    for (const c of crew) byCrew.set(c.full_name, {})
    for (const r of rows) {
      const name = r.crew?.full_name || '—'
      if (!byCrew.has(name)) byCrew.set(name, {})
      const cell = byCrew.get(name)
      // keep the most urgent cert of this type
      if (!cell[r.cert_type] || certUrgency(r.expiry_date) < certUrgency(cell[r.cert_type].expiry_date)) {
        cell[r.cert_type] = r
      }
    }
    const people = [...byCrew.keys()].sort((a, b) => a.localeCompare(b))
    return { types, people, byCrew }
  }, [rows, crew])

  async function viewFile(c) {
    if (!c.file_path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(c.file_path, 3600)
    if (error) { setError(error.message); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const Pill = ({ id, label, count, color }) => (
    <button onClick={() => setFilter(id)}
      style={{
        padding: '0.3rem 0.7rem', borderRadius: 999, fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${filter === id ? (color || 'var(--navy)') : 'var(--border)'}`,
        background: filter === id ? (color || 'var(--navy)') : 'transparent',
        color: filter === id ? '#fff' : 'var(--navy)',
      }}>
      {label} {count != null && <span style={{ opacity: 0.8 }}>· {count}</span>}
    </button>
  )

  const Tab = ({ id, label }) => (
    <button onClick={() => setView(id)}
      style={{
        padding: '0.35rem 0.9rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
        border: '1px solid var(--border)', borderRadius: 6,
        background: view === id ? 'var(--navy)' : 'transparent', color: view === id ? '#fff' : 'var(--navy)',
      }}>{label}</button>
  )

  return (
    <div className="container">
      <div style={{ marginBottom: '1rem' }}><BackNav /></div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Crew Certificates</h1>
          <p className="muted" style={{ marginTop: '0.2rem', fontSize: '0.85rem' }}>
            Also: <Link to="/crew-list">Crew List</Link> · <Link to="/engine-logs">Engine Log</Link>
          </p>
        </div>
        <Link to="/">← Dashboard</Link>
      </header>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><p className="error">{error}</p></div>}

      {/* Summary counts */}
      <div className="card">
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
          <Stat label="On file" value={counts.all} accent="var(--navy)" />
          <Stat label="Expired" value={counts.expired} accent="var(--red)" />
          <Stat label={`Due (≤${CERT_LEAD_DAYS}d)`} value={counts.due} accent="var(--amber)" />
          <Stat label="Valid" value={counts.valid} accent="var(--green)" />
          <Stat label="No expiry" value={counts.none} accent="var(--grey-400)" />
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
          <Tab id="list" label="List" />
          <Tab id="matrix" label="Matrix" />
          <span style={{ marginLeft: 'auto' }} />
          {view === 'list' && visible.length > 0 && <button onClick={() => makeListPdf(visible)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>Export PDF</button>}
          {view === 'matrix' && matrix.people.length > 0 && <button onClick={() => makeMatrixPdf(matrix)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>Export PDF</button>}
        </div>

        {loading ? <p className="muted">Loading…</p> : enriched.length === 0 ? (
          <p className="muted">No certificates on file yet. Add them per crewman on the <Link to="/crew">Crew page →</Link></p>
        ) : view === 'list' ? (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
              <Pill id="all" label="All" count={counts.all} />
              <Pill id="expired" label="Expired" count={counts.expired} color="var(--red)" />
              <Pill id="due" label="Due soon" count={counts.due} color="var(--amber)" />
              <Pill id="valid" label="Valid" count={counts.valid} color="var(--green)" />
              <Pill id="none" label="No expiry" count={counts.none} color="var(--grey-400)" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search crew, certificate, issuer…"
                style={{ marginLeft: 'auto', minWidth: 220, padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)' }} />
            </div>
            {visible.length === 0 ? <p className="muted">Nothing matches this filter.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                      <th style={{ padding: '0.5rem 0.4rem' }}>Crew</th>
                      <th style={{ padding: '0.5rem 0.4rem' }}>Certificate</th>
                      <th style={{ padding: '0.5rem 0.4rem' }}>Issued</th>
                      <th style={{ padding: '0.5rem 0.4rem' }}>Expires</th>
                      <th style={{ padding: '0.5rem 0.4rem' }}>Status</th>
                      <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.45rem 0.4rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{c.crew?.full_name || '—'}</td>
                        <td style={{ padding: '0.45rem 0.4rem' }}>
                          {c.cert_type}
                          {c.cert_number && <span className="muted" style={{ fontSize: '0.78rem' }}> · {c.cert_number}</span>}
                          {c.issuer && <div className="muted" style={{ fontSize: '0.76rem' }}>{c.issuer}</div>}
                        </td>
                        <td style={{ padding: '0.45rem 0.4rem', whiteSpace: 'nowrap' }}>{fmt(c.issue_date)}</td>
                        <td style={{ padding: '0.45rem 0.4rem', whiteSpace: 'nowrap' }}>{fmt(c.expiry_date)}</td>
                        <td style={{ padding: '0.45rem 0.4rem' }}><CertBadge expiry={c.expiry_date} /></td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {c.file_path && <button className="secondary" onClick={() => viewFile(c)} style={{ padding: '0.2rem 0.55rem', fontSize: '0.8rem' }}>View</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', marginBottom: '0.6rem', fontSize: '0.78rem' }}>
              <Legend color="var(--green)" label={`Valid (>${CERT_LEAD_DAYS}d)`} />
              <Legend color="var(--amber)" label={`Due (≤${CERT_LEAD_DAYS}d)`} />
              <Legend color="var(--red)" label="Expired" />
              <Legend color="var(--grey-400)" label="No expiry" />
              <Legend color="transparent" label="—  not held" border />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', left: 0, background: 'var(--bg, #fff)', textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid var(--border)' }}>Crew</th>
                    {matrix.types.map((t) => (
                      <th key={t} style={{ padding: '0.4rem 0.3rem', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.people.map((name) => (
                    <tr key={name} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ position: 'sticky', left: 0, background: 'var(--bg, #fff)', fontWeight: 600, padding: '0.4rem', whiteSpace: 'nowrap' }}>{name}</td>
                      {matrix.types.map((t) => {
                        const cell = matrix.byCrew.get(name)?.[t]
                        if (!cell) return <td key={t} style={{ textAlign: 'center', color: 'var(--grey-400)', padding: '0.3rem' }}>—</td>
                        const s = certStatus(cell.expiry_date)
                        const txt = s.days == null ? 'No exp' : s.days < 0 ? 'Exp' : `${s.days}d`
                        return (
                          <td key={t} style={{ textAlign: 'center', padding: '0.25rem' }}>
                            <span title={`${t} · ${s.label}`} style={{ display: 'inline-block', minWidth: 40, padding: '0.12rem 0.35rem', borderRadius: 4, color: '#fff', fontWeight: 700, background: s.color }}>{txt}</span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.8rem' }}>
          Add, edit or upload certificates for each crewman on the <Link to="/crew">Crew page</Link>.
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: accent || 'var(--navy)' }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
    </div>
  )
}

function Legend({ color, label, border }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: color, border: border ? '1px solid var(--border)' : 'none', display: 'inline-block' }} />
      {label}
    </span>
  )
}

function makeListPdf(rows) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40; let y = 46
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('CREW CERTIFICATE REGISTER', W / 2, y, { align: 'center' }); y += 24
  autoTable(doc, {
    startY: y,
    head: [['Crew', 'Certificate', 'Number', 'Issuer', 'Issued', 'Expires', 'Status']],
    body: rows.map((c) => [c.crew?.full_name || '', c.cert_type || '', c.cert_number || '', c.issuer || '', fmt(c.issue_date), fmt(c.expiry_date), certStatus(c.expiry_date).label]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [20, 50, 80], textColor: 255 },
    margin: { left: M, right: M },
  })
  doc.setFontSize(8); doc.setTextColor(120)
  doc.text(`Generated ${new Date().toLocaleString('en-GB')} · Skipper Management`, M, doc.internal.pageSize.getHeight() - 24)
  doc.save(`crew-certificates-${new Date().toISOString().slice(0, 10)}.pdf`)
}

function makeMatrixPdf(matrix) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth(); const M = 30; let y = 42
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('CREW COMPETENCY MATRIX', W / 2, y, { align: 'center' }); y += 18
  autoTable(doc, {
    startY: y,
    head: [['Crew', ...matrix.types]],
    body: matrix.people.map((name) => [name, ...matrix.types.map((t) => {
      const cell = matrix.byCrew.get(name)?.[t]
      if (!cell) return '—'
      const s = certStatus(cell.expiry_date)
      return s.days == null ? 'No exp' : s.days < 0 ? 'Expired' : `${s.days}d`
    })]),
    styles: { fontSize: 6, cellPadding: 2 },
    headStyles: { fillColor: [20, 50, 80], textColor: 255, fontSize: 6 },
    margin: { left: M, right: M },
  })
  doc.save(`crew-competency-matrix-${new Date().toISOString().slice(0, 10)}.pdf`)
}
