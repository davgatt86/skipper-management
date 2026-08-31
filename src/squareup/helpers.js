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

/* Money, with a thousands separator. David, Aug 2026 — a crewman's monthly
 * bonus is four figures and £1153.40 is harder to read at a glance than
 * £1,153.40, which matters most on the printed sheet where the columns are
 * right-aligned and scanned down.
 *
 * A WHOLE NUMBER KEEPS ITS SHORT FORM: £50, not £50.00. That was here before
 * and is deliberate — the share figures on this page are usually round, and
 * pence nobody entered are noise.
 *
 * The minus goes OUTSIDE the pound sign. "£-1,153.40" reads as a strange
 * currency; "-£1,153.40" reads as money owed the other way. */
export const fmtMoney = (n) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const body = a === Math.floor(a)
    ? a.toLocaleString('en-GB')
    : a.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-£' : '£') + body;
};

export const sumBondFor = (bondItems, target) =>
  bondItems.filter((b) => b.assignedTo === target).reduce((s, b) => s + (Number(b.amount) || 0), 0);

/* THE BOND, BROKEN OUT — one function, so the preview, the PDF and the skipper's
 * own view of a kept sheet cannot disagree about who owes what. The catalogue
 * and the chalk sheet taught that: two documents rendered perfectly and
 * contradicted each other because the sale order was worked out twice.
 *
 * It returns the ITEMS as well as the totals. The office is only ever shown the
 * totals — David, Aug 2026: "the exportable sheet doesn't need this info though,
 * just myself as skipper. office only needs to see total £ per crewman + any
 * carried over balance." The itemisation is what settles a dispute, and settling
 * a dispute is the skipper's job, not the office's.
 *
 * CARRIED IS NOT UNASSIGNED, though both are charged to nobody. Carried is a
 * balance brought forward off an earlier trip and is a perfectly ordinary thing
 * for the office to see; unassigned is this trip's bond that nobody has got
 * round to charging, and is a question. Printing them as one figure would turn
 * every carried balance into a red flag, and every real flag into a shrug. */
export function bondBreakdown(bondItems = [], crew = []) {
  const sum = (rows) => rows.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const of = (fn) => bondItems.filter(fn);

  const perCrew = crew
    .map((c) => {
      const items = of((b) => b.assignedTo === c.id);
      return { c, items, total: sum(items) };
    })
    .filter((x) => x.items.length > 0);

  const stores = of((b) => b.assignedTo === 'stores');
  const carried = of((b) => !b.assignedTo && b.carried);
  const loose = of((b) => !b.assignedTo && !b.carried);

  /* Bond charged to a man who is no longer on the sheet — he was taken off
     after the bond was assigned. It belongs to nobody the page can name, so it
     is counted rather than quietly dropped out of the total. */
  const named = new Set(crew.map((c) => c.id));
  const orphan = of((b) => b.assignedTo && b.assignedTo !== 'stores' && !named.has(b.assignedTo));

  return {
    perCrew,
    stores: { items: stores, total: sum(stores) },
    carried: { items: carried, total: sum(carried) },
    unassigned: { items: [...loose, ...orphan], total: sum(loose) + sum(orphan) },
    total: sum(bondItems),
    isEmpty: bondItems.length === 0,
  };
}
