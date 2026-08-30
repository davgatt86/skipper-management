import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../AppShell';
import PageHeader from '../PageHeader';
import { supabase } from '../supabaseClient';
import './squareup.css';
import {
  Ship, Plus, Trash2, Users, Fuel, Truck, FileText,
  Bookmark, BookmarkPlus, Briefcase, Globe, X,
} from 'lucide-react';
import { SHARE_OPTIONS, QUOTA_OPTS } from './constants.js';
import { uid, todayISO, shareValOf, fmtShares, fmtMoney } from './helpers.js';
import { loadRoster, saveRoster, loadForeignRoster, saveForeignRoster, loadTrip, saveTrip } from './storage.js';
import { getWorksheetBoat, saveWorksheet, listWorksheets, loadWorksheet, deleteWorksheet, linkWorksheet, listSettlements } from '../lib/su/worksheet.js';
import { Section, IconBtn, MoneyInput, PercentInput, Label, selectStyle, inputStyle } from './ui.jsx';
import BondSection from './BondSection.jsx';
import { ForeignCrewRow, AddForeignMenu } from './ForeignCrewSection.jsx';
import { BONUS_ROLES, roleForRank, computeBonuses, resolveRates, fmtPct } from '../lib/su/bonuses.js';
import Preview from './Preview.jsx';

