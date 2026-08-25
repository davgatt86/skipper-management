import { useEffect, useMemo, useRef, useState } from 'react'
import AppShell from '../AppShell'
import PageHeader from '../PageHeader'
import { useAuth } from '../AuthContext'
import { keepsStores } from '../lib/roles'
import { supabase } from '../supabaseClient'
import { useOfflineTable } from '../lib/offline/useOfflineTable'
import SyncStatus from '../components/SyncStatus'
import {
  CATEGORIES, UNITS, DEFAULT_ITEMS, resolveCatalogue, categoryLabel,
  unitShort, itemKey, supplierName, LANGS, SECTIONS, sectionLabel,
} from '../lib/stores/catalogue'
import { exportStoresPdf, exportStoresCsv } from '../lib/stores/exportStores'
import { orderHistory } from '../lib/stores/history'
import OrderedBefore from '../components/OrderedBefore'
import { missingTranslations } from '../lib/stores/i18n'

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
 * THE COOK KEEPS IT (stage 2). His login reaches this page and nothing else —
 * `supabase/cook_role.sql` denies him every other table by a generated
 * allow-list, because the permissive policies in this database let anyone
 * authenticated through and only the restrictive fleet check stands beside
 * them. A new role sees everything in its fleet until that file runs.
 *
 * Quantities are TYPED as well as tapped: thirty packs of softies is thirty
 * taps otherwise. And a unit picked once sticks to the item for next trip —
 * the shipped units are read off the paper form, which only says it sometimes,
 * so a good number of them are my guess and want correcting on the boat.
 */

const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')

