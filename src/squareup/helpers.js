import { SHARE_OPTIONS, SHARE_VAL } from './constants.js';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch {
    return iso;
  }
};

export const parseUKDate = (s) => {
  // "23/05/2026" -> "2026-05-23"
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};

export const parseCustomShare = (s) => {
  const v = (s || '').trim();
  if (!v) return 0;
  const m = v.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

export const shareValOf = (c) =>
  c.shareKey === 'custom' ? parseCustomShare(c.shareCustom) : (SHARE_VAL[c.shareKey] || 0);

export const shareTextOf = (c) => {
  if (c.shareKey === 'custom') return c.shareCustom?.trim() || '—';
  return SHARE_OPTIONS.find((s) => s.key === c.shareKey)?.short || '—';
};

export const fmtShares = (n) =>
  n === Math.floor(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

export const fmtMoney = (n) => {
  const v = Number(n) || 0;
  return v === Math.floor(v) ? `£${v}` : `£${v.toFixed(2)}`;
};

export const sumBondFor = (bondItems, target) =>
  bondItems.filter((b) => b.assignedTo === target).reduce((s, b) => s + (Number(b.amount) || 0), 0);