// ── Crew row ───────────────────────────────────────────────────────────
function CrewRow({ c, onUpdate, onRemove, onToggleSave, landings, autoPct }) {
  /* A man can hold a role on only SOME landings — "landing 1 & 2, 2 different
     engineers". Only worth asking once there is more than one landing, so the
     ordinary trip stays two taps. */
  const on = c.roleLandings && c.roleLandings.length ? c.roleLandings : null;
  const toggleLanding = (n) => {
    const all = Array.from({ length: landings }, (_, i) => i + 1);
    const cur = on || all;
    const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort();
    onUpdate({ roleLandings: next.length === landings ? [] : next });
  };
  const saved = !!c.rosterId;
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line-2)', borderRadius: 4, padding: 11, marginBottom: 9 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input value={c.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder="Crewman name"
          style={{ ...inputStyle, flex: 1, fontWeight: 500 }} />
        <IconBtn onClick={onToggleSave} color={saved ? 'var(--brass)' : 'var(--mute)'}
          icon={saved ? Bookmark : BookmarkPlus}
          title={saved ? 'In roster — tap to remove' : 'Save to roster'} />
        <IconBtn onClick={onRemove} title="Remove from trip" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <Label>Share</Label>
          <select value={c.shareKey} onChange={(e) => onUpdate({ shareKey: e.target.value })} style={selectStyle}>
            {SHARE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.display}</option>)}
          </select>
          {c.shareKey === 'custom' && (
            <input value={c.shareCustom} onChange={(e) => onUpdate({ shareCustom: e.target.value })}
              placeholder="e.g. 14/8 or 1.75" style={{ ...inputStyle, marginTop: 6 }} />
          )}
        </div>
        <div>
          <Label>Bonus %</Label>
          <PercentInput value={c.bonus} onChange={(v) => onUpdate({ bonus: v })} />
        </div>
      </div>

      {/* ROLE, AND THE BONUS FALLS OUT OF IT. David: "it would be good if can
          just select role(s) and bonuses auto select". The rate is a setting;
          picking the role fills the box, and the box is still editable because
          a trip can always be the exception. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 130 }}>
          <Label>Role bonus</Label>
          <select value={c.role || ''} style={selectStyle}
                  onChange={(e) => onUpdate({ role: e.target.value || null, roleLandings: [] })}>
            <option value="">— none —</option>
            {BONUS_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>

        {c.role && landings > 1 && (
          <div>
            <Label>Landings</Label>
            <div style={{ display: 'flex', gap: 4 }}>
              {Array.from({ length: landings }, (_, i) => i + 1).map((n) => {
                const active = !on || on.includes(n);
                return (
                  <button key={n} onClick={() => toggleLanding(n)} style={{
                    minWidth: 30, padding: '7px 0', borderRadius: 3, cursor: 'pointer',
                    border: '1px solid ' + (active ? 'var(--hull)' : 'var(--line)'),
                    background: active ? 'var(--hull)' : 'transparent',
                    color: active ? 'var(--on-navy)' : 'var(--mute)', fontWeight: 700, fontSize: 12,
                  }}>{n}</button>
                );
              })}
            </div>
          </div>
        )}

        {c.role && (
          <div style={{ color: 'var(--mute)', fontSize: 12, paddingBottom: 8 }}>
            earns <b style={{ color: 'var(--text)' }}>{fmtPct(autoPct)}</b>
            {autoPct === 0 && ' — not on any landing'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add crew menu ──────────────────────────────────────────────────────
function AddCrewMenu({ roster, existingRosterIds, onPick, onNew, onRemoveFromRoster, onClose, onKitty, kittyAdded }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--hull)', borderRadius: 4, padding: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ flex: 1, color: 'var(--hull)', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em' }}>Add crew</span>
        <IconBtn onClick={onClose} color={'var(--mute)'} icon={X} title="Close" size={14} />
      </div>
      {roster.length > 0 ? (
        <>
          <div style={{ color: 'var(--mute)', fontSize: 11, marginBottom: 6 }}>Self-employed crew (from the Crew page) — tap to add</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
            {roster.map((r) => {
              const inTrip = existingRosterIds.includes(r.id);
              return (
                <div key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => !inTrip && onPick(r)} disabled={inTrip}
                    style={{
                      flex: 1, textAlign: 'left',
                      background: inTrip ? 'transparent' : 'var(--surface)',
                      color: inTrip ? 'var(--mute)' : 'var(--text)',
                      border: '1px solid var(--line)', borderRadius: 3, padding: '10px 12px',
                      cursor: inTrip ? 'default' : 'pointer', fontSize: 14, fontWeight: 500,
                      opacity: inTrip ? 0.5 : 1,
                    }}>
                    {r.name}{inTrip ? ' · added' : ''}
                  </button>
                  {!r.fromApp && <IconBtn onClick={() => onRemoveFromRoster(r.id)} title="Remove from roster" />}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ color: 'var(--mute)', fontSize: 13, marginBottom: 10, fontStyle: 'italic', lineHeight: 1.4 }}>
          No self-employed crew on the Crew page yet — add them there and they'll show here. Use "One-off name" for anyone else.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onKitty} disabled={kittyAdded} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          background: kittyAdded ? 'var(--surface-2)' : 'var(--ink-2)', color: kittyAdded ? 'var(--mute)' : '#fff',
          border: 'none', borderRadius: 9, padding: '11px 14px',
          cursor: kittyAdded ? 'default' : 'pointer', fontSize: 14, fontWeight: 700, flex: 1, minWidth: 180,
        }}>
          <Users size={15} /> {kittyAdded ? 'Kitty added' : 'Kitty (contracted crew)'}
        </button>
        <button onClick={onNew} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          background: 'var(--hull)', color: 'var(--on-navy)',
          border: 'none', borderRadius: 9, padding: '11px 14px', cursor: 'pointer',
          fontSize: 14, fontWeight: 700, flex: 1, minWidth: 150,
        }}>
          <Plus size={15} /> One-off name
        </button>
      </div>
    </div>
  );
}

// ── Main app ───────────────────────────────────────────────────────────
export default function SquareUp() {
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('edit');
  const [roster, setRosterState] = useState([]);
  const [appCrew, setAppCrew] = useState([]);
  const [foreignRoster, setForeignRosterState] = useState([]);

  const [vessel, setVessel] = useState('Audacious BF83');
  const [tripDate, setTripDate] = useState(todayISO());
  const [crew, setCrew] = useState([]);
  const [showAddCrew, setShowAddCrew] = useState(false);
  const [quota, setQuota] = useState('10');
  const [fuel, setFuel] = useState([]);
  const [labour, setLabour] = useState([]);
  const [haulage, setHaulage] = useState([]);
  // Free text carried over from the old single Logistics box, kept verbatim
  // because it cannot be split into columns without guessing.
  const [haulageNote, setHaulageNote] = useState('');
  const [foreignCrew, setForeignCrew] = useState([]);
  const [showAddForeign, setShowAddForeign] = useState(false);
  const [bondItems, setBondItems] = useState([]);
  // The four the office asks for. The database has carried these columns and
  // saveWorksheet has always looked for them; the form never had the fields,
  // so every kept sheet went in with four nulls.
  const [tripNo, setTripNo] = useState('');
  const [market, setMarket] = useState('');
  const [daysAtSea, setDaysAtSea] = useState('');
  const [boxesLanded, setBoxesLanded] = useState('');
  /* HOW MANY TIMES SHE LANDED THIS TRIP. The role bonuses are split across the
     landings, so this is what makes "2 different engineers, 0.25% each" work.
     It cannot come from the rota — Audacious has no rota trips at all. */
  const [landings, setLandings] = useState('1');

  // Contracted crew, and what the month closeout says each is owed. The
  // monthly bonus is a CONTRACTED thing: Andrejs is self-employed and does not
  // get one, which is why crew_type is the test and not nationality.
  const [contracted, setContracted] = useState([]);
  const [monthBonus, setMonthBonus] = useState({ month: null, rows: [] });

  /* WHAT THE SALES NOTE SAYS SHE LANDED. David: "boxes for lumpers could use
     fish sales box totals, only for PD sales as denmark charge differently."
     Looked up on the trip date; Danish landings are deliberately not offered,
     because the lumpers there are not paid by the box. */
  const [landingBoxes, setLandingBoxes] = useState(null);

  // Keeping the worksheet: localStorage stays the working copy, this is the
  // deliberate save so it survives and can be reconciled later.
  const [suBoat, setSuBoat] = useState(null);
  const [worksheetId, setWorksheetId] = useState(null);
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const [saveMsg, setSaveMsg] = useState('');
  const [kept, setKept] = useState([]);
  const [keptOpen, setKeptOpen] = useState(false);
  const [loadingId, setLoadingId] = useState(null);
  // Settlements to tie a kept sheet to. Chosen, never guessed from the date.
  const [settlements, setSettlements] = useState([]);

  // Load on mount
  useEffect(() => {
    setRosterState(loadRoster());
    supabase.from('crew')
      .select('id, full_name, status, archived_at, crew_type, rank_code')
      .then(({ data }) => {
        const live = (data || []).filter(c => !c.archived_at && c.status !== 'former');
        setAppCrew(live.filter(c => c.crew_type === 'self_employed')
          .map(c => ({ id: 'app-' + c.id, name: c.full_name, fromApp: true, rank: c.rank_code })));
        setContracted(live.filter(c => c.crew_type === 'contracted')
          .map(c => ({ id: c.id, name: c.full_name })));
      });

    /* THE MONTHLY BONUS FIGURE ALREADY EXISTS. Month Closeout works it out from
       the boxes each man was aboard for; typing it again on this page is how
       two records of the same payment start to disagree. Latest month first. */
    supabase.from('month_closeouts')
      .select('month, total_paid, crew_id, closed_at')
      .order('month', { ascending: false }).limit(40)
      .then(({ data }) => {
        const rows = data || [];
        const latest = rows[0]?.month || null;
        setMonthBonus({ month: latest, rows: rows.filter(r => r.month === latest) });
      });
    setForeignRosterState(loadForeignRoster());
    // A fleet with no su_boats row cannot keep worksheets — the page stays
    // local-only and says so rather than offering a button that fails.
    getWorksheetBoat().then(setSuBoat);
    const t = loadTrip();
    if (t) {
      if (t.vessel !== undefined) setVessel(t.vessel);
      if (t.tripDate) setTripDate(t.tripDate);
      if (Array.isArray(t.crew)) setCrew(t.crew);
      if (t.quota !== undefined) setQuota(t.quota);
      if (Array.isArray(t.fuel)) setFuel(t.fuel);
      if (Array.isArray(t.labour)) setLabour(t.labour);
      if (Array.isArray(t.haulage)) setHaulage(t.haulage);
      if (t.haulageNote !== undefined) setHaulageNote(t.haulageNote);
      if (Array.isArray(t.foreignCrew)) setForeignCrew(t.foreignCrew);
      if (Array.isArray(t.bondItems)) setBondItems(t.bondItems);
      if (t.tripNo !== undefined) setTripNo(t.tripNo);
      if (t.market !== undefined) setMarket(t.market);
      if (t.daysAtSea !== undefined) setDaysAtSea(t.daysAtSea);
      if (t.boxesLanded !== undefined) setBoxesLanded(t.boxesLanded);
      if (t.landings !== undefined) setLandings(t.landings);
      /* WHICH KEPT SHEET THIS IS. Without it every save from a fresh page load
         minted a NEW worksheet, so the same trip went in again and again — the
         two rows on the fleet record are one sheet kept twice. It is validated
         against the boat's real sheets below, so an id from a deleted or
         another boat's worksheet cannot make the next save fail. */
      if (t.worksheetId) setWorksheetId(t.worksheetId);
    }
    setLoaded(true);
  }, []);

  // Debounced autosave
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      saveTrip({ vessel, tripDate, crew, quota, fuel, labour, haulage, haulageNote,
                 foreignCrew, bondItems, tripNo, market, daysAtSea, boxesLanded, landings, worksheetId });
    }, 400);
    return () => clearTimeout(t);
  }, [vessel, tripDate, crew, quota, fuel, labour, haulage, haulageNote, foreignCrew,
      bondItems, tripNo, market, daysAtSea, boxesLanded, landings, worksheetId, loaded]);


  // The kept sheets for this boat. Refreshed after every save and every delete
  // so the list is never a stale picture of the thing it is listing.
  const refreshKept = useCallback(async (boatId) => {
    if (!boatId) return;
    const rows = await listWorksheets(boatId);
    setKept(rows);
    /* THE REMEMBERED ID IS CHECKED AGAINST WHAT IS ACTUALLY THERE. A sheet
       deleted on another device would otherwise leave the form pointing at a
       row that has gone, and the next save would fail on an update matching
       nothing — hours after the thing that caused it. Forgetting it makes the
       next save a new sheet, which is the right way to be wrong. */
    setWorksheetId(id => (id && !rows.some(r => r.id === id) ? null : id));
    return rows;
  }, []);

  useEffect(() => { if (suBoat?.id) refreshKept(suBoat.id); }, [suBoat?.id, refreshKept]);
  useEffect(() => { if (suBoat?.id) listSettlements(suBoat.id).then(setSettlements); }, [suBoat?.id]);

  /* OPENING ONE REPLACES WHAT IS ON THE FORM, so it asks first — the working
   * copy is whatever you have typed since, and it only lives in localStorage.
   *
   * Two things do not come back, and saying so here is the point: the vessel
   * name was never stored, and the bond ITEMS were never stored either — only
   * each man's total, which returns as a single line against his name. */
  async function openKept(w) {
    const dirty = crew.length || fuel.length || labour.length || haulage.length
      || foreignCrew.length || bondItems.length;
    if (dirty && !window.confirm(
      'Open this kept worksheet? It replaces what is on the form now.\n\n'
      + 'The bond breakdown does not come back — each man returns with his bond '
      + 'total on one line, because only the total was ever kept.')) return;

    setLoadingId(w.id); setSaveMsg('');
    try {
      const t = await loadWorksheet(w.id);
      if (!t) { setSaveState('error'); setSaveMsg('That worksheet has gone — it may have been deleted on another device.'); return; }
      setTripDate(t.tripDate || todayISO());
      setTripNo(t.tripNo); setMarket(t.market);
      setDaysAtSea(t.daysAtSea); setBoxesLanded(t.boxesLanded); setLandings(t.landings || '1');
      setQuota(t.quota || '10');
      setCrew(t.crew); setFuel(t.fuel); setLabour(t.labour);
      setHaulage(t.haulage); setHaulageNote(t.haulageNote);
      setForeignCrew(t.foreignCrew); setBondItems(t.bondItems);
      setWorksheetId(t.worksheetId);
      setSaveState('saved');
      setSaveMsg('Opened. Keeping it again writes back to this same worksheet.');
      setKeptOpen(false);
    } catch (e) {
      setSaveState('error'); setSaveMsg(e.message || String(e));
    } finally { setLoadingId(null); }
  }

  async function removeKept(w) {
    if (!window.confirm(`Delete the worksheet of ${w.landed_date || 'no date'}? This cannot be undone.`)) return;
    try {
      await deleteWorksheet(w.id);
      // If the one on screen was the one deleted, it is a new sheet now —
      // otherwise keeping it would recreate the row we just removed.
      if (worksheetId === w.id) { setWorksheetId(null); setSaveState('idle'); }
      await refreshKept(suBoat?.id);
    } catch (e) { setSaveState('error'); setSaveMsg(e.message || String(e)); }
  }

  /* ONE WRITE PATH. `target` says which kept sheet this becomes: the one the
     form is already linked to, or an existing one being written over. */
  async function keepWorksheet(target = worksheetId, msg = 'Kept. It will be here on any device you sign in from.') {
    if (!suBoat) return;
    setSaveState('saving'); setSaveMsg('');
    try {
      const id = await saveWorksheet(
        { tripDate, quota, crew, fuel, haulage, haulageNote, labour, foreignCrew, bondItems,
          tripNo, market, daysAtSea, boxesLanded, landings },
        suBoat.id,
        target
      );
      setWorksheetId(id);
      setSaveState('saved');
      setSaveMsg(msg);
      await refreshKept(suBoat.id);
    } catch (e) {
      setSaveState('error');
      setSaveMsg(e.message || String(e));
    }
  }

  /* KEEP THE FORM OVER AN EXISTING SHEET, rather than opening that sheet over
     the form. The two are opposites and the difference is which copy you trust.
     It exists for the case the bond bug left behind: the figures are on the
     device in the working copy and NOT in the kept sheet, so opening the sheet
     would destroy the only copy of them. Writing the other way repairs it.
     It is the ordinary "same trip, I have changed something" action too. */
  async function keepOver(w) {
    const bondNow = bondItems.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const lines = [
      `Keep what is on the form now over the worksheet of ${w.landed_date || 'no date'}?`,
      '',
      /* THE DATE IS THE STRONGEST SIGNAL THESE ARE THE SAME TRIP, so it is
         stated on both sides rather than assumed. Writing one trip over
         another's sheet is the way this goes wrong. */
      `That sheet   ${w.landed_date || 'no date'} · ${w.crewCount} crew · ${fmtMoney(Number(w.bondTotal) || 0)} bond`,
      `The form     ${tripDate || 'no date'} · ${crew.length} crew · ${fmtMoney(bondNow)} bond`,
      '',
      'The kept sheet is replaced by what is on screen. This cannot be undone.',
    ];
    if (!window.confirm(lines.join('\n'))) return;
    await keepWorksheet(w.id, 'Kept over that sheet. Its figures now match the form.');
    setKeptOpen(false);
  }

  const persistRoster = (next) => {
    setRosterState(next);
    saveRoster(next);
  };
  const persistForeignRoster = (next) => {
    setForeignRosterState(next);
    saveForeignRoster(next);
  };

  const totalShares = useMemo(() => crew.reduce((s, c) => s + shareValOf(c), 0), [crew]);

  // ── Crew ops ─────────────────────────────────────────────────────────
  const addFromRoster = (m) => {
    setCrew((prev) => [...prev, {
      id: uid(), rosterId: m.id, name: m.name,
      shareKey: m.defaultShareKey || 'full',
      shareCustom: m.defaultShareCustom || '',
      bonus: m.defaultBonus || '',
    }]);
    setShowAddCrew(false);
  };

  // One row standing in for all the contracted (agency) crew — their
  // combined share comes off the top as the "kitty".
  const addKitty = () => {
    setCrew((prev) => [...prev, {
      id: uid(), rosterId: null, name: 'Kitty (contracted crew)',
      shareKey: 'full', shareCustom: '', bonus: '',
    }]);
    setShowAddCrew(false);
  };

  const addNew = () => {
    setCrew((prev) => [...prev, {
      id: uid(), rosterId: null, name: '',
      shareKey: 'full', shareCustom: '', bonus: '',
    }]);
    setShowAddCrew(false);
  };

  const updateCrew = (id, patch) => setCrew((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeCrew = (id) => {
    setCrew((prev) => prev.filter((c) => c.id !== id));
    setBondItems((prev) => prev.map((b) => (b.assignedTo === id ? { ...b, assignedTo: null } : b)));
  };

  const toggleSaveRoster = (c) => {
    if (c.rosterId) {
      persistRoster(roster.filter((r) => r.id !== c.rosterId));
      updateCrew(c.id, { rosterId: null });
    } else {
      if (!c.name?.trim()) return;
      const existing = roster.find((r) => r.name.toLowerCase() === c.name.trim().toLowerCase());
      if (existing) {
        updateCrew(c.id, { rosterId: existing.id });
        return;
      }
      const newId = uid();
      persistRoster([...roster, {
        id: newId, name: c.name.trim(),
        defaultShareKey: c.shareKey,
        defaultShareCustom: c.shareCustom,
        defaultBonus: c.bonus,
      }]);
      updateCrew(c.id, { rosterId: newId });
    }
  };

  const removeFromRoster = (rosterId) => {
    persistRoster(roster.filter((r) => r.id !== rosterId));
    setCrew((prev) => prev.map((c) => (c.rosterId === rosterId ? { ...c, rosterId: null } : c)));
  };

  // ── Foreign crew ops ─────────────────────────────────────────────────
  const addForeignFromRoster = (m) => {
    setForeignCrew((prev) => [...prev, {
      id: uid(), rosterId: m.id, name: m.name, bonus: m.defaultBonus || '',
    }]);
    setShowAddForeign(false);
  };

  const addNewForeign = () => {
    setForeignCrew((prev) => [...prev, { id: uid(), rosterId: null, name: '', bonus: '' }]);
    setShowAddForeign(false);
  };

  const updateForeign = (id, patch) =>
    setForeignCrew((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeForeign = (id) => setForeignCrew((prev) => prev.filter((c) => c.id !== id));

  const toggleSaveForeignRoster = (c) => {
    if (c.rosterId) {
      persistForeignRoster(foreignRoster.filter((r) => r.id !== c.rosterId));
      updateForeign(c.id, { rosterId: null });
    } else {
      if (!c.name?.trim()) return;
      const existing = foreignRoster.find((r) => r.name.toLowerCase() === c.name.trim().toLowerCase());
      if (existing) {
        updateForeign(c.id, { rosterId: existing.id });
        return;
      }
      const newId = uid();
      persistForeignRoster([...foreignRoster, {
        id: newId, name: c.name.trim(), defaultBonus: c.bonus,
      }]);
      updateForeign(c.id, { rosterId: newId });
    }
  };

  const removeFromForeignRoster = (rosterId) => {
    persistForeignRoster(foreignRoster.filter((r) => r.id !== rosterId));
    setForeignCrew((prev) => prev.map((c) => (c.rosterId === rosterId ? { ...c, rosterId: null } : c)));
  };

  /* THE ROLE BONUSES. A role's rate is split across the landings, and each
     landing's share among the men who held it — which is what makes "2 mates
     landing 1 and 1 mate landing 2" come out 0.0625/0.0625/0.125. The maths is
     in src/lib/su/bonuses.js and tested against David's own worked examples. */
  const nLandings = Math.max(1, Number(landings) || 1);
  const bonusPlan = useMemo(() => computeBonuses(
    crew.filter((c) => c.role).map((c) => ({
      id: c.id, name: c.name, role: c.role, landings: c.roleLandings,
    })),
    nLandings,
    resolveRates(null),
  ), [crew, nLandings]);
  const pctFor = (id) => bonusPlan.rows.find((r) => r.id === id)?.pct || 0;

  /* Picking a role fills the bonus box. Done here rather than in the row so it
     sees the WHOLE crew — a second engineer joining halves the first one's
     share, and his box has to change with it. */
  useEffect(() => {
    setCrew((prev) => {
      let touched = false;
      const next = prev.map((c) => {
        if (!c.role) return c;
        const want = String(pctFor(c.id));
        if (c.bonus === want) return c;
        touched = true;
        return { ...c, bonus: want };
      });
      return touched ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bonusPlan]);

  /* The landing for this trip date, if there is one. Peterhead only: the market
     is on the landing itself, so this cannot be fooled by a trip typed as
     "Peterhead" that actually sold in Denmark. */
  useEffect(() => {
    if (!tripDate) { setLandingBoxes(null); return; }
    let cancel = false;
    supabase.from('sales_landings')
      .select('boxes, market, vessel, landing_date')
      .eq('landing_date', tripDate)
      .then(({ data }) => {
        if (cancel) return;
        /* PETERHEAD ONLY, and the market string is the test. Matching
           "Don Fishing" would have swept in Ullapool, Scrabster and
           Kinlochbervie — the boat's agent sells at all of them and the lumpers
           there are not on the Peterhead rate. Denmark was the case David
           named; those three were the ones the loose match would have got
           wrong. A bare "Don Fishing" with no port is not offered either:
           better no figure than a wrong one. */
        const pd = (data || []).filter((l) => /peterhead/i.test(l.market || ''));
        if (!pd.length) { setLandingBoxes(null); return; }
        // More than one note the same day is one trip landing twice — sum them.
        setLandingBoxes({
          boxes: pd.reduce((s, l) => s + Number(l.boxes || 0), 0),
          notes: pd.length,
          market: pd[0].market,
        });
      });
    return () => { cancel = true; };
  }, [tripDate]);

  /* THE MONTHLY BONUS IS ALREADY WORKED OUT. Month Closeout computes it from
     the boxes each man was aboard for; typing it again here is how two records
     of the same payment start to disagree — the reason this link was asked for.
     Per man, not one figure: Christopher Catam came out £543.67 against the
     others' £1,153.40 because he was on part of the month. */
  const monthPull = useMemo(() => {
    const byId = new Map(contracted.map((c) => [c.id, c.name]));
    return monthBonus.rows
      .filter((r) => byId.has(r.crew_id) && Number(r.total_paid) > 0)
      .map((r) => ({
        crewId: r.crew_id,
        name: byId.get(r.crew_id),
        amount: Number(r.total_paid),
        closed: !!r.closed_at,
      }));
  }, [contracted, monthBonus]);

  const takeMonthBonuses = () => {
    if (!monthPull.length) return;
    setForeignCrew((prev) => {
      const next = [...prev];
      for (const m of monthPull) {
        const at = next.findIndex((c) => (c.name || '').toLowerCase() === m.name.toLowerCase());
        // Update in place rather than adding a second row for the same man.
        if (at >= 0) next[at] = { ...next[at], name: m.name, bonus: String(m.amount) };
        else next.push({ id: uid(), rosterId: null, name: m.name, bonus: String(m.amount) });
      }
      return next;
    });
  };

  const monthLabel = monthBonus.month
    ? new Date(monthBonus.month + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null;

  // ── Trip reset ───────────────────────────────────────────────────────
  /* THE CREW STAY. David, Aug 2026: "99% of all trips are same crew with
   * slight changes to bonus %'s". Clearing them meant rebuilding the same
   * fourteen men every trip to change one figure, which is how a form stops
   * getting filled in properly.
   *
   * So a new trip keeps WHO WAS ABOARD and what they are on — names, share
   * keys, roles — and clears everything that belongs to the trip itself: the
   * fuel, the boxes, the dates, the bond, the haulage. The bonuses carry over
   * too, because a slight change is easier to make than a figure to re-enter.
   *
   * The bond is deliberately NOT kept. It is bought for a trip and carrying it
   * would charge a man twice for the same baccy. */
  const startNewTrip = () => {
    if (!window.confirm(
      'Start a new trip?\n\n'
      + 'The crew stay as they are — names, shares, roles and bonuses. '
      + 'The fuel, boxes, dates, bond and haulage are cleared.')) return;
    setTripDate(todayISO()); setQuota('10');
    setFuel([]); setLabour([]); setHaulage([]); setHaulageNote(''); setBondItems([]);
    setTripNo(''); setMarket(''); setDaysAtSea(''); setBoxesLanded('');
    /* AND IT LETS GO OF THE KEPT SHEET. `worksheetId` is what `keepWorksheet`
     * updates in place, so a new trip that held on to it would write this
     * trip's figures over the worksheet you opened — silently, and only
     * noticed when you went looking for the old one. Reachable the moment
     * opening a kept sheet became possible. */
    setWorksheetId(null); setSaveState('idle'); setSaveMsg('');
  };

  // ── Fuel/labour ──────────────────────────────────────────────────────
  const addFuel = () => setFuel((p) => [...p, { id: uid(), location: '', date: todayISO(), litres: '' }]);
  const updateFuel = (id, patch) => setFuel((p) => p.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFuel = (id) => setFuel((p) => p.filter((f) => f.id !== id));

  // basis 'box' -> cost is boxes x rate; basis 'flat' -> the rate IS the cost.
  const addLabour = () => setLabour((p) => [...p, { id: uid(), name: '', basis: 'box', boxes: '', rate: '', amount: '' }]);
  const updateLabour = (id, patch) => setLabour((p) => p.map((l) => {
    if (l.id !== id) return l;
    const next = { ...l, ...patch };
    const n = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
    next.amount = next.basis === 'box' ? n(next.boxes) * n(next.rate) : n(next.rate);
    return next;
  }));
  const removeLabour = (id) => setLabour((p) => p.filter((l) => l.id !== id));

  // Haulage: who carted, from where, how many loads. No money — the office
  // prices it, same as fuel.
  const addHaulage = () => setHaulage((p) => [...p, { id: uid(), haulier: '', from: '', loads: '', note: '' }]);
  const updateHaulage = (id, patch) => setHaulage((p) => p.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  const removeHaulage = (id) => setHaulage((p) => p.filter((h) => h.id !== id));

  if (view === 'preview') {
    return <Preview
      vessel={vessel} tripDate={tripDate} crew={crew} totalShares={totalShares}
      quota={quota} fuel={fuel} labour={labour} haulage={haulage} haulageNote={haulageNote}
      foreignCrew={foreignCrew} bondItems={bondItems}
      landings={nLandings} bonusPlan={bonusPlan}
      onBack={() => setView('edit')}
    />;
  }

  return (
    <AppShell maxWidth={760}>
      <PageHeader
        eyebrow="Worksheet → office"
        title="Square Up"
        sub="What the office needs to settle the trip"
      >
        <button className="secondary" onClick={startNewTrip}>Start new trip</button>
      </PageHeader>

      <div className="flowbar">
        <span className="flow is-now">1 · You fill this in</span>
        <span className="flow-ar">→</span>
        <span className="flow">2 · Office settles</span>
        <span className="flow-ar">→</span>
        <span className="flow">3 · Settlement comes back</span>
      </div>

      <div className="squareup-root" style={{ color: 'var(--text)', fontFamily: 'inherit', paddingBottom: 'calc(40px + env(safe-area-inset-bottom))' }}>
        {/* Trip info */}
        <Section icon={Ship} title="Trip">
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
            <div><Label>Vessel</Label><input value={vessel} onChange={(e) => setVessel(e.target.value)} placeholder="Boat name" style={inputStyle} /></div>
            <div><Label>Trip date</Label><input type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} style={inputStyle} /></div>
          </div>
          {/* THE FOUR THE OFFICE ASKS FOR.
              `su_worksheets` has carried trip_no, market, days_at_sea and
              boxes_landed since it was built, and `saveWorksheet` has always
              destructured them out of its state — but the form had no such
              fields, so every saved sheet went in with four nulls. The columns
              were waiting for inputs that were never made. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginTop: 10 }}>
            <div><Label>Trip no.</Label><input value={tripNo} onChange={(e) => setTripNo(e.target.value)} placeholder="optional" style={inputStyle} /></div>
            <div><Label>Market</Label><input value={market} onChange={(e) => setMarket(e.target.value)} placeholder="Peterhead, Scrabster, Hanstholm…" style={inputStyle} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <div><Label>Days at sea</Label><input value={daysAtSea} onChange={(e) => setDaysAtSea(e.target.value)} inputMode="decimal" placeholder="e.g. 6.75" style={inputStyle} /></div>
            <div><Label>Boxes landed</Label><input value={boxesLanded} onChange={(e) => setBoxesLanded(e.target.value)} inputMode="numeric" placeholder="e.g. 1192" style={inputStyle} /></div>
            {/* The role bonuses divide by this. Usually two. */}
            <div><Label>Landings</Label><input value={landings} onChange={(e) => setLandings(e.target.value)} inputMode="numeric" placeholder="2" style={inputStyle} /></div>
          </div>
        </Section>

        {/* Crew */}
        <Section icon={Users} title="Crew & Shares"
          count={crew.length === 0 ? null : `${crew.length} crew · ${fmtShares(totalShares)} shares`}>
          {crew.length === 0 && !showAddCrew && (
            <div style={{ color: 'var(--mute)', fontSize: 13.5, padding: '4px 0 10px', fontStyle: 'italic' }}>No crew added yet.</div>
          )}
          {crew.map((c) => (
            <CrewRow key={c.id} c={c} landings={nLandings} autoPct={pctFor(c.id)}
              onUpdate={(p) => updateCrew(c.id, p)}
              onRemove={() => removeCrew(c.id)}
              onToggleSave={() => toggleSaveRoster(c)} />
          ))}
          {showAddCrew ? (
            <AddCrewMenu
              roster={[
                ...appCrew,
                ...roster.filter(r => !appCrew.some(a => a.name.toLowerCase() === (r.name || '').toLowerCase())),
              ]}
              kittyAdded={crew.some(c => (c.name || '').toLowerCase().startsWith('kitty'))}
              onKitty={addKitty}
              existingRosterIds={crew.map((c) => c.rosterId).filter(Boolean)}
              onPick={addFromRoster} onNew={addNew}
              onRemoveFromRoster={removeFromRoster}
              onClose={() => setShowAddCrew(false)} />
          ) : (
            <button onClick={() => setShowAddCrew(true)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'transparent', border: '1px dashed var(--line)', color: 'var(--hull)',
              borderRadius: 10, padding: '12px 16px', cursor: 'pointer',
              fontSize: 14, fontWeight: 600, width: '100%', marginTop: crew.length ? 8 : 0,
            }}>
              <Plus size={16} /> Add crewman
            </button>
          )}
        </Section>

        {/* Bond */}
        <BondSection crew={crew} bondItems={bondItems} setBondItems={setBondItems} />

        {/* Quota */}
        <Section icon={Briefcase} title="Quota Recovery">
          <select value={quota} onChange={(e) => setQuota(e.target.value)} style={selectStyle}>
            {QUOTA_OPTS.map((q) => <option key={q} value={q}>{q}%</option>)}
          </select>
        </Section>

        {/* Fuel */}
        <Section icon={Fuel} title="Fuel" count={fuel.length === 0 ? null : `${fuel.length}`}>
          {fuel.map((f) => (
            <div key={f.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--line-2)', borderRadius: 4, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={f.location} onChange={(e) => updateFuel(f.id, { location: e.target.value })} placeholder="Where (e.g. Egersund, Stickers)" style={{ ...inputStyle, flex: 1 }} />
                <IconBtn onClick={() => removeFuel(f.id)} title="Remove" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="date" value={f.date} onChange={(e) => updateFuel(f.id, { date: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                <div style={{ position: 'relative', width: 130 }}>
                  <input value={f.litres} onChange={(e) => updateFuel(f.id, { litres: e.target.value })} placeholder="Litres" inputMode="numeric" style={{ ...inputStyle, paddingRight: 26, textAlign: 'right' }} />
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mute)', fontSize: 12, pointerEvents: 'none' }}>lt</span>
                </div>
              </div>
            </div>
          ))}
          <button onClick={addFuel} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            background: 'transparent', border: '1px dashed var(--line)', color: 'var(--hull)',
            borderRadius: 9, padding: '10px 14px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, width: '100%',
          }}>
            <Plus size={15} /> {fuel.length === 0 ? 'Add fuel entry' : 'Add another'}
          </button>
        </Section>

        {/* Trucks & haulage — who carted and how many loads. No money: the
            office prices it, same as fuel. */}
        <Section icon={Truck} title="Trucks & Haulage" count={haulage.length === 0 ? null : `${haulage.reduce((s, h) => s + (Number(h.loads) || 0), 0)} loads`}>
          {haulageNote?.trim() && (
            <div style={{ background: 'var(--surface-2)', borderLeft: '3px solid var(--brass)', border: '1px solid var(--line)', borderRadius: 4, padding: 10, marginBottom: 10 }}>
              <div style={{ color: 'var(--brass)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 5 }}>
                Carried over from Logistics
              </div>
              <textarea value={haulageNote} onChange={(e) => setHaulageNote(e.target.value)} rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4 }} />
              <div style={{ color: 'var(--mute)', fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
                This was one free-text box before. Split it into rows below when you get a
                chance, then clear this — it still goes on the sheet either way.
              </div>
            </div>
          )}
          {haulage.map((h) => (
            <div key={h.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--line-2)', borderRadius: 4, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={h.haulier} onChange={(e) => updateHaulage(h.id, { haulier: e.target.value })} placeholder="Haulier (e.g. Grampian)" style={{ ...inputStyle, flex: 1 }} />
                <IconBtn onClick={() => removeHaulage(h.id)} title="Remove" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={h.from} onChange={(e) => updateHaulage(h.id, { from: e.target.value })} placeholder="From (e.g. Peterhead)" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                <input value={h.loads} onChange={(e) => updateHaulage(h.id, { loads: e.target.value })} placeholder="Loads" inputMode="numeric" style={{ ...inputStyle, width: 90, textAlign: 'right' }} />
              </div>
            </div>
          ))}
          <button onClick={addHaulage} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            background: 'transparent', border: '1px dashed var(--line)', color: 'var(--hull)',
            borderRadius: 9, padding: '10px 14px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, width: '100%',
          }}>
            <Plus size={15} /> {haulage.length === 0 ? 'Add haulier' : 'Add another'}
          </button>
        </Section>

        {/* Labour — paid per box or at a flat rate. */}
        <Section icon={Briefcase} title="Labour" count={labour.length === 0 ? null : `${labour.length}`}>
          {labour.map((l) => (
            <div key={l.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--line-2)', borderRadius: 4, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={l.name} onChange={(e) => updateLabour(l.id, { name: e.target.value })} placeholder="Name (e.g. Alec Buchan, lumpers)" style={{ ...inputStyle, flex: 1 }} />
                <IconBtn onClick={() => removeLabour(l.id)} title="Remove" />
              </div>
              {/* THE NOTE ALREADY KNOWS THE BOXES. Offered rather than filled
                  in: a lumper is not always paid on every box landed, and
                  overwriting what he typed would be worse than a button. */}
              {(l.basis || 'box') === 'box' && landingBoxes && String(l.boxes) !== String(landingBoxes.boxes) && (
                <button onClick={() => updateLabour(l.id, { boxes: String(landingBoxes.boxes) })}
                        style={{
                          background: 'transparent', border: '1px solid var(--hull)', color: 'var(--hull)',
                          borderRadius: 3, padding: '5px 9px', cursor: 'pointer', fontSize: 12, marginBottom: 8,
                        }}>
                  Use {Number(landingBoxes.boxes).toLocaleString('en-GB')} boxes from the sales note
                  {landingBoxes.notes > 1 ? ` (${landingBoxes.notes} notes)` : ''}
                </button>
              )}
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={l.basis || 'box'} onChange={(e) => updateLabour(l.id, { basis: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 0 }}>
                  <option value="box">£ per box</option>
                  <option value="flat">Flat rate</option>
                </select>
                <input
                  value={l.boxes}
                  onChange={(e) => updateLabour(l.id, { boxes: e.target.value })}
                  placeholder="Boxes"
                  inputMode="numeric"
                  disabled={(l.basis || 'box') === 'flat'}
                  style={{ ...inputStyle, width: 100, textAlign: 'right', opacity: (l.basis || 'box') === 'flat' ? 0.4 : 1 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <MoneyInput value={l.rate} onChange={(v) => updateLabour(l.id, { rate: v })} placeholder={(l.basis || 'box') === 'box' ? 'Rate per box' : 'Amount'} />
                </div>
                <div style={{ flex: 1, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>
                  {fmtMoney(l.amount || 0)}
                </div>
              </div>
            </div>
          ))}
          <button onClick={addLabour} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            background: 'transparent', border: '1px dashed var(--line)', color: 'var(--hull)',
            borderRadius: 9, padding: '10px 14px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, width: '100%',
          }}>
            <Plus size={15} /> {labour.length === 0 ? 'Add labour entry' : 'Add another'}
          </button>
        </Section>

        {/* Foreign crew */}
        <Section icon={Globe} title="Foreign Crew Bonus" count={foreignCrew.length === 0 ? null : `${foreignCrew.length} crew`}>
          {/* TAKE IT FROM MONTH CLOSEOUT rather than typing it. Only the
              CONTRACTED crew get a monthly bonus — Andrejs is self-employed and
              does not, which is why crew_type is the test and not nationality.
              A closed month is the one to trust: it is the figure that was
              actually settled. */}
          {monthPull.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <button onClick={takeMonthBonuses} style={{
                background: 'var(--hull)', color: 'var(--on-navy)', border: 'none',
                borderRadius: 9, padding: '10px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 14,
              }}>
                Take {monthLabel}'s bonuses ({monthPull.length} crew)
              </button>
              <div style={{ color: 'var(--mute)', fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
                {monthPull.map((m) => `${m.name} ${fmtMoney(m.amount)}`).join(' · ')}
                {monthPull.every((m) => m.closed)
                  ? ' — from the closed month, so these are the settled figures.'
                  : ' — that month is not closed yet, so these can still move.'}
              </div>
            </div>
          )}
          {foreignCrew.length === 0 && !showAddForeign && monthPull.length === 0 && (
            <div style={{ color: 'var(--mute)', fontSize: 13.5, padding: '4px 0 10px', fontStyle: 'italic' }}>No foreign crew added yet.</div>
          )}
          {foreignCrew.map((c) => (
            <ForeignCrewRow key={c.id} c={c}
              onUpdate={(p) => updateForeign(c.id, p)}
              onRemove={() => removeForeign(c.id)}
              onToggleSave={() => toggleSaveForeignRoster(c)} />
          ))}
          {showAddForeign ? (
            <AddForeignMenu roster={foreignRoster}
              existingRosterIds={foreignCrew.map((c) => c.rosterId).filter(Boolean)}
              onPick={addForeignFromRoster} onNew={addNewForeign}
              onRemoveFromRoster={removeFromForeignRoster}
              onClose={() => setShowAddForeign(false)} />
          ) : (
            <button onClick={() => setShowAddForeign(true)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'transparent', border: '1px dashed var(--line)', color: 'var(--hull)',
              borderRadius: 10, padding: '12px 16px', cursor: 'pointer',
              fontSize: 14, fontWeight: 600, width: '100%', marginTop: foreignCrew.length ? 8 : 0,
            }}>
              <Plus size={16} /> Add foreign crewman
            </button>
          )}
        </Section>

        {/* Generate */}
        <div style={{ marginTop: 18 }}>
          <button onClick={() => setView('preview')} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            background: 'var(--hull)', color: 'var(--on-navy)',
            border: 'none', borderRadius: 12, padding: '15px 20px', cursor: 'pointer',
            fontSize: 16, fontWeight: 700, width: '100%',
            
          }}>
            <FileText size={18} /> Preview & Generate PDF
          </button>
          {suBoat ? (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="secondary" onClick={keepWorksheet} disabled={saveState === 'saving'}>
                {saveState === 'saving' ? 'Keeping…' : worksheetId ? 'Update kept worksheet' : 'Keep this worksheet'}
              </button>
              {kept.length > 0 && (
                <button className="secondary" onClick={() => setKeptOpen(o => !o)}>
                  {keptOpen ? 'Hide kept worksheets' : `Kept worksheets (${kept.length})`}
                </button>
              )}
              {saveMsg && (
                <span className={saveState === 'error' ? 'error' : 'muted'} style={{ fontSize: '0.82rem' }}>
                  {saveMsg}
                </span>
              )}
            </div>
          ) : (
            <p className="note" style={{ marginTop: 12 }}>
              Kept on this device only — settlements are not set up for your boat yet,
              so there is nowhere on the fleet record to store it.
            </p>
          )}

          {/* THE KEPT SHEETS. Saving was built first and nothing ever opened one
              again, so a worksheet went into the database and stayed there while
              the working copy lived in localStorage — gone on a new device or a
              cleared browser, though it was sitting in the table all along. */}
          {suBoat && keptOpen && kept.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '0.82rem' }}>
                Kept on the fleet record, so they are here on any device you sign in from.
                <b>Open</b> replaces the form with the kept sheet; <b>Keep over</b> replaces the
                kept sheet with the form. A sheet marked <i>no bond recorded</i> was saved before
                the bond was keyed correctly — if that trip is still on the form, Keep over it and
                the figures go in right.
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {kept.map(w => (
                  <li key={w.id} style={{
                    display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
                    padding: '0.5rem 0', borderTop: '1px solid var(--line)',
                  }}>
                    <span style={{ fontFamily: 'var(--mono, monospace)', minWidth: '6rem' }}>
                      {w.landed_date || 'no date'}
                    </span>
                    <span style={{ flex: '1 1 8rem', fontSize: '0.88rem' }}>
                      {[w.trip_no && `Trip ${w.trip_no}`, w.market,
                        w.boxes_landed && `${Number(w.boxes_landed).toLocaleString('en-GB')} bx`,
                        w.days_at_sea && `${w.days_at_sea} days`]
                        .filter(Boolean).join(' · ') || <span className="muted">no trip details</span>}
                    </span>
                    <span className="muted" style={{ fontSize: '0.78rem' }}>
                      {w.crewCount} crew
                    </span>
                    {/* NO BOND RECORDED is not the same as a bond of nought, and
                        must not read like it. Every sheet kept before Aug 2026
                        has this: the save totalled bond on the crewman's NAME
                        while it is assigned by his ID, so it matched nothing and
                        wrote zero for every man. */}
                    {w.crewCount > 0 && !Number(w.bondTotal) && (
                      <span title="The bond was keyed wrongly on save until Aug 2026, so it went in as nought for every man. If this trip is still on the form, Keep over it to put the figures right."
                            style={{
                              fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 3,
                              background: 'var(--brass)', color: '#fff', whiteSpace: 'nowrap',
                            }}>no bond recorded</span>
                    )}
                    {w.id === worksheetId && (
                      <span style={{
                        fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 3,
                        background: 'var(--kelp)', color: '#fff',
                      }}>on screen</span>
                    )}
                    <button className="secondary" onClick={() => openKept(w)} disabled={loadingId === w.id}>
                      {loadingId === w.id ? 'Opening…' : 'Open'}
                    </button>
                    <button className="secondary" onClick={() => keepOver(w)}
                            title="Write what is on the form now over this kept sheet">Keep over</button>
                    {/* WHICH SETTLING THIS SHEET BECAME. Chosen, not matched on
                         the date: a settlement covers a RUN of trips and the
                         office does not say which, which is why inferring it is
                         the hardest code in this repo. Here he knows. */}
                    {settlements.length > 0 && (
                      <select value={w.settlement_id || ''} title="Which settling sheet this trip ended up on"
                              onChange={async (e) => {
                                await linkWorksheet(w.id, e.target.value || null)
                                await refreshKept(suBoat?.id)
                              }}
                              style={{ fontSize: '0.78rem', maxWidth: '11rem' }}>
                        <option value="">not on a settling yet</option>
                        {settlements.map((s) => (
                          <option key={s.id} value={s.id}>{s.settling_date} · {s.reference}</option>
                        ))}
                      </select>
                    )}
                    <button className="secondary" onClick={() => removeKept(w)}
                            style={{ color: 'var(--rust)' }}>Delete</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p style={{ textAlign: 'center', color: 'var(--mute)', fontSize: 11.5, marginTop: 10, letterSpacing: 0.3 }}>
            Form auto-saves on this device · Rosters persist across trips
          </p>
        </div>
      </div>
    </AppShell>
  );
}
