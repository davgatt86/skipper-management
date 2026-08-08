import { useEffect, useMemo, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

// What changed, when, and by whom.
//
// Deliberately under Admin rather than on the dashboard: the dashboard is for
// the boat — last trip, quota position, what needs doing. This is for going
// back and answering "who set that bonus to zero", which is a different job
// and not something to put in front of a skipper every morning.
//
// It reads audit_log, which now covers contracts, crew, landings, one-off
// bonuses, payments, settings, the eight rota tables and the seven quota
// tables. RLS scopes it to the signed-in fleet.

const fmtWhen = (t) => (t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—')

const ACTION_STYLE = {
  insert: { label: 'added', color: 'var(--kelp)' },
  update: { label: 'changed', color: 'var(--brass)' },
  delete: { label: 'deleted', color: 'var(--rust)' },
}

// The one field worth showing per table, so a row reads as English rather
// than as a uuid.
const NAME_OF = (t, d) => {
  if (!d) return ''
  return d.full_name || d.cert_type || d.stock || d.label || d.name
    || d.reference || d.trip_nr || d.vessel || d.buyer
    || (d.start_date ? `${d.start_date} → ${d.end_date || ''}` : '')
    || (d.month ? String(d.month).slice(0, 7) : '')
    || ''
}

// Which fields actually differ on an update — the whole point of looking.
function changedFields(before, after) {
  if (!before || !after) return []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out = []
  for (const k of keys) {
    if (k === 'updated_at' || k === 'created_at') continue
    const a = before[k], b = after[k]
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, from: a, to: b })
  }
  return out
}

const short = (v) => {
  if (v === null || v === undefined || v === '') return '—'
  const s = String(v)
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

export default function Activity() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'

  const [rows, setRows] = useState([])
  const [users, setUsers] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [table, setTable] = useState('')
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState('')
  const [limit, setLimit] = useState(200)

  useEffect(() => {
    if (!isSkipper) { setLoading(false); return }
    async function load() {
      setLoading(true); setError('')
      const [aRes, uRes] = await Promise.all([
        supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(limit),
        supabase.from('app_users').select('id, full_name, email'),
      ])
      if (aRes.error) setError(aRes.error.message)
      setRows(aRes.data || [])
      setUsers(Object.fromEntries((uRes.data || []).map((u) => [u.id, u.full_name || u.email])))
      setLoading(false)
    }
    load()
  }, [isSkipper, limit])

  const tables = useMemo(
    () => [...new Set(rows.map((r) => r.table_name))].sort(),
    [rows]
  )

  const visible = useMemo(() => rows.filter((r) => {
    if (table && r.table_name !== table) return false
    if (action && r.action !== action) return false
    if (!q.trim()) return true
    const hay = `${r.table_name} ${r.action} ${users[r.user_id] || ''} ${NAME_OF(r.table_name, r.before_data)} ${NAME_OF(r.table_name, r.after_data)}`.toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  }), [rows, table, action, q, users])

  if (!isSkipper) {
    return <AppShell><div className="card"><p className="muted">Skipper access only.</p></div></AppShell>
  }

  const th = { padding: '0.45rem 0.4rem', textAlign: 'left', borderBottom: '2px solid var(--border)' }
  const td = { padding: '0.45rem 0.4rem', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

  return (
    <AppShell>
      <PageHeader title="Activity" sub="What changed, when, and by whom" />

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      <div className="card no-print" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={table} onChange={(e) => setTable(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Everything</option>
          {tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Any change</option>
          <option value="insert">Added</option>
          <option value="update">Changed</option>
          <option value="delete">Deleted</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ maxWidth: 220 }} />
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 'auto', marginLeft: 'auto' }}>
          <option value={200}>Last 200</option>
          <option value={1000}>Last 1000</option>
          <option value={5000}>Last 5000</option>
        </select>
      </div>

      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: '0.82rem' }}>
          Covers contracts, crew, landings, bonuses, payments, settings, the rota and quota.
          Sales rows and settlements are <strong>not</strong> tracked yet — re-ingesting a sales
          note replaces its rows in place, so that history is not recoverable from here.
        </p>

        {loading ? <p className="muted">Loading…</p> : visible.length === 0 ? (
          <p className="muted">Nothing matches.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem' }}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>What</th>
                  <th style={th}></th>
                  <th style={th}>Who</th>
                  <th style={{ ...th, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const st = ACTION_STYLE[r.action] || { label: r.action, color: 'var(--mute)' }
                  const name = NAME_OF(r.table_name, r.after_data || r.before_data)
                  const diffs = r.action === 'update' ? changedFields(r.before_data, r.after_data) : []
                  const isOpen = open === r.id
                  return (
                    <>
                      <tr key={r.id}>
                        <td style={td} className="muted">{fmtWhen(r.occurred_at)}</td>
                        <td style={td}>
                          <strong>{r.table_name}</strong>
                          {name && <div className="muted" style={{ fontSize: '0.8rem' }}>{name}</div>}
                        </td>
                        <td style={{ ...td, color: st.color, fontWeight: 700 }}>{st.label}</td>
                        <td style={td} className="muted">{users[r.user_id] || (r.user_id ? 'unknown user' : 'system')}</td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {(diffs.length > 0 || r.action === 'delete') && (
                            <button className="secondary" onClick={() => setOpen(isOpen ? '' : r.id)} style={{ padding: '0.15rem 0.55rem', fontSize: '0.78rem' }}>
                              {isOpen ? 'Hide' : r.action === 'delete' ? 'What was lost' : `${diffs.length} field${diffs.length === 1 ? '' : 's'}`}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={r.id + '-d'}>
                          <td colSpan={5} style={{ ...td, background: 'var(--bg-soft, #f8fafc)' }}>
                            {r.action === 'update' ? (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                <tbody>
                                  {diffs.map((d) => (
                                    <tr key={d.field}>
                                      <td style={{ padding: '0.2rem 0.4rem', fontWeight: 600, width: 180 }}>{d.field}</td>
                                      <td style={{ padding: '0.2rem 0.4rem', color: 'var(--rust)' }}>{short(d.from)}</td>
                                      <td style={{ padding: '0.2rem 0.4rem', color: 'var(--mute)' }}>→</td>
                                      <td style={{ padding: '0.2rem 0.4rem', color: 'var(--kelp)' }}>{short(d.to)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {JSON.stringify(r.before_data, null, 1)}
                              </pre>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
