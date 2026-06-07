import React, { useRef, useState } from 'react';
import { Upload, Plus, Trash2, FileText, AlertCircle, Loader2, Scissors } from 'lucide-react';
import { C } from './constants.js';
import { Section, IconBtn, inputStyle, selectStyle, MoneyInput, Label } from './ui.jsx';
import { uid, fmtMoney, sumBondFor } from './helpers.js';
import { parseBondInvoice } from './invoiceParser.js';

export default function BondSection({ crew, bondItems, setBondItems }) {
  const fileInput = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError('');
    setParsing(true);
    try {
      const newItems = [];
      for (const file of files) {
        const { lineItems, meta } = await parseBondInvoice(file);
        const vendor = meta.vendor || file.name.replace(/\.pdf$/i, '');
        const source = meta.invoiceNumber ? `${vendor} · ${meta.invoiceNumber}` : vendor;
        for (const li of lineItems) {
          newItems.push({
            id: uid(),
            description: li.description,
            qty: li.qty,
            unitPrice: li.unitPrice,
            amount: li.total,
            assignedTo: null,
            source,
          });
        }
      }
      if (newItems.length === 0) {
        setError('No line items found in that PDF. Check the format or add items manually.');
      } else {
        setBondItems((prev) => [...prev, ...newItems]);
      }
    } catch (err) {
      console.error(err);
      setError('Could not parse that PDF: ' + (err.message || 'unknown error'));
    } finally {
      setParsing(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const addManual = () => {
    setBondItems((prev) => [...prev, {
      id: uid(), description: '', qty: 1, unitPrice: 0, amount: 0,
      assignedTo: null, source: null,
    }]);
  };

  const update = (id, patch) =>
    setBondItems((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const remove = (id) =>
    setBondItems((prev) => prev.filter((b) => b.id !== id));

  // Split an invoice item: takes N off the item, creates a new sibling row with N qty
  // remaining qty stays with the original (and keeps its assignedTo), new row starts unassigned.
  const split = (id, n) => {
    setBondItems((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx === -1) return prev;
      const item = prev[idx];
      if (n < 1 || n >= item.qty) return prev;
      const remaining = item.qty - n;
      const unitPrice = item.unitPrice || (item.qty > 0 ? item.amount / item.qty : 0);
      // Round each to 2 dp; nudge the original to absorb any rounding difference so the sum stays identical.
      const newAmount = Math.round(unitPrice * n * 100) / 100;
      const remAmount = Math.round((item.amount - newAmount) * 100) / 100;
      const updated = { ...item, qty: remaining, amount: remAmount };
      const newItem = { ...item, id: uid(), qty: n, amount: newAmount, assignedTo: null };
      const next = [...prev];
      next[idx] = updated;
      next.splice(idx + 1, 0, newItem);
      return next;
    });
  };

  const clearAll = () => {
    if (!bondItems.length) return;
    if (window.confirm(`Remove all ${bondItems.length} bond items?`)) setBondItems([]);
  };

  // Group items by source for display
  const groups = {};
  for (const item of bondItems) {
    const key = item.source || '__manual__';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  const groupKeys = Object.keys(groups).sort((a, b) => {
    if (a === '__manual__') return 1;
    if (b === '__manual__') return -1;
    return a.localeCompare(b);
  });

  // Totals
  const totalAll = bondItems.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const unassignedTotal = bondItems.filter((b) => !b.assignedTo).reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const storesTotal = sumBondFor(bondItems, 'stores');
  const crewTotals = crew.map((c) => ({ c, total: sumBondFor(bondItems, c.id) })).filter((x) => x.total > 0);

  return (
    <Section icon={FileText} title="Bond" count={bondItems.length ? `${bondItems.length} items · ${fmtMoney(totalAll)}` : null}>
      <input ref={fileInput} type="file" accept="application/pdf" multiple onChange={handleFiles} style={{ display: 'none' }} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => fileInput.current?.click()} disabled={parsing}
          style={{
            flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: parsing ? `${C.sea}22` : `${C.sea}1a`, border: `1px dashed ${C.sea}88`, color: C.sea,
            borderRadius: 9, padding: '11px 12px', cursor: parsing ? 'wait' : 'pointer',
            fontSize: 13.5, fontWeight: 600,
          }}>
          {parsing ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
          {parsing ? 'Parsing…' : 'Upload invoice PDF'}
        </button>
        <button onClick={addManual} style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          background: `${C.brass}1a`, border: `1px dashed ${C.brass}88`, color: C.brass,
          borderRadius: 9, padding: '11px 12px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
        }}>
          <Plus size={15} /> Manual
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 10, background: `${C.red}1a`, border: `1px solid ${C.red}55`, borderRadius: 8, marginBottom: 10, color: C.red, fontSize: 13 }}>
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{error}</span>
        </div>
      )}

      {bondItems.length === 0 && !parsing && !error && (
        <div style={{ color: C.dim, fontSize: 13, padding: '4px 0 8px', fontStyle: 'italic', lineHeight: 1.4 }}>
          Upload a bond invoice (e.g. 60N Bond Ltd) to auto-import items, or add them manually. Items with multiple units can be split — tap the scissors to break them up across crew.
        </div>
      )}

      {groupKeys.map((key) => (
        <BondGroup key={key} sourceLabel={key === '__manual__' ? 'Manual entries' : key}
          items={groups[key]} crew={crew}
          onUpdate={update} onRemove={remove} onSplit={split} />
      ))}

      {bondItems.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '10px 12px', background: C.bg, border: `1px solid ${C.line}`, borderRadius: 9 }}>
            <div>
              <Label>Allocation</Label>
              <div style={{ fontSize: 11.5, color: C.dim }}>Per-crewman totals roll into the PDF.</div>
            </div>
            <IconBtn onClick={clearAll} title="Clear all bond items" color={C.dim} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, padding: '8px 12px', background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            {crewTotals.length === 0 && storesTotal === 0 && unassignedTotal === 0 && (
              <div style={{ color: C.dim, fontStyle: 'italic', padding: '4px 0' }}>Nothing assigned yet.</div>
            )}
            {crewTotals.map(({ c, total }) => (
              <Row key={c.id} label={c.name || '—'} value={fmtMoney(total)} />
            ))}
            {storesTotal > 0 && <Row label="Stores (boat pays)" value={fmtMoney(storesTotal)} italic />}
            {unassignedTotal > 0 && <Row label="⚠ Unassigned" value={fmtMoney(unassignedTotal)} color={C.red} />}
          </div>
        </>
      )}

      <style>{`@keyframes squareup-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .spin { animation: squareup-spin 0.9s linear infinite; }`}</style>
    </Section>
  );
}

