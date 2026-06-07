import React, { useState } from 'react';
import { ChevronLeft, Share2, Printer, Loader2 } from 'lucide-react';
import { C } from './constants.js';
import { fmtDate, fmtShares, fmtMoney, shareTextOf, sumBondFor, todayISO } from './helpers.js';
import { generateSquareUpPDF, shareOrDownloadPDF, makeFilename } from './pdfGenerator.js';
import { IconBtn } from './ui.jsx';

export default function Preview(props) {
  const {
    vessel, tripDate, crew, totalShares, quota,
    fuel, labour, logistics, foreignCrew, bondItems, onBack,
  } = props;

  const [busy, setBusy] = useState(false);

  const crewBondTotals = crew
    .map((c) => ({ c, total: sumBondFor(bondItems, c.id) }))
    .filter((x) => x.total > 0);
  const storesTotal = sumBondFor(bondItems, 'stores');
  const unassignedTotal = bondItems
    .filter((b) => !b.assignedTo)
    .reduce((s, b) => s + (Number(b.amount) || 0), 0);

  const handleShare = async () => {
    setBusy(true);
    try {
      const doc = generateSquareUpPDF(props);
      const filename = makeFilename({ vessel, tripDate });
      await shareOrDownloadPDF(doc, filename);
    } catch (e) {
      console.error(e);
      alert('Could not generate PDF: ' + (e.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => window.print();

  return (
    <div className="squareup-root" style={{
      minHeight: '100vh', background: C.bgDeep,
      padding: 'max(16px, env(safe-area-inset-top)) 12px calc(90px + env(safe-area-inset-bottom)) 12px',
    }}>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .preview-page {
            box-shadow: none !important; margin: 0 !important; padding: 0 !important;
            max-width: none !important; width: 100% !important; border-radius: 0 !important;
          }
        }
        @keyframes squareup-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        .spin { animation: squareup-spin 0.9s linear infinite; }
      `}</style>

      <div className="preview-page" style={{
        background: 'white', color: '#0a1622',
        maxWidth: 720, width: '100%', margin: '0 auto', padding: '34px 32px',
        borderRadius: 4, boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        fontFamily: 'inherit', boxSizing: 'border-box',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: '2px solid #0a1622', paddingBottom: 12, marginBottom: 22, gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1 }}>{vessel || '—'}</div>
            <div style={{ color: '#5a6a7a', fontSize: 11.5, marginTop: 4, letterSpacing: 1.8, textTransform: 'uppercase', fontWeight: 600 }}>Trip Square-Up</div>
          </div>
          <div style={{ textAlign: 'right', color: '#3a4a5c', fontSize: 13, flexShrink: 0 }}>
            <div style={{ fontWeight: 600 }}>{fmtDate(tripDate) || '—'}</div>
          </div>
        </div>

        {/* Shares */}
        <DocSection title="Shares">
          {crew.length === 0 ? <DocEmpty>No crew added.</DocEmpty> : (
            <>
              {crew.map((c) => (
                <div key={c.id} style={docRow}>
                  <span style={{ flex: 1, fontWeight: 500 }}>{c.name || '—'}</span>
                  <span style={{ width: 80, textAlign: 'right', color: '#3a4a5c' }}>{shareTextOf(c)}</span>
                  <span style={{ width: 80, textAlign: 'right', color: c.bonus ? '#8a5a0a' : '#bcc6d2', fontWeight: c.bonus ? 600 : 400 }}>
                    {c.bonus ? `+ ${c.bonus}%` : '—'}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '2px solid #0a1622', fontSize: 14, fontWeight: 700, color: '#0a1622' }}>
                <span>Total shares</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtShares(totalShares)}</span>
              </div>
            </>
          )}
        </DocSection>

        {/* Bond */}
        <DocSection title="Bond">
          {crewBondTotals.length === 0 && storesTotal === 0 && unassignedTotal === 0 ? (
            <DocEmpty>TBC</DocEmpty>
          ) : (
            <>
              {crewBondTotals.map(({ c, total }) => (
                <DocLine key={c.id} left={c.name || '—'} right={fmtMoney(total)} />
              ))}
              {storesTotal > 0 && (
                <DocLine left={<span style={{ fontStyle: 'italic' }}>Stores <span style={{ color: '#7a8a99', fontStyle: 'normal', fontSize: 12 }}>(boat pays)</span></span>} right={fmtMoney(storesTotal)} />
              )}
              {unassignedTotal > 0 && (
                <DocLine left={<span style={{ color: '#b45a46', fontWeight: 600 }}>Unassigned (review)</span>} right={<span style={{ color: '#b45a46' }}>{fmtMoney(unassignedTotal)}</span>} />
              )}
            </>
          )}
        </DocSection>

        {/* Quota */}
        <DocSection title="Quota Recovery">
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2a3c' }}>{quota}%</div>
        </DocSection>

        {/* Fuel */}
        <DocSection title="Fuel">
          {fuel.length === 0 ? <DocEmpty>None.</DocEmpty> : (
            fuel.map((f) => (
              <div key={f.id} style={docRow}>
                <span style={{ flex: 1, fontWeight: 500 }}>{f.location || '—'}</span>
                <span style={{ width: 130, textAlign: 'right', color: '#5a6a7a', fontSize: 12.5 }}>{f.date ? fmtDate(f.date) : ''}</span>
                <span style={{ width: 100, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.litres ? `${Number(f.litres).toLocaleString('en-GB')} lt` : ''}</span>
              </div>
            ))
          )}
        </DocSection>

        {/* Logistics */}
        {logistics?.trim() && (
          <DocSection title="Logistics / Transport">
            <div style={{ fontSize: 13.5, color: '#1a2a3c', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{logistics}</div>
          </DocSection>
        )}

        {/* Labour */}
        <DocSection title="Labour">
          {labour.length === 0 ? <DocEmpty>None.</DocEmpty> : (
            labour.map((l) => (
              <div key={l.id} style={docRow}>
                <span style={{ flex: 1, fontWeight: 500 }}>{l.name || '—'}</span>
                <span style={{ width: 110, textAlign: 'right', color: '#5a6a7a', fontVariantNumeric: 'tabular-nums' }}>{l.boxes ? `${l.boxes} boxes` : ''}</span>
                <span style={{ width: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.amount ? fmtMoney(l.amount) : ''}</span>
              </div>
            ))
          )}
        </DocSection>

        {/* Foreign crew bonus */}
        <DocSection title="Foreign Crew Bonus">
          {foreignCrew.length === 0 ? <DocEmpty>None.</DocEmpty> : (
            foreignCrew.map((c) => (
              <DocLine key={c.id} left={c.name || '—'} right={c.bonus ? fmtMoney(c.bonus) : '—'} />
            ))
          )}
        </DocSection>

        <div style={{ marginTop: 32, paddingTop: 12, borderTop: '1px solid #d6dde4', display: 'flex', justifyContent: 'space-between', color: '#8a98a8', fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 600 }}>
          <span>Generated {fmtDate(todayISO())}</span>
          <span>{(vessel || '').toUpperCase()}</span>
        </div>
      </div>

      {/* Bottom fixed action bar */}
      <div className="no-print" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: `${C.bgDeep}f2`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderTop: `1px solid ${C.line}`,
        padding: '12px 14px',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
        display: 'flex', gap: 10, alignItems: 'center',
        zIndex: 100, boxShadow: '0 -8px 24px rgba(0,0,0,0.5)',
      }}>
        <IconBtn onClick={onBack} icon={ChevronLeft} color={C.sea} title="Back to edit" size={16} />
        <div style={{ flex: 1 }} />
        <button onClick={handlePrint} style={btnSecondary}>
          <Printer size={15} /> Print
        </button>
        <button onClick={handleShare} disabled={busy} style={btnPrimary}>
          {busy ? <Loader2 size={15} className="spin" /> : <Share2 size={15} />}
          {busy ? 'Generating…' : 'Share PDF'}
        </button>
      </div>
    </div>
  );
}

const docRow = {
  display: 'flex', alignItems: 'baseline', padding: '5px 0', fontSize: 13.5,
  color: '#1a2a3c', fontVariantNumeric: 'tabular-nums', borderBottom: '1px dotted #e3e8ee',
};

const btnPrimary = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  background: `linear-gradient(180deg, ${C.brass}, ${C.brassDk})`, color: C.bg,
  border: 'none', borderRadius: 10, padding: '11px 18px', cursor: 'pointer',
  fontSize: 14.5, fontWeight: 700, boxShadow: `0 4px 12px ${C.brass}44`,
};

const btnSecondary = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  background: 'transparent', color: C.sea,
  border: `1px solid ${C.sea}88`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
  fontSize: 14, fontWeight: 600,
};

function DocSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20, pageBreakInside: 'avoid', breakInside: 'avoid' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', color: '#8a5a0a', marginBottom: 8, paddingBottom: 5, borderBottom: '1px solid #c8d2dc' }}>{title}</div>
      {children}
    </div>
  );
}

function DocLine({ left, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', padding: '5px 0', fontSize: 13.5, color: '#1a2a3c', borderBottom: '1px dotted #e3e8ee' }}>
      <span style={{ flex: 1, fontWeight: 500 }}>{left}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{right}</span>
    </div>
  );
}

function DocEmpty({ children }) {
  return <div style={{ fontSize: 13, color: '#9aaab8', fontStyle: 'italic' }}>{children}</div>;
}
