import React from 'react';
import { Plus, X, Bookmark, BookmarkPlus } from 'lucide-react';
import { C } from './constants.js';
import { IconBtn, MoneyInput, inputStyle } from './ui.jsx';

export function ForeignCrewRow({ c, onUpdate, onRemove, onToggleSave }) {
  const saved = !!c.rosterId;
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 11, padding: 11, marginBottom: 9 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input value={c.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder="Name (e.g. Lorenzo)"
          style={{ ...inputStyle, flex: 1, fontWeight: 500 }} />
        <IconBtn onClick={onToggleSave} color={saved ? C.brass : C.dim}
          icon={saved ? Bookmark : BookmarkPlus}
          title={saved ? 'In roster — tap to remove' : 'Save to roster'} />
        <IconBtn onClick={onRemove} title="Remove from trip" />
      </div>
      <MoneyInput value={c.bonus} onChange={(v) => onUpdate({ bonus: v })} placeholder="Monthly bonus" />
    </div>
  );
}

export function AddForeignMenu({ roster, existingRosterIds, onPick, onNew, onRemoveFromRoster, onClose }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.brass}88`, borderRadius: 11, padding: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ flex: 1, color: C.brass, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5 }}>Add foreign crew</span>
        <IconBtn onClick={onClose} color={C.dim} icon={X} title="Close" size={14} />
      </div>
      {roster.length > 0 ? (
        <>
          <div style={{ color: C.dim, fontSize: 11, marginBottom: 6 }}>From your roster — tap to add</div>
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
                  <IconBtn onClick={() => onRemoveFromRoster(r.id)} title="Remove from roster" />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ color: C.dim, fontSize: 13, marginBottom: 10, fontStyle: 'italic', lineHeight: 1.4 }}>
          No foreign crew saved yet. Add a name below and tap the bookmark icon to save them for next time.
        </div>
      )}
      <button onClick={onNew} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        background: `linear-gradient(180deg, ${C.brass}, ${C.brassDk})`, color: C.bg,
        border: 'none', borderRadius: 9, padding: '11px 14px', cursor: 'pointer',
        fontSize: 14, fontWeight: 700, width: '100%',
      }}>
        <Plus size={15} /> New foreign crewman
      </button>
    </div>
  );
}
