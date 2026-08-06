// One figure. Three states, deliberately distinguishable at a glance:
//
//   a value   the figure
//   n/a       this sheet format cannot produce it — hover for why
//   —         the format could, but this data has not got it
//
// Keeping "n/a" and "—" apart matters: one is a permanent property of the
// sheet, the other is a gap that might fill in. Showing zero for either would
// be worse than both, because zero is a number and gets averaged.
export default function Stat({ label, value, unavailable, sub, accent = false }) {
  const na = unavailable != null
  const blank = !na && (value == null || value === '')

  return (
    <div className={'card' + (accent ? ' stat-accent' : '')} style={{ margin: 0, padding: '13px 15px' }}>
      <div className="fl" style={{ marginBottom: 6 }}>{label}</div>
      {na ? (
        <div className="stat-na" title={unavailable}>n/a</div>
      ) : blank ? (
        <div className="stat-na" title="Not recorded on this settlement">—</div>
      ) : (
        <div className="big num" style={{ fontSize: '1.7rem', color: accent ? 'var(--brass)' : undefined }}>{value}</div>
      )}
      {sub && !na && <div className="muted" style={{ fontSize: '0.72rem', marginTop: 5 }}>{sub}</div>}
      {na && <div className="muted" style={{ fontSize: '0.68rem', marginTop: 5 }}>{unavailable}</div>}
    </div>
  )
}