export default function Stores() {
  const { appUser } = useAuth()
  /* The cook keeps this list, and so does the skipper — adding the role does
   * not take the job off him. A viewer reads it and changes nothing.
   *
   * This is presentation only. supabase/cook_role.sql is the boundary: a cook
   * is denied every other table in the database by a generated allow-list, and
   * hiding a button hides nothing from anyone holding a session token. */
  const canEdit = keepsStores(appUser)
  const canView = canEdit || appUser?.role === 'viewer'

  /* EVERY WRITE GOES THROUGH THE OUTBOX, even on a good connection.
   *
   * The cook builds this list as the trip goes on — which is at sea, which is
   * where the signal is not. Two code paths would mean the offline one is the
   * path that never gets exercised, and it is the one that has to work on a bad
   * day. Online, the immediate flush makes it feel direct.
   *
   * All three tables are read whole and filtered here rather than queried by
   * list_id, so switching between lists works with no signal at all. */
  const listsT = useOfflineTable('stores_lists',
    { orderBy: 'starts_on', ascending: false, fleetId: appUser?.fleet_id })
  const linesT = useOfflineTable('stores_list_items',
    { orderBy: 'added_at', ascending: true, fleetId: appUser?.fleet_id })
  const itemsT = useOfflineTable('stores_items', { fleetId: appUser?.fleet_id })

  const [listId, setListId] = useState('')
  const [msg, setMsg] = useState('')

  /* WHO STARTED A LIST. The cook and the skipper both work this page, so "did
     Jackson start this one?" is a real question and the answer was nowhere on
     it — `created_by` has been stored since the table was built and never
     shown.

     IT DEGRADES RATHER THAN LEAKING. A cook can read only his OWN app_users
     row (probed: 1 row, his), so on his login another man's name does not
     resolve at all. An unresolvable id reads "another login", never a uuid —
     a raw id in front of a reader is worse than the honest gap. */
  const [people, setPeople] = useState({})
  const [me, setMe] = useState(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: u } = await supabase.auth.getUser()
      if (live) setMe(u?.user?.id ?? null)
      const { data } = await supabase.from('app_users').select('id, display_name, role')
      if (live && data) setPeople(Object.fromEntries(data.map((r) => [r.id, r])))
    })().catch(() => { /* no signal: names simply do not resolve */ })
    return () => { live = false }
  }, [])

  const startedBy = (l) => {
    if (!l?.created_by) return null
    if (l.created_by === me) return 'you'
    const p = people[l.created_by]
    return p?.display_name || 'another login'
  }

  const lists = listsT.rows
  const overrides = itemsT.rows
  const lines = useMemo(
    () => linesT.rows.filter((l) => l.list_id === listId), [linesT.rows, listId])
  const loading = listsT.loading || linesT.loading
  const err = listsT.error || linesT.error || itemsT.error
  const setErr = listsT.setError

  // view
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showHist, setShowHist] = useState(true)
  const [showTrans, setShowTrans] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCat, setNewCat] = useState('MISC')
  const [newUnit, setNewUnit] = useState('unit')
  const addRef = useRef(null)

  const catalogue = useMemo(() => resolveCatalogue(overrides), [overrides])
  const byKey = useMemo(() => new Map(catalogue.map((i) => [i.key, i])), [catalogue])
  const list = useMemo(() => lists.find((l) => l.id === listId) || null, [lists, listId])

  /* WHAT SHE USUALLY ORDERS, off every other list this boat has kept. Ranked
     by how many of them carried it before recency, so the bread bought every
     trip outranks the one-off bought last week. */
  const hist = useMemo(
    () => orderHistory(lists, linesT.rows, {
      excludeListId: listId,
      excludeKeys: lines.map((l) => l.item_key),
    }),
    [lists, linesT.rows, listId, lines])

  // The first list is selected once there is one, and the choice then sticks.
  useEffect(() => {
    setListId((cur) => (cur && lists.some((l) => l.id === cur) ? cur : lists[0]?.id || ''))
  }, [lists])

  async function newList() {
    // Meals for N comes from who is aboard, not from typing — it went 10 to 11
    // when Gundarovs joined and nobody would have remembered to change it.
    // The RPC needs the network; with no signal the list still starts, and the
    // figure is left blank rather than guessed at.
    let aboard = null
    try { ({ data: aboard } = await supabase.rpc('crew_aboard_count')) } catch { /* at sea */ }
    const id = await listsT.insert({
      fleet_id: appUser.fleet_id,
      title: '', starts_on: today(), meals_for: aboard || null,
      created_by: (await supabase.auth.getUser()).data?.user?.id ?? null,
    })
    if (!id) return
    setListId(id)
    setMsg(aboard ? `New list — meals for ${aboard}, from who is aboard.`
                  : 'New list started. Meals for N will need filling in — the crew count needs a signal.')
  }

  async function patchList(fields) {
    if (!list) return
    await listsT.update(list.id, { ...fields, updated_at: new Date().toISOString() })
  }

  async function addItem(item, qty = 1) {
    if (!list || !canEdit) return
    const existing = lines.find((l) => l.item_key === item.key)
    if (existing) return bump(existing, Number(qty) || 1)
    await linesT.insert({
      fleet_id: appUser.fleet_id, list_id: list.id, item_key: item.key,
      name: item.name, category: item.category, qty: Number(qty) || 1, unit: item.unit,
      // Both defaulted from the item so the butchers order arranges itself,
      // and both correctable per line below.
      section: item.section || null,
      pack_size: item.pack || null,
      added_at: new Date().toISOString(),
      added_by: (await supabase.auth.getUser()).data?.user?.id ?? null,
    })
  }

  async function bump(line, by) {
    const qty = Math.max(0, Number(line.qty) + by)
    if (qty === 0) return removeLine(line)
    await linesT.update(line.id, { qty })
  }
  async function setLine(line, fields) { await linesT.update(line.id, fields) }
  async function setQty(line, qty) {
    const n = Math.max(0, Number(qty) || 0)
    if (n === 0) return removeLine(line)
    await linesT.update(line.id, { qty: n })
  }
  async function removeLine(line) { await linesT.remove(line.id) }

  /* Changing a unit changes it for GOOD, not just for this line.
   *
   * The shipped units are my reading of the paper form and the form only says
   * it sometimes — "VEG COOK OIL 1LITRE" carries it, "Softies" does not — so a
   * fair number are guesses. Fixing one and having it come back wrong next
   * trip is how a correction stops being made at all, which is the same lesson
   * as crew_ranks and the fuel suppliers.
   *
   * Only `unit` is written to the override row. Writing the name and category
   * as well would freeze this fleet's copy of both, so a later correction to
   * the shipped catalogue would never reach the boat — the exact thing keeping
   * the catalogue in code is meant to avoid. resolveCatalogue() falls back to
   * the shipped values for anything the row leaves null. */
  /* A pack size and a section, both remembered against the ITEM.
   *
   * Same shape and the same reason as the unit: fixing one and having it come
   * back wrong next trip is how a correction stops being made at all. Only the
   * changed field goes into the override row, so a later correction to the
   * shipped name or category still reaches the boat. */
  async function rememberOnItem(line, fields) {
    const had = overrides.find((r) => r.item_key === line.item_key)
    if (had) await itemsT.update(had.id, { ...fields, updated_at: new Date().toISOString() })
    else await itemsT.insert({ fleet_id: appUser.fleet_id, item_key: line.item_key, ...fields })
  }

  async function setPack(line, pack) {
    if (!canEdit) return
    // 0 and blank both mean "no pack size", never "packs of nothing".
    const n = Number(pack) > 0 ? Number(pack) : null
    await linesT.update(line.id, { pack_size: n })
    await rememberOnItem(line, { pack_size: n })
  }

  async function setSection(line, section) {
    if (!canEdit) return
    await linesT.update(line.id, { section: section || null })
    await rememberOnItem(line, { section: section || null })
  }

  async function setUnit(line, unit) {
    if (!canEdit) return
    await linesT.update(line.id, { unit })
    await rememberOnItem(line, { unit })
  }

  /* A new item the shop carries but the form never listed. It is saved to the
   * FLEET's catalogue, not just this list, so it is there next trip — the app
   * version of the "OTHER ......" line every category on the paper form ends
   * with. */
  async function addNewItem() {
    const name = newName.trim()
    if (!name || !canEdit) return
    const key = itemKey(newCat, name)
    const had = overrides.find((r) => r.item_key === key)
    if (had) await itemsT.update(had.id, { category: newCat, name, unit: newUnit, hidden: false })
    else await itemsT.insert({ fleet_id: appUser.fleet_id, item_key: key, category: newCat, name, unit: newUnit })
    await addItem({ key, category: newCat, name, unit: newUnit, no: '', da: '', custom: true })
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

  /* The screen shows the butchers order in the same runs the sheet prints it —
   * breakfast, cold meat, meals for N. Seeing it laid out the way the butcher
   * will read it is the point; a cook checking his order against a shape that
   * only appears on the PDF is checking the wrong document. */
  const runsOfCategory = (items) => {
    if (!items.some((l) => l.section)) return [[null, items]]
    const m = new Map()
    for (const l of items) {
      const k = l.section || null
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(l)
    }
    return [...m.entries()].sort((a, b) => {
      if (a[0] === null) return 1
      if (b[0] === null) return -1
      return SECTIONS.findIndex((x) => x.key === a[0]) - SECTIONS.findIndex((x) => x.key === b[0])
    })
  }

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

  /* THE LANGUAGE IS THE LIST'S, not a picker that resets — a trip landing in
   * Hanstholm lands there every time that list is opened, and a cook filling in
   * Danish names should not have to re-choose it each time he comes back. */
  const lang = list?.supplier_lang || 'en'
  const untranslated = useMemo(
    () => missingTranslations(lines, byKey, lang), [lines, byKey, lang])

  async function setTranslation(line, value) {
    if (!canEdit) return
    const field = lang === 'no' ? 'name_no' : 'name_da'
    const had = overrides.find((r) => r.item_key === line.item_key)
    if (had) await itemsT.update(had.id, { [field]: value, updated_at: new Date().toISOString() })
    else await itemsT.insert({ fleet_id: appUser.fleet_id, item_key: line.item_key, [field]: value })
  }

  const exactMatch = catalogue.some((i) => i.name.toLowerCase() === needle)

  if (!canView) return <AppShell><div className="card"><p className="muted">Not available on your login.</p></div></AppShell>
  if (loading) return <AppShell><div className="card"><p className="muted">Loading…</p></div></AppShell>

  return (
    <AppShell maxWidth={1100}>
      <PageHeader title="Stores" sub={list ? `${list.title || 'Trip'} · ${fmtDate(list.starts_on)}` : 'Provisions and stores'}>
        {list && (
          <>
            <button className="secondary" onClick={() => exportStoresCsv(list, lines, byKey, list.supplier_lang || 'en')} disabled={!lines.length}>CSV</button>
            <button onClick={() => exportStoresPdf(list, lines, byKey, list.supplier_lang || 'en')} disabled={!lines.length}>📄 Order sheet</button>
          </>
        )}
        {canEdit && <button className="secondary" onClick={newList}>New list</button>}
      </PageHeader>

      {/* What is still on the device and what has not gone. A list built up
          over a trip is written where there is no signal, so the cook has to
          be able to see that his entries are held rather than lost. */}
      <SyncStatus online={linesT.online} pending={linesT.pending} failed={linesT.failed}
                  onChange={() => { linesT.sync(); listsT.sync(); itemsT.sync() }} />

      {err && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error" style={{ margin: 0 }}>{err}</p></div>}
      {msg && <div className="card" style={{ borderColor: 'var(--kelp)' }}><p style={{ margin: 0, fontSize: '0.9rem' }}>{msg}</p></div>}

      {!lists.length && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>No stores list yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Start one for the trip and add to it as you go. The catalogue is the {DEFAULT_ITEMS.length}-item
            order form the boat already uses, and anything you add to it stays for next time.
            {canEdit ? '' : ' Ask the skipper to start one.'}
          </p>
          {canEdit && <button onClick={newList}>Start a list</button>}
        </div>
      )}

      {list && (
        <>
          <div className="card">
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={LBL}>
                <span className="muted" style={CAP}>Trip</span>
                <select value={listId} onChange={(e) => setListId(e.target.value)}>
                  {lists.map((l) => {
                    /* An untitled, empty list started on another login used to
                       read as a bare date among other bare dates — which is
                       how a cook's new trip goes unnoticed. Say whose it is
                       and whether anything is on it yet. */
                    const nLines = linesT.rows.filter((x) => x.list_id === l.id).length
                    const who = startedBy(l)
                    return (
                      <option key={l.id} value={l.id}>
                        {fmtDate(l.starts_on)}
                        {l.title ? ` · ${l.title}` : ''}
                        {who && who !== 'you' ? ` · ${who}` : ''}
                        {` · ${nLines || 'nothing yet'}${nLines ? ' items' : ''}`}
                        {l.status !== 'building' ? ` (${l.status})` : ''}
                      </option>
                    )
                  })}
                </select>
              </label>
              <label style={LBL}>
                <span className="muted" style={CAP}>Name it</span>
                <input value={list.title || ''} placeholder="e.g. Trip 65" disabled={!canEdit}
                       onChange={(e) => patchList({ title: e.target.value })} style={{ width: 160 }} />
              </label>
              <label style={LBL}>
                <span className="muted" style={CAP}>Sails</span>
                <input type="date" value={list.starts_on || ''} disabled={!canEdit}
                       onChange={(e) => patchList({ starts_on: e.target.value })} />
              </label>
              <label style={LBL}>
                <span className="muted" style={CAP}>Meals for</span>
                <input type="number" min="0" value={list.meals_for ?? ''} disabled={!canEdit}
                       onChange={(e) => patchList({ meals_for: e.target.value === '' ? null : Number(e.target.value) })}
                       style={{ width: 70 }} />
              </label>
              <label style={LBL}>
                <span className="muted" style={CAP}>Status</span>
                <select value={list.status} disabled={!canEdit} onChange={(e) => patchList({ status: e.target.value })}>
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
            {(startedBy(list) || !lines.length) && (
              <p className="muted" style={{ margin: '0.6rem 0 0', fontSize: '0.8rem' }}>
                {startedBy(list) && <>Started by <b>{startedBy(list)}</b>{' '}</>}
                {list.created_at && `on ${fmtDate(String(list.created_at).slice(0, 10))}`}
                {/* An empty list and a missing one look the same from the
                    outside, and the difference matters when two logins share
                    the page: nothing has been added is a fact, not an absence. */}
                {!lines.length && ' · nothing added to it yet'}
              </p>
            )}
          </div>

          {/* ---- who the sheet is for, and in what words -------------------
              TRANSLATION IS FOR THE SUPPLIER, NOT THE COOK. The list stays in
              English on screen; only the sheet that leaves the boat changes.
              And the words are the BOAT'S — typed here, stored per item, kept
              for next trip. Nothing is machine-translated: half this catalogue
              is Scottish butcher vocabulary and a wrong word gets the wrong
              food delivered to a boat that is about to sail. */}
          <div className="card">
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={LBL}>
                <span className="muted" style={CAP}>Sheet for the shop</span>
                <select value={lang} disabled={!canEdit}
                        onChange={(e) => patchList({ supplier_lang: e.target.value })}>
                  {LANGS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </label>

              {lang === 'en' ? (
                <p className="muted" style={{ margin: 0, fontSize: '0.82rem', flex: '1 1 16rem' }}>
                  Landing abroad? Pick the language and the order sheet prints the shop&rsquo;s words,
                  with the English beside every one of them.
                </p>
              ) : (
                <>
                  <div>
                    <div className="muted" style={CAP}>Named in {LANGS.find((l) => l.key === lang)?.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '1.3rem', fontWeight: 700 }}>
                      {lines.length - untranslated.length}
                      <span className="muted" style={{ fontSize: '0.9rem' }}> / {lines.length}</span>
                    </div>
                  </div>
                  {untranslated.length > 0 && canEdit && (
                    <button className="secondary" onClick={() => setShowTrans((v) => !v)}>
                      {showTrans ? 'Done' : 'Name the other ' + untranslated.length}
                    </button>
                  )}
                  <p className="muted" style={{ margin: 0, fontSize: '0.78rem', flex: '1 1 14rem' }}>
                    {untranslated.length === 0
                      ? 'Every item on this list has a name the shop will read.'
                      : 'Anything with no name on file prints in English, and the sheet says which — better a word the shop queries than a silent gap.'}
                  </p>
                </>
              )}
            </div>

            {showTrans && lang !== 'en' && canEdit && (
              <div style={{ marginTop: '0.8rem', borderTop: '1px solid var(--border)', paddingTop: '0.6rem' }}>
                {/* Everything on the list, not only the gaps. A wrong word
                    already saved is the one most worth being able to fix, and
                    it would be invisible in a list of gaps. */}
                {lines.map((l) => {
                  const item = byKey.get(l.item_key)
                  const val = (lang === 'no' ? item?.no : item?.da) || ''
                  return (
                    <div key={l.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center',
                                             padding: '0.2rem 0', flexWrap: 'wrap' }}>
                      <span style={{ flex: '1 1 10rem', fontSize: '0.88rem' }}>{l.name}</span>
                      <TransBox value={val} lang={lang} onSave={(v) => setTranslation(l, v)} />
                    </div>
                  )
                })}
                <p className="muted" style={{ fontSize: '0.75rem', marginBottom: 0 }}>
                  Saved against the item, so it is there next trip and on every list this boat makes.
                </p>
              </div>
            )}
          </div>

          {/* What she usually orders, off every list this boat has kept. */}
          {canEdit && (
            <OrderedBefore hist={hist} byKey={byKey} open={showHist}
                           onToggle={() => setShowHist((v) => !v)} onAdd={addItem} />
          )}


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

            {suggestions.length > 0 && canEdit && (
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
            {canEdit && needle && !exactMatch && (
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
              {runsOfCategory(items).map(([sec, run]) => (
                <div key={sec || '_'}>
                  {sec && (
                    /* "MEALS FOR 11" — the crew count, never typed. It went 10
                       to 11 when Gundarovs joined and nobody would have
                       remembered to change it. */
                    <div style={{ ...CAP, color: 'var(--hull)', fontWeight: 700, marginTop: '0.5rem' }}>
                      {sectionLabel(sec)}
                      {sec === 'meals' && list?.meals_for ? ` for ${list.meals_for}` : ''}
                    </div>
                  )}
              {run.map((l, i) => (
                <div key={l.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap',
                                         borderTop: i ? '1px solid var(--border)' : 'none', padding: '0.35rem 0',
                                         opacity: l.got ? 0.55 : 1 }}>
                  {canEdit && (
                    <input type="checkbox" checked={l.got} title="Aboard"
                           onChange={(e) => setLine(l, { got: e.target.checked })} />
                  )}
                  <span style={{ flex: '1 1 10rem', textDecoration: l.got ? 'line-through' : 'none' }}>{l.name}</span>
                  <input value={l.note || ''} placeholder="note" disabled={!canEdit}
                         onChange={(e) => setLine(l, { note: e.target.value })}
                         style={{ flex: '1 1 8rem', maxWidth: 200, fontSize: '0.82rem' }} />
                  {canEdit && <button className="secondary" style={SM} onClick={() => bump(l, -1)}>−</button>}
                  <QtyBox line={l} disabled={!canEdit} onSet={(n) => setQty(l, n)} />
                  {canEdit && <button className="secondary" style={SM} onClick={() => bump(l, +1)}>+</button>}
                  {/* PACK SIZE. "bacon rashers 30x8" is 30 packs of 8, and the
                      same order has been written three ways across three trips.
                      A number, not a notation. Blank means the quantity is the
                      whole story, which is most lines. */}
                  {canEdit && (
                    <>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>×</span>
                      <PackBox line={l} onSet={(n) => setPack(l, n)} />
                    </>
                  )}
                  {Number(l.pack_size) > 0 && (
                    <span className="muted" style={{ fontSize: '0.75rem', minWidth: '3rem' }}>
                      = {Number(l.qty) * Number(l.pack_size)}
                    </span>
                  )}
                  {canEdit ? (
                    <select value={l.unit} onChange={(e) => setUnit(l, e.target.value)}
                            title={byKey.get(l.item_key)?.unitConfirmed
                              ? 'Unit for this item — saved for next trip'
                              : 'Unit not confirmed yet. Pick one and it sticks to this item.'}
                            style={{ fontSize: '0.78rem', padding: '0.1rem 0.2rem', width: '5.6rem',
                                     borderStyle: byKey.get(l.item_key)?.unitConfirmed ? 'solid' : 'dashed' }}>
                      {UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                    </select>
                  ) : (
                    <span className="muted" style={{ fontSize: '0.78rem', minWidth: '2rem' }}>{unitShort(l.unit)}</span>
                  )}
                  {/* Which run of the butchers order it belongs in. Only shown
                      where the category actually has runs, so no other category
                      grows a control it has no use for. */}
                  {canEdit && l.category === 'BUTCHERS' && (
                    <select value={l.section || ''} onChange={(e) => setSection(l, e.target.value)}
                            title="Where it goes on the butcher's order"
                            style={{ fontSize: '0.78rem', padding: '0.1rem 0.2rem', width: '6.2rem' }}>
                      <option value="">— unfiled —</option>
                      {SECTIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                  )}
                  {canEdit && (
                    <button className="secondary" style={{ ...SM, color: 'var(--rust)' }} title="Take off the list"
                            onClick={() => removeLine(l)}>×</button>
                  )}
                </div>
              ))}
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

/* TYPE IT OR TAP IT.
 *
 * "30x packs of softies is a lot of clicking" — and it is: thirty taps for one
 * line, on a phone, on a boat. The steppers stay because one or two more is
 * genuinely faster than selecting a field, but the number itself is an input.
 *
 * The draft is held locally so a half-typed "3" on the way to "30" is never
 * written; it commits on blur or Enter, and Escape puts it back. Committing on
 * every keystroke would save 3 first and, since 0 removes the line, typing a
 * quantity backwards over a 1 would delete the row out from under the cook. */
function QtyBox({ line, disabled, onSet }) {
  const [draft, setDraft] = useState(String(Number(line.qty)))
  useEffect(() => { setDraft(String(Number(line.qty))) }, [line.qty])

  const commit = () => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n) || n < 0) { setDraft(String(Number(line.qty))); return }
    if (n !== Number(line.qty)) onSet(n)
  }
  return (
    <input
      type="number" inputMode="numeric" min="0" step="1" disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur() }
        if (e.key === 'Escape') { setDraft(String(Number(line.qty))); e.currentTarget.blur() }
      }}
      // Select-all on focus, so typing 30 over a 4 replaces it instead of
      // making 304 — which on a stores order is a lorry rather than a box.
      onFocus={(e) => e.currentTarget.select()}
      style={{ width: '3.6rem', textAlign: 'right', fontWeight: 700, padding: '0.1rem 0.3rem',
               fontFamily: 'var(--font-mono, monospace)' }}
    />
  )
}

/* One item's word in the supplier's language.
 *
 * Held locally and committed on blur, like the quantity box — saving per
 * keystroke would write "Ka", "Kar", "Kart" against Potatoes and leave the last
 * half-typed one behind if the page were closed mid-word. */
function TransBox({ value, lang, onSave }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <input
      value={draft}
      placeholder={lang === 'no' ? 'norsk navn' : 'dansk navn'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() !== value.trim()) onSave(draft.trim()) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() }
      }}
      style={{ flex: '1 1 10rem', maxWidth: 260, fontSize: '0.85rem',
               borderStyle: value ? 'solid' : 'dashed' }}
    />
  )
}

/* How many to a pack. Same commit-on-blur as the quantity, and blank is a
 * first-class answer — most lines have no pack size and the field must not
 * push a 1 onto them. */
function PackBox({ line, onSet }) {
  const v = Number(line.pack_size) > 0 ? String(Number(line.pack_size)) : ''
  const [draft, setDraft] = useState(v)
  useEffect(() => { setDraft(v) }, [v])
  return (
    <input
      type="number" inputMode="numeric" min="0" step="1" placeholder="pack"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== v) onSet(draft) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setDraft(v); e.currentTarget.blur() }
      }}
      onFocus={(e) => e.currentTarget.select()}
      style={{ width: '3.2rem', textAlign: 'right', padding: '0.1rem 0.3rem',
               fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem',
               borderStyle: v ? 'solid' : 'dashed' }}
    />
  )
}

const LBL = { display: 'flex', flexDirection: 'column', gap: '0.15rem' }
const CAP = { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }
const SM = { padding: '0.05rem 0.45rem', fontSize: '0.9rem', lineHeight: 1.4 }
