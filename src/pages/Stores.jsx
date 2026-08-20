import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabaseClient'
import {
  CATEGORIES, UNITS, DEFAULT_ITEMS, resolveCatalogue, categoryLabel,
  unitShort, itemKey, supplierName,
} from '../lib/stores/catalogue'
import { exportStoresPdf, exportStoresCsv } from '../lib/stores/exportStores'

/* Stores and provisions — one list per trip, built up as the trip goes on.
 *
 * The catalogue is the Whitehills Premier order form the boat already uses,
 * 334 items across 18 categories, kept in code with the fleet's own additions
 * merged over it. So a cook who invents "Chorizo" keeps it next trip, and a
 * correction I make to the shipped list still reaches every boat.
 *
 * IT EXPORTS BECAUSE THE SUPPLIER HAS NO LOGIN. That is the whole point of the
 * page — the list is worth nothing until it can be handed to the shop, so PDF
 * and CSV are first-class here rather than an afterthought.
 *
 * Stage 1 is skipper-driven. The cook login is stage 2 and is deliberately
 * separate: a new role needs the generated deny loop over every table in the
 * database, because the permissive policies here let anyone authenticated
 * through and only the restrictive fleet check stands beside them.
 */

const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')

export default function Stores() {
  const { appUser } = useAuth()
  const isSkipper = appUser?.role === 'skipper'
  const canView = isSkipper || appUser?.role === 'viewer'

  const [lists, setLists] = useState([])
  const [listId, setListId] = useState('')
  const [lines, setLines] = useState([])
  const [overrides, setOverrides] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  // view
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCat, setNewCat] = useState('MISC')
  const [newUnit, setNewUnit] = useState('unit')
  const addRef = useRef(null)

  const catalogue = useMemo(() => resolveCatalogue(overrides), [overrides])
  const byKey = useMemo(() => new Map(catalogue.map((i) => [i.key, i])), [catalogue])
  const list = useMemo(() => lists.find((l) => l.id === listId) || null, [lists, listId])

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const [ls, ov] = await Promise.all([
      supabase.from('stores_lists').select('*').order('starts_on', { ascending: false, nullsFirst: false }),
      supabase.from('stores_items').select('*'),
    ])
    if (ls.error) setErr(ls.error.message)
    setLists(ls.data || [])
    setOverrides(ov.data || [])
    setListId((cur) => cur || ls.data?.[0]?.id || '')
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!listId) { setLines([]); return }
    let cancel = false
    supabase.from('stores_list_items').select('*').eq('list_id', listId)
      .order('added_at', { ascending: true })
      .then(({ data, error }) => { if (!cancel) { if (error) setErr(error.message); setLines(data || []) } })
    return () => { cancel = true }
  }, [listId])

  async function newList() {
    // Meals for N comes from who is aboard, not from typing. It went 10 to 11
    // when Gundarovs joined and nobody would have remembered to change it.
    const { data: aboard } = await supabase.rpc('crew_aboard_count')
    const { data, error } = await supabase.from('stores_lists').insert({
      fleet_id: appUser.fleet_id,
      title: '', starts_on: today(), meals_for: aboard || null,
      created_by: (await supabase.auth.getUser()).data?.user?.id ?? null,
    }).select().single()
    if (error) { setErr(error.message); return }
    setLists((l) => [data, ...l]); setListId(data.id); setLines([])
    setMsg(aboard ? `New list — meals for ${aboard}, from who is aboard.` : 'New list started.')
  }

  async function patchList(fields) {
    if (!list) return
    setLists((ls) => ls.map((l) => (l.id === list.id ? { ...l, ...fields } : l)))
    await supabase.from('stores_lists').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', list.id)
  }

  async function addItem(item, qty = 1) {
    if (!list || !isSkipper) return
    const existing = lines.find((l) => l.item_key === item.key)
    if (existing) return bump(existing, Number(qty) || 1)
    const row = {
      fleet_id: appUser.fleet_id, list_id: list.id, item_key: item.key,
      name: item.name, category: item.category, qty: Number(qty) || 1, unit: item.unit,
      added_by: (await supabase.auth.getUser()).data?.user?.id ?? null,
    }
    const { data, error } = await supabase.from('stores_list_items').insert(row).select().single()
    if (error) { setErr(error.message); return }
    setLines((l) => [...l, data])
  }

  async function bump(line, by) {
    const qty = Math.max(0, Number(line.qty) + by)
    if (qty === 0) return removeLine(line)
    setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, qty } : l)))
    await supabase.from('stores_list_items').update({ qty }).eq('id', line.id)
  }
  async function setLine(line, fields) {
    setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, ...fields } : l)))
    await supabase.from('stores_list_items').update(fields).eq('id', line.id)
  }
  async function removeLine(line) {
    setLines((ls) => ls.filter((l) => l.id !== line.id))
    await supabase.from('stores_list_items').delete().eq('id', line.id)
  }

  /* A new item the shop carries but the form never listed. It is saved to the
   * FLEET's catalogue, not just this list, so it is there next trip — the app
   * version of the "OTHER ......" line every category on the paper form ends
   * with. */
  async function addNewItem() {
    const name = newName.trim()
    if (!name || !isSkipper) return
    const key = itemKey(newCat, name)
    const { error } = await supabase.from('stores_items').upsert({
      fleet_id: appUser.fleet_id, item_key: key, category: newCat, name, unit: newUnit,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'fleet_id,item_key' })
    if (error) { setErr(error.message); return }
    const item = { key, category: newCat, name, unit: newUnit, no: '', da: '', custom: true }
    setOverrides((o) => [...o.filter((r) => r.item_key !== key),
      { fleet_id: appUser.fleet_id, item_key: key, category: newCat, name, unit: newUnit }])
    await addItem(item)
    setNewName(''); setMsg(`“${name}” added — it will be on the list next trip too.`)
  }

  // ---- what is on screen -------------------------------------------------
  const needle = q.trim().toLowerCase()
  const onList = useMemo(() => {
    let ls = lines
    if (cat) ls = ls.filter((l) => l.category === cat)
    if (needle) ls = ls.filter((l) => l.name.toLowerCase().includes(needle))
    return ls
  }, [lines, cat, needle])

  const grouped = useMemo(() => {
    const m = new Map()
    for (const l of onList) { if (!m.has(l.category)) m.set(l.category, []); m.get(l.category).push(l) }
    return [...m.entries()].sort((a, b) =>
      CATEGORIES.findIndex((c) => c.key === a[0]) - CATEGORIES.findIndex((c) => c.key === b[0]))
  }, [onList])

  // The catalogue, minus what is already on the list — you cannot order a
  // thing twice, and seeing it offered again reads as though it did not take.
  const suggestions = useMemo(() => {
    if (!needle && !cat) return []
    const have = new Set(lines.map((l) => l.item_key))
    return catalogue
      .filter((i) => !have.has(i.key))
      .filter((i) => (!cat || i.category === cat))
      .filter((i) => (!needle || i.name.toLowerCase().includes(needle)))
      .slice(0, 60)
  }, [catalogue, lines, needle, cat])

  const exactMatch = catalogue.some((i) => i.name.toLowerCase() === needle)

  if (!canView) return <AppShell><div className="card"><p className="muted">Skipper or viewer access only.</p></div></AppShell>
  if (loading) return <AppShell><div className="card"><p className="muted">Loading…</p></div></AppShell>

  return (
    <AppShell maxWidth={1100}>
      <PageHeader title="Stores" sub={list ? `${list.title || 'Trip'} · ${fmtDate(list.starts_on)}` : 'Provisions and stores'}>
        {list && (
          <>
            <button className="secondary" onClick={() => exportStoresCsv(list, lines)} disabled={!lines.length}>CSV</button>
            <button onClick={() => exportStoresPdf(list, lines, byKey)} disabled={!lines.length}>📄 Order sheet</button>
          </>
        )}
        {isSkipper && <button className="secondary" onClick={newList}>New list</button>}
      </PageHeader>

      {err && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error" style={{ margin: 0 }}>{err}</p></div>}
      {msg && <div className="card" style={{ borderColor: 'var(--kelp)' }}><p style={{ margin: 0, fontSize: '0.9rem' }}>{msg}</p></div>}

      {!lists.length && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>No stores list yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Start one for the trip and add to it as you go. The catalogue is the {DEFAULT_ITEMS.length}-item
            order form the boat already uses, and anything you add to it stays for next time.
            {isSkipper ? '' : ' Ask the skipper to start one.'}
          </p>
          {isSkipper && <button onClick={newList}>Start a list</button>}
        </div>
      )}

      {list && (
        <>
          <div className="card">
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={LBL}>
                <span className="muted" style={CAP}>Trip</span>
                <select value={listId} onChange={(e) => setListId(e.target.value)}>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {fmtDate(l.starts_on)}{l.title ? ` · ${l.title}` : ''}{l.status !== 'building' ? ` (${l.status})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label style={LBL}>
                <span className="muted" style={CAP}>Name it</span>
                <input value={list.title || ''} placeholder="e.g. Trip 65" disabled={!isSkipper}
                       onChange={(e) => patchList({ title: e.target.value })} style={{ width: 160 }} />
              </label>
              <label style={LBL}>
                <span className="muted" style={CAP}>Sails</span>
                <input type="date" value={list.starts_on || ''} disabled={!isSkipper}
                       onChange={(e) => patchList({ starts_on: e.target.value })} />
              </label>
              <label style={LBL}>
                <span className="muted" style={CAP}>Meals for</span>
                <input type="number" min="0" value={list.meals_for ?? ''} disabled={!isSkipper}
                       onChange={(e) => patchList({ meals_for: e.target.value === '' ? null : Number(e.target.value) })}
                       style={{ width: 70 }} />
              </label>
              <label style={LBL}>
                <span className="muted" style={CAP}>Status</span>
                <select value={list.status} disabled={!isSkipper} onChange={(e) => patchList({ status: e.target.value })}>
                  <option value="building">Building</option>
                  <option value="ordered">Ordered</option>
                  <option value="received">Received</option>
                </select>
              </label>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div className="muted" style={CAP}>On the list</div>
                <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '1.6rem', fontWeight: 700 }}>
                  {lines.length}
                </div>
                <div className="muted" style={{ fontSize: '0.78rem' }}>
                  {lines.filter((l) => l.got).length} aboard
                </div>
              </div>
            </div>
          </div>

          {/* ---- search and category, driving both the list and the add ---- */}
          <div className="card">
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalogue or the list…"
                     style={{ flex: '1 1 240px' }} />
              <select value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              {(q || cat) && <button className="secondary" onClick={() => { setQ(''); setCat('') }}>Clear</button>}
            </div>

            {suggestions.length > 0 && isSkipper && (
              <div style={{ marginTop: '0.7rem' }}>
                <div className="muted" style={CAP}>Tap to add</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.3rem' }}>
                  {suggestions.map((i) => (
                    <button key={i.key} className="secondary" onClick={() => addItem(i)}
                            style={{ padding: '0.15rem 0.55rem', fontSize: '0.82rem' }}>
                      {i.name}
                      {i.unit !== 'unit' && <span className="muted"> {unitShort(i.unit)}</span>}
                      {i.custom && <span className="muted"> ·yours</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* The paper form ends every category with "OTHER ......". This is
                that line, and what it adds stays for next trip. */}
            {isSkipper && needle && !exactMatch && (
              <div style={{ marginTop: '0.7rem', paddingTop: '0.6rem', borderTop: '1px solid var(--border)' }}>
                {!showAdd ? (
                  <button className="secondary" onClick={() => { setShowAdd(true); setNewName(q); setTimeout(() => addRef.current?.focus(), 0) }}>
                    Nothing called “{q}” — add it to the catalogue
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input ref={addRef} value={newName} onChange={(e) => setNewName(e.target.value)}
                           placeholder="Item name" style={{ flex: '1 1 180px' }}
                           onKeyDown={(e) => e.key === 'Enter' && addNewItem()} />
                    <select value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                      {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                      {UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                    </select>
                    <button onClick={addNewItem} disabled={!newName.trim()}>Add</button>
                    <button className="secondary" onClick={() => setShowAdd(false)}>Cancel</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---- the order itself ---- */}
          {lines.length === 0 ? (
            <div className="card"><p className="muted" style={{ margin: 0 }}>
              Nothing on the list yet. Search above and tap an item to put it on.
            </p></div>
          ) : onList.length === 0 ? (
            <div className="card"><p className="muted" style={{ margin: 0 }}>
              Nothing on the list matches that. {lines.length} {lines.length === 1 ? 'item is' : 'items are'} on it altogether.
            </p></div>
          ) : grouped.map(([c, items]) => (
            <div className="card" key={c}>
              <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.95rem' }}>
                {categoryLabel(c)} <span className="muted" style={{ fontWeight: 400 }}>({items.length})</span>
              </h3>
              {items.map((l, i) => (
                <div key={l.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap',
                                         borderTop: i ? '1px solid var(--border)' : 'none', padding: '0.35rem 0',
                                         opacity: l.got ? 0.55 : 1 }}>
                  {isSkipper && (
                    <input type="checkbox" checked={l.got} title="Aboard"
                           onChange={(e) => setLine(l, { got: e.target.checked })} />
                  )}
                  <span style={{ flex: '1 1 10rem', textDecoration: l.got ? 'line-through' : 'none' }}>{l.name}</span>
                  <input value={l.note || ''} placeholder="note" disabled={!isSkipper}
                         onChange={(e) => setLine(l, { note: e.target.value })}
                         style={{ flex: '1 1 8rem', maxWidth: 200, fontSize: '0.82rem' }} />
                  {isSkipper && <button className="secondary" style={SM} onClick={() => bump(l, -1)}>−</button>}
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', minWidth: '2.2rem', textAlign: 'right', fontWeight: 700 }}>
                    {Number(l.qty)}
                  </span>
                  <span className="muted" style={{ fontSize: '0.78rem', minWidth: '2rem' }}>{unitShort(l.unit)}</span>
                  {isSkipper && <button className="secondary" style={SM} onClick={() => bump(l, +1)}>+</button>}
                  {isSkipper && (
                    <button className="secondary" style={{ ...SM, color: 'var(--rust)' }} title="Take off the list"
                            onClick={() => removeLine(l)}>×</button>
                  )}
                </div>
              ))}
            </div>
          ))}

          <p className="muted" style={{ fontSize: '0.78rem' }}>
            The supplier has no login, so hand them the order sheet — it prints by category with the
            quantities and any notes. Anything you add to the catalogue stays on it for next trip.
          </p>
        </>
      )}
    </AppShell>
  )
}

const LBL = { display: 'flex', flexDirection: 'column', gap: '0.15rem' }
const CAP = { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }
const SM = { padding: '0.05rem 0.45rem', fontSize: '0.9rem', lineHeight: 1.4 }
