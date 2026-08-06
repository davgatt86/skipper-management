import React from 'react';
import { Trash2 } from 'lucide-react';

// Square Up's form furniture, on the app's design tokens rather than the
// module's own literal palette. That means it follows the day/dark choice like
// every other page.
//
// Preview.jsx deliberately does NOT use these — it is a picture of the printed
// sheet, so it stays on paper white whatever the screen theme is. The PDF
// generator has its own colours too, so nothing here can change what the office
// receives.

const focus = {
  outline: 'none',
};

export const inputStyle = {
  background: 'var(--surface)',
  color: 'var(--text)',
  border: '1px solid var(--line)',
  borderRadius: 3,
  padding: '10px 11px',
  fontSize: 14,
  fontFamily: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
  ...focus,
};

export const selectStyle = {
  ...inputStyle,
  padding: '10px 28px 10px 11px',
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%235D7079' d='M5 6L0 0h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
};

// A section is the app's card with a section rule across the top: hairline,
// short cobalt tick, uppercase display heading.
export function Section({ icon: Icon, title, count, children }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '12px 15px', borderBottom: '1px solid var(--line-2)',
        background: 'var(--surface-2)',
      }}>
        <span style={{ width: 18, height: 3, background: 'var(--hull)', borderRadius: 1, flexShrink: 0 }} />
        {Icon && <Icon size={15} color="var(--hull)" style={{ flexShrink: 0 }} />}
        <span style={{
          flex: 1,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          textTransform: 'uppercase',
          fontSize: '1.15rem',
          lineHeight: 1,
          color: 'var(--hull)',
        }}>{title}</span>
        {count != null && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.66rem',
            letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--mute)',
          }}>{count}</span>
        )}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

export function IconBtn({ onClick, icon: Icon = Trash2, color = 'var(--rust)', title, size = 15, disabled = false }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} disabled={disabled}
      style={{
        background: 'transparent',
        border: '1px solid var(--line)',
        borderRadius: 3,
        padding: 8,
        cursor: disabled ? 'default' : 'pointer',
        display: 'grid', placeItems: 'center', flexShrink: 0,
        opacity: disabled ? 0.45 : 1,
      }}>
      <Icon size={size} color={color} />
    </button>
  );
}

export function Label({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      color: 'var(--mute)',
      fontSize: '0.58rem',
      marginBottom: 5,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
    }}>{children}</div>
  );
}

// Figures are mono so columns line up, same rule as everywhere else.
const numericInput = {
  ...inputStyle,
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
};

export function MoneyInput({ value, onChange, placeholder = '0' }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--mute)', fontSize: 14, pointerEvents: 'none' }}>£</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal"
        style={{ ...numericInput, paddingLeft: 22, textAlign: 'right' }} />
    </div>
  );
}

export function PercentInput({ value, onChange }) {
  return (
    <div style={{ position: 'relative' }}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" inputMode="decimal"
        style={{ ...numericInput, paddingRight: 26, textAlign: 'right' }} />
      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mute)', fontSize: 14, pointerEvents: 'none' }}>%</span>
    </div>
  );
}

export function GhostBtn({ onClick, icon: Icon, children }) {
  return (
    <button onClick={onClick} className="addrow" style={{ width: '100%', marginTop: 0 }}>
      {Icon && <Icon size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />}{children}
    </button>
  );
}
