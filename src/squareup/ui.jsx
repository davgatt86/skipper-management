import React from 'react';
import { Trash2 } from 'lucide-react';
import { C } from './constants.js';

export const selectStyle = {
  background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8,
  padding: '10px 28px 10px 11px', fontSize: 14, fontFamily: 'inherit', outline: 'none',
  appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%238badc7' d='M5 6L0 0h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
  width: '100%', boxSizing: 'border-box',
};

export const inputStyle = {
  background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8,
  padding: '10px 11px', fontSize: 14, fontFamily: 'inherit', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};

export function Section({ icon: Icon, title, count, accent = C.brass, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px', borderBottom: `1px solid ${C.line}`, background: `linear-gradient(180deg, ${C.panel2}, ${C.panel})` }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, background: `${accent}26`, border: `1px solid ${accent}66`, flexShrink: 0 }}>
          <Icon size={15} color={accent} />
        </span>
        <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, letterSpacing: 0.3, flex: 1, color: C.ink }}>{title}</span>
        {count != null && <span style={{ color: C.dim, fontSize: 12, fontWeight: 500 }}>{count}</span>}
      </div>
      <div style={{ padding: 13 }}>{children}</div>
    </div>
  );
}

export function IconBtn({ onClick, icon: Icon = Trash2, color = C.red, title, size = 15, disabled = false }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} disabled={disabled}
      style={{
        background: `${color}1a`, border: `1px solid ${color}55`, borderRadius: 8, padding: 8,
        cursor: disabled ? 'default' : 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0,
        opacity: disabled ? 0.45 : 1,
      }}>
      <Icon size={size} color={color} />
    </button>
  );
}

export function Label({ children }) {
  return <div style={{ color: C.dim, fontSize: 10.5, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1.4, fontWeight: 700 }}>{children}</div>;
}

export function MoneyInput({ value, onChange, placeholder = '0' }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.dim, fontSize: 14, pointerEvents: 'none' }}>£</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal"
        style={{ ...inputStyle, paddingLeft: 22 }} />
    </div>
  );
}

export function PercentInput({ value, onChange }) {
  return (
    <div style={{ position: 'relative' }}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" inputMode="decimal"
        style={{ ...inputStyle, paddingRight: 26, textAlign: 'right' }} />
      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: C.dim, fontSize: 14, pointerEvents: 'none' }}>%</span>
    </div>
  );
}

export function GhostBtn({ onClick, icon: Icon, children, color = C.sea }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      background: `${color}1a`, border: `1px dashed ${color}88`, color, borderRadius: 9,
      padding: '10px 14px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, width: '100%',
    }}>
      {Icon && <Icon size={15} />} {children}
    </button>
  );
}