function Row({ label, value, italic, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: color || C.ink, fontStyle: italic ? 'italic' : 'normal' }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function BondGroup({ sourceLabel, items, crew, onUpdate, onRemove, onSplit }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 11, marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ padding: '9px 12px', background: `${C.panel}cc`, borderBottom: `1px solid ${C.line}`, color: C.dim, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.4, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{sourceLabel}</span>
        <span style={{ color: C.sea, marginLeft: 8, flexShrink: 0 }}>{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>
      <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map((b) => <BondItem key={b.id} item={b} crew={crew} onUpdate={onUpdate} onRemove={onRemove} onSplit={onSplit} />)}
      </div>
    </div>
  );
}

function BondItem({ item, crew, onUpdate, onRemove, onSplit }) {
  const isManual = !item.source;
  const canSplit = !isManual && item.qty > 1;
  const [splitting, setSplitting] = useState(false);
  const [splitQty, setSplitQty] = useState('');

  const doSplit = () => {
    const n = parseInt(splitQty, 10);
    if (isNaN(n) || n < 1 || n >= item.qty) {
      setSplitting(false);
      setSplitQty('');
      return;
    }
    onSplit(item.id, n);
    setSplitting(false);
    setSplitQty('');
  };

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
        {isManual ? (
          <input value={item.description} onChange={(e) => onUpdate(item.id, { description: e.target.value })}
            placeholder="Item description" style={{ ...inputStyle, flex: 1 }} />
        ) : (
          <div style={{ flex: 1, fontSize: 13.5, color: C.ink, fontWeight: 500, lineHeight: 1.3, paddingTop: 2 }}>
            {item.description}
            {item.qty > 1 && (
              <span style={{ color: C.dim, fontWeight: 400, marginLeft: 6 }}>× {item.qty}</span>
            )}
          </div>
        )}
        <div style={{ width: 100, flexShrink: 0 }}>
          {isManual ? (
            <MoneyInput value={item.amount} onChange={(v) => onUpdate(item.id, { amount: parseFloat(v) || 0 })} />
          ) : (
            <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: C.ink, fontVariantNumeric: 'tabular-nums', paddingTop: 8 }}>
              {fmtMoney(item.amount)}
            </div>
          )}
        </div>
      </div>

      {canSplit && !splitting && (
        <button onClick={() => setSplitting(true)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'transparent', border: `1px solid ${C.sea}66`, color: C.sea,
          borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          marginBottom: 8,
        }}>
          <Scissors size={12} /> Split off some
        </button>
      )}

      {splitting && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, padding: 8, background: `${C.sea}14`, border: `1px solid ${C.sea}55`, borderRadius: 8 }}>
          <span style={{ fontSize: 12.5, color: C.dim, whiteSpace: 'nowrap' }}>Split off</span>
          <input value={splitQty} onChange={(e) => setSplitQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSplit(); }}
            type="number" min="1" max={item.qty - 1} placeholder={`1–${item.qty - 1}`} autoFocus
            style={{ ...inputStyle, width: 70, padding: '6px 8px', textAlign: 'center' }} />
          <span style={{ fontSize: 12.5, color: C.dim, whiteSpace: 'nowrap' }}>of {item.qty}</span>
          <div style={{ flex: 1 }} />
          <button onClick={doSplit} style={{
            background: C.sea, color: C.bg, border: 'none', borderRadius: 7,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
          }}>Split</button>
          <button onClick={() => { setSplitting(false); setSplitQty(''); }} style={{
            background: 'transparent', color: C.dim, border: 'none',
            padding: '6px 8px', cursor: 'pointer', fontSize: 12.5,
          }}>Cancel</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
        <select
          value={item.assignedTo || ''}
          onChange={(e) => onUpdate(item.id, { assignedTo: e.target.value || null })}
          style={{ ...selectStyle, flex: 1, padding: '8px 28px 8px 10px', fontSize: 13, background: item.assignedTo ? C.bg : `${C.red}14`, borderColor: item.assignedTo ? C.line : `${C.red}66` }}>
          <option value="">— Unassigned —</option>
          <optgroup label="Crew">
            {crew.length === 0 && <option disabled>(no crew added)</option>}
            {crew.map((c) => (
              <option key={c.id} value={c.id}>{c.name || '(unnamed)'}</option>
            ))}
          </optgroup>
          <option value="stores">Stores (boat pays)</option>
        </select>
        <IconBtn onClick={() => onRemove(item.id)} title="Remove item" size={14} />
      </div>
    </div>
  );
}
