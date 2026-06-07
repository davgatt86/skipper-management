import React, { useEffect, useMemo, useState } from 'react';
import BackNav from '../BackNav';
import { supabase } from '../supabaseClient';
import './squareup.css';
import {
  Anchor, Ship, Plus, Trash2, Users, Fuel, Truck, FileText,
  Bookmark, BookmarkPlus, Briefcase, Globe, RotateCcw, X,
} from 'lucide-react';
import { C, SHARE_OPTIONS, QUOTA_OPTS } from './constants.js';
import { uid, todayISO, shareValOf, fmtShares } from './helpers.js';
import { loadRoster, saveRoster, loadForeignRoster, saveForeignRoster, loadTrip, saveTrip } from './storage.js';
import { Section, IconBtn, MoneyInput, PercentInput, Label, selectStyle, inputStyle } from './ui.jsx';
import BondSection from './BondSection.jsx';
import { ForeignCrewRow, AddForeignMenu } from './ForeignCrewSection.jsx';
import Preview from './Preview.jsx';

// ── Crew row ───────────────────────────────────────────────────────────
function CrewRow({ c, onUpdate, onRemove, onToggleSave }) {
  const saved = !!c.rosterId;
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 11, padding: 11, marginBottom: 9 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input value={c.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder="Crewman name"
          style={{ ...inputStyle, flex: 1, fontWeight: 500 }} />
        <IconBtn onClick={onToggleSave} color={saved ? C.brass : C.dim}
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
    </div>
  );
}

