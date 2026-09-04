import React from 'react'

/* The small pieces every invoice tab is built from.
 *
 * They live here rather than in each tab because the three tabs are three
 * readings of ONE set of figures, and a figure that renders differently
 * depending on which tab you are looking at is a figure nobody trusts. Same
 * argument as `bySaleOrder` being imported by both the chalk sheet and the
 * buyers' catalogue — those two rendered perfectly and disagreed with each
 * other, which is the failure worth designing against.
 */

export const money = (n) => {
  const v = Number(n) || 0
  return (v < 0 ? '-£' : '£') + Math.abs(v).toLocaleString('en-GB',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export const money0 = (n) => {
  const v = Number(n) || 0
  return (v < 0 ? '-£' : '£') + Math.abs(v).toLocaleString('en-GB', { maximumFractionDigits: 0 })
}
/* Thousands where the space is tight — a ten-year grid is 220 figures, and at
   full precision it is a wall nobody reads. The exact figure is always one
   click away in the invoice list, so nothing is lost by rounding the map. */
export const moneyK = (n) => {
  const v = Math.round(Number(n) || 0)
  if (v === 0) return '·'
  const a = Math.abs(v)
  if (a >= 1000) return (v < 0 ? '-' : '') + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k'
  return (v < 0 ? '-' : '') + a
}
export const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00')
  .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

export const MONO = 'var(--font-mono, ui-monospace, monospace)'

/** One headline figure. */
export function Stat({ label, value, sub, tone, size = '1.5rem' }) {
  return (
    <div style={{ minWidth: '7rem' }}>
      <div className="muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase',
                                      letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: size, fontWeight: 700, lineHeight: 1.15,
                    color: tone || 'inherit' }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: '0.76rem', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/**
 * A change against the same window last year.
 *
 * SPENDING MORE IS NOT A FAILURE AND SPENDING LESS IS NOT A WIN — a boat that
 * slipped and re-engined in one year should be dearer than one that did not. So
 * the colour marks DIRECTION and nothing else, in the neutral pair rather than
 * the red/green of a warning: the page is not entitled to an opinion about
 * whether an engine overhaul was a good idea.
 */
export function Delta({ change, pct, isNew, was }) {
  if (isNew) {
    return <span className="muted" style={{ fontSize: '0.78rem' }}>
      new this year{was ? '' : ''}
    </span>
  }
  if (!Number.isFinite(change) || Math.round(change) === 0) {
    return <span className="muted" style={{ fontSize: '0.78rem' }}>level</span>
  }
  const up = change > 0
  return (
    <span style={{ fontSize: '0.78rem', fontFamily: MONO, color: 'var(--mute)' }}>
      {up ? '▲' : '▼'} {money0(Math.abs(change))}
      {Number.isFinite(pct) && pct !== null && (
        <span className="muted"> ({up ? '+' : '−'}{Math.abs(Math.round(pct * 100))}%)</span>
      )}
    </span>
  )
}

/** A share of the whole, drawn rather than written. */
export function Bar({ value, max, tone = 'var(--hull)', height = 6 }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div style={{ background: 'var(--line)', borderRadius: height, height, overflow: 'hidden' }}>
      <div style={{ width: w + '%', height: '100%', background: tone, borderRadius: height }} />
    </div>
  )
}

/**
 * Ten years of one firm, drawn small.
 *
 * A row of ten numbers says what each year was; this says what the RELATIONSHIP
 * between them is, which is the question a supplier table actually raises — is
 * this firm growing, steady, or finished. It carries no axis and no figures on
 * purpose: it is a shape, and the numbers are in the same row.
 */
export function Spark({ values, width = 78, height = 18, tone = 'var(--hull)' }) {
  const v = values.map((x) => Number(x) || 0)
  if (!v.length) return null
  const max = Math.max(...v, 1)
  const step = v.length > 1 ? width / (v.length - 1) : width
  const pts = v.map((x, i) => `${(i * step).toFixed(1)},${(height - (x / max) * (height - 2) - 1).toFixed(1)}`)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"
         style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={tone} strokeWidth="1.4"
                strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
      <circle cx={pts[pts.length - 1].split(',')[0]} cy={pts[pts.length - 1].split(',')[1]}
              r="1.9" fill={tone} />
    </svg>
  )
}

/**
 * How hard a grid cell is shaded.
 *
 * SHADED ACROSS THE WHOLE GRID, not down each column. Against its own column,
 * every year's largest trade would be the darkest cell on the page and a
 * £28,000 year would look exactly like a £1.3m one — the picture would show
 * which trade led each year and hide the ten-year shape entirely, which is the
 * one thing a ten-year grid is for.
 *
 * TWO CORRECTIONS FOR SKEW, and the second was found by rendering it rather
 * than by reading it. The square root is there because one cell is £616,200
 * while most are under £20,000, so a linear scale leaves all but three cells
 * white. That was not enough on its own: scaled against the MAXIMUM the first
 * version still showed exactly one dark square and two hundred pale ones — a
 * picture of the outlier rather than of the decade. So the caller passes the
 * 90th percentile instead and everything above it sits at full strength.
 * Flattening the top of the range costs nothing, because the figure is written
 * in the cell.
 */
export function heatStyle(value, peak) {
  const v = Number(value) || 0
  if (!peak || v <= 0) return {}
  const a = Math.min(1, Math.sqrt(v / peak))
  return {
    background: `color-mix(in srgb, var(--hull) ${(a * 52).toFixed(1)}%, transparent)`,
    /* The darkest cells need their own weight or the figure disappears into its
       own shading — checked at both ends of the scale rather than assumed. */
    fontWeight: a > 0.62 ? 700 : 400,
  }
}

/** A clickable table cell that drills through to the invoices behind it. */
export function DrillCell({ value, peak, onClick, title }) {
  const has = (Number(value) || 0) > 0
  return (
    <td
      onClick={has ? onClick : undefined}
      title={has ? title : undefined}
      style={{
        textAlign: 'right', padding: '0.32rem 0.45rem', fontFamily: MONO,
        fontSize: '0.82rem', whiteSpace: 'nowrap',
        cursor: has && onClick ? 'pointer' : 'default',
        color: has ? undefined : 'var(--mute)',
        ...heatStyle(value, peak),
      }}
    >
      {has ? moneyK(value) : '·'}
    </td>
  )
}

/** The card every panel on these tabs is built in. */
export function Panel({ title, sub, right, tone, children, pad = true }) {
  return (
    <div className="card" style={tone ? { borderColor: tone } : undefined}>
      {(title || right) && (
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap',
                      marginBottom: sub ? '0.15rem' : '0.5rem' }}>
          {title && <b style={{ fontSize: '0.95rem' }}>{title}</b>}
          <span style={{ flex: 1 }} />
          {right}
        </div>
      )}
      {sub && <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '0.8rem' }}>{sub}</p>}
      {pad ? children : children}
    </div>
  )
}

/** A row of choices that reads as one control rather than a row of buttons. */
export function Segmented({ value, onChange, options, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      {label && <span className="muted" style={{ fontSize: '0.76rem' }}>{label}</span>}
      <span style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 6,
                     overflow: 'hidden' }}>
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
                  title={o.title}
                  style={{
                    border: 0, borderRadius: 0, padding: '0.24rem 0.6rem', fontSize: '0.8rem',
                    cursor: 'pointer',
                    background: value === o.value ? 'var(--hull)' : 'transparent',
                    color: value === o.value ? '#fff' : 'var(--ink)',
                    fontWeight: value === o.value ? 600 : 400,
                  }}>
            {o.label}
          </button>
        ))}
      </span>
    </span>
  )
}