// ── Add crew menu ──────────────────────────────────────────────────────
function AddCrewMenu({ roster, existingRosterIds, onPick, onNew, onRemoveFromRoster, onClose, onKitty, kittyAdded }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.brass}88`, borderRadius: 11, padding: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ flex: 1, color: C.brass, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5 }}>Add crew</span>
        <IconBtn onClick={onClose} color={C.dim} icon={X} title="Close" size={14} />
      </div>
      {roster.length > 0 ? (
        <>
          <div style={{ color: C.dim, fontSize: 11, marginBottom: 6 }}>Self-employed crew (from the Crew page) — tap to add</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
            {roster.map((r) => {
              const inTrip = existingRosterIds.includes(r.id);
              return (
                <div key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => !inTrip && onPick(r)} disabled={inTrip}
                    style={{
                      flex: 1, textAlign: 'left',
                      background: inTrip ? 'transparent' : C.panel,
                      color: inTrip ? C.dim : C.ink,
                      border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 12px',
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
        <div style={{ color: C.dim, fontSize: 13, marginBottom: 10, fontStyle: 'italic', lineHeight: 1.4 }}>
          No self-employed crew on the Crew page yet — add them there and they'll show here. Use "One-off name" for anyone else.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onKitty} disabled={kittyAdded} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          background: kittyAdded ? C.panel : C.ink, color: kittyAdded ? C.dim : C.bg,
          border: 'none', borderRadius: 9, padding: '11px 14px',
          cursor: kittyAdded ? 'default' : 'pointer', fontSize: 14, fontWeight: 700, flex: 1, minWidth: 180,
        }}>
          <Users size={15} /> {kittyAdded ? 'Kitty added' : 'Kitty (contracted crew)'}
        </button>
        <button onClick={onNew} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          background: `linear-gradient(180deg, ${C.brass}, ${C.brassDk})`, color: C.bg,
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
  const [logistics, setLogistics] = useState('');
  const [foreignCrew, setForeignCrew] = useState([]);
  const [showAddForeign, setShowAddForeign] = useState(false);
  const [bondItems, setBondItems] = useState([]);

  // Load on mount
  useEffect(() => {
    setRosterState(loadRoster());
    supabase.from('crew')
      .select('id, full_name, status, archived_at, crew_type')
      .then(({ data }) => {
        const rows = (data || []).filter(c => !c.archived_at && c.status !== 'former' && c.crew_type === 'self_employed');
        setAppCrew(rows.map(c => ({ id: 'app-' + c.id, name: c.full_name, fromApp: true })));
      });
    setForeignRosterState(loadForeignRoster());
    const t = loadTrip();
    if (t) {
      if (t.vessel !== undefined) setVessel(t.vessel);
      if (t.tripDate) setTripDate(t.tripDate);
      if (Array.isArray(t.crew)) setCrew(t.crew);
      if (t.quota !== undefined) setQuota(t.quota);
      if (Array.isArray(t.fuel)) setFuel(t.fuel);
      if (Array.isArray(t.labour)) setLabour(t.labour);
      if (t.logistics !== undefined) setLogistics(t.logistics);
      if (Array.isArray(t.foreignCrew)) setForeignCrew(t.foreignCrew);
      if (Array.isArray(t.bondItems)) setBondItems(t.bondItems);
    }
    setLoaded(true);
  }, []);

  // Debounced autosave
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      saveTrip({ vessel, tripDate, crew, quota, fuel, labour, logistics, foreignCrew, bondItems });
    }, 400);
    return () => clearTimeout(t);
  }, [vessel, tripDate, crew, quota, fuel, labour, logistics, foreignCrew, bondItems, loaded]);

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

  // ── Trip reset ───────────────────────────────────────────────────────
  const startNewTrip = () => {
    if (!window.confirm('Start a new trip? This clears the current form. Your saved crew rosters stay.')) return;
    setTripDate(todayISO()); setCrew([]); setQuota('10');
    setFuel([]); setLabour([]); setLogistics(''); setForeignCrew([]); setBondItems([]);
  };

  // ── Fuel/labour ──────────────────────────────────────────────────────
  const addFuel = () => setFuel((p) => [...p, { id: uid(), location: '', date: todayISO(), litres: '' }]);
  const updateFuel = (id, patch) => setFuel((p) => p.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFuel = (id) => setFuel((p) => p.filter((f) => f.id !== id));

  const addLabour = () => setLabour((p) => [...p, { id: uid(), name: '', boxes: '', amount: '' }]);
  const updateLabour = (id, patch) => setLabour((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLabour = (id) => setLabour((p) => p.filter((l) => l.id !== id));

  if (view === 'preview') {
    return <Preview
      vessel={vessel} tripDate={tripDate} crew={crew} totalShares={totalShares}
      quota={quota} fuel={fuel} labour={labour} logistics={logistics}
      foreignCrew={foreignCrew} bondItems={bondItems}
      onBack={() => setView('edit')}
    />;
  }

  return (
    <div className="squareup-root" style={{
      minHeight: '100vh',
      background: C.bg,
      color: 'var(--text)', fontFamily: 'inherit',
      padding: '22px 14px calc(110px + env(safe-area-inset-bottom))',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ marginBottom: 10 }}><BackNav /></div>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 12, background: `linear-gradient(145deg, ${C.brass}, ${C.brassDk})`, boxShadow: `0 6px 18px ${C.brass}44` }}>
            <Anchor size={22} color={C.bg} strokeWidth={2.5} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>Square-Up Sheet</h1>
            <p style={{ margin: '1px 0 0', color: C.dim, fontSize: 12.5 }}>Generate a PDF for the office</p>
          </div>
          <IconBtn onClick={startNewTrip} icon={RotateCcw} color={C.dim} title="Start new trip" />
        </div>

        {/* Trip info */}
        <Section icon={Ship} title="Trip">
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
            <div><Label>Vessel</Label><input value={vessel} onChange={(e) => setVessel(e.target.value)} placeholder="Boat name" style={inputStyle} /></div>
            <div><Label>Trip date</Label><input type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} style={inputStyle} /></div>
          </div>
        </Section>

        {/* Crew */}
        <Section icon={Users} title="Crew & Shares"
          count={crew.length === 0 ? null : `${crew.length} crew · ${fmtShares(totalShares)} shares`}>
          {crew.length === 0 && !showAddCrew && (
            <div style={{ color: C.dim, fontSize: 13.5, padding: '4px 0 10px', fontStyle: 'italic' }}>No crew added yet.</div>
          )}
          {crew.map((c) => (
            <CrewRow key={c.id} c={c}
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
              background: `${C.brass}1a`, border: `1px dashed ${C.brass}88`, color: C.brass,
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
            <div key={f.id} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={f.location} onChange={(e) => updateFuel(f.id, { location: e.target.value })} placeholder="Where (e.g. Egersund, Stickers)" style={{ ...inputStyle, flex: 1 }} />
                <IconBtn onClick={() => removeFuel(f.id)} title="Remove" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="date" value={f.date} onChange={(e) => updateFuel(f.id, { date: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                <div style={{ position: 'relative', width: 130 }}>
                  <input value={f.litres} onChange={(e) => updateFuel(f.id, { litres: e.target.value })} placeholder="Litres" inputMode="numeric" style={{ ...inputStyle, paddingRight: 26, textAlign: 'right' }} />
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: C.dim, fontSize: 12, pointerEvents: 'none' }}>lt</span>
                </div>
              </div>
            </div>
          ))}
          <button onClick={addFuel} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            background: `${C.sea}1a`, border: `1px dashed ${C.sea}88`, color: C.sea,
            borderRadius: 9, padding: '10px 14px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, width: '100%',
          }}>
            <Plus size={15} /> {fuel.length === 0 ? 'Add fuel entry' : 'Add another'}
          </button>
        </Section>

        {/* Logistics */}
        <Section icon={Truck} title="Logistics / Transport">
          <textarea value={logistics} onChange={(e) => setLogistics(e.target.value)} placeholder="Trucks, company, where, when..." rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4 }} />
        </Section>

        {/* Labour */}
        <Section icon={Briefcase} title="Labour" count={labour.length === 0 ? null : `${labour.length}`}>
          {labour.map((l) => (
            <div key={l.id} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={l.name} onChange={(e) => updateLabour(l.id, { name: e.target.value })} placeholder="Name (e.g. Alec Buchan, lumpers)" style={{ ...inputStyle, flex: 1 }} />
                <IconBtn onClick={() => removeLabour(l.id)} title="Remove" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={l.boxes} onChange={(e) => updateLabour(l.id, { boxes: e.target.value })} placeholder="Boxes (opt.)" inputMode="numeric" style={{ ...inputStyle, flex: 1 }} />
                <div style={{ flex: 1 }}><MoneyInput value={l.amount} onChange={(v) => updateLabour(l.id, { amount: v })} placeholder="Amount" /></div>
              </div>
            </div>
          ))}
          <button onClick={addLabour} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            background: `${C.sea}1a`, border: `1px dashed ${C.sea}88`, color: C.sea,
            borderRadius: 9, padding: '10px 14px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, width: '100%',
          }}>
            <Plus size={15} /> {labour.length === 0 ? 'Add labour entry' : 'Add another'}
          </button>
        </Section>

        {/* Foreign crew */}
        <Section icon={Globe} title="Foreign Crew Bonus" count={foreignCrew.length === 0 ? null : `${foreignCrew.length} crew`}>
          {foreignCrew.length === 0 && !showAddForeign && (
            <div style={{ color: C.dim, fontSize: 13.5, padding: '4px 0 10px', fontStyle: 'italic' }}>No foreign crew added yet.</div>
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
              background: `${C.brass}1a`, border: `1px dashed ${C.brass}88`, color: C.brass,
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
            background: `linear-gradient(180deg, ${C.brass}, ${C.brassDk})`, color: C.bg,
            border: 'none', borderRadius: 12, padding: '15px 20px', cursor: 'pointer',
            fontSize: 16, fontWeight: 700, width: '100%',
            boxShadow: `0 10px 28px ${C.brass}33`,
          }}>
            <FileText size={18} /> Preview & Generate PDF
          </button>
          <p style={{ textAlign: 'center', color: C.dim, fontSize: 11.5, marginTop: 10, letterSpacing: 0.3 }}>
            Form auto-saves · Rosters persist across trips
          </p>
        </div>
      </div>
    </div>
  );
}
