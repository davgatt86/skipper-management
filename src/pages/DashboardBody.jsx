import React from 'react'
import { Link } from 'react-router-dom'
import { speciesBasis, boatBlocks, toDo, isNewBoat, FIRST_STEPS } from '../lib/dashboard'

/* THE FRONT PAGE, DRAWN — prices, your boat, what to do next.
 *
 * Prop-driven and a file of its own so it can be server-rendered. The dashboard
 * is behind a login and the interesting states are the empty ones: six of the
 * thirteen fleets have uploaded nothing at all, and until now they opened the
 * app on a blank page.
 */
export default function DashboardBody({
  vessel, board, species = [], landed = [], basis = 'value', onBasis,
  source = 'PD', onSource, blocks, todo = [], canSeeMoney = true,
}) {
  const b = blocks || boatBlocks({})
  const fresh = isNewBoat(b)

  return (
    <div>
      {/* ---- 1. THE MARKET, for everyone ------------------------------------
          `market_prices` has no fleet_id — it is the shared board, and it is
          the one thing a boat has in full on the day she signs up. That is why
          it is the top band and not a corner. */}
      <Market board={board} species={species} landed={landed}
              basis={basis} onBasis={onBasis} source={source} onSource={onSource} />

      {/* ---- 3 comes before 2 when there is nothing else --------------------
          A boat with no record of her own gets told what would fill the page,
          rather than a stack of empty headings. */}
      {fresh && <FirstSteps />}

      {!fresh && <Boat blocks={b} vessel={vessel} canSeeMoney={canSeeMoney} />}

      {todo.length > 0 && <ToDo items={todo} />}
    </div>
  )
}

function Market({ board, species, landed, basis, onBasis, source, onSource }) {
  const basisOf = speciesBasis(landed, { basis })
  const from = Object.fromEntries(basisOf.map((x) => [x.species, x.from]))

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>
          The market{board?.day ? <span className="muted" style={{ fontWeight: 400 }}> · {fmt(board.day)}</span> : null}
        </h3>
        <span style={{ display: 'flex', gap: '0.3rem' }}>
          <Toggle now={source} set={onSource} options={[['PD', 'Peterhead'], ['DK', 'Denmark']]} />
          {/* THE TOGGLE ONLY CHANGES WHICH EXTRAS ARE PICKED. Cod, haddock and
              saithe are pinned either way — they are the market everyone
              watches, whatever a particular boat happens to land. */}
          <Toggle now={basis} set={onBasis} options={[['value', 'by value'], ['volume', 'by volume']]} />
        </span>
      </div>

      {!board?.day ? (
        <p className="muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
          No prices on the board for {source === 'DK' ? 'Denmark' : 'Peterhead'} yet.
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: '0.78rem', margin: '0.35rem 0 0.6rem' }}>
            Against {board.previous ? <>the day before ({fmt(board.previous)})</> : 'the day before'} and
            the four weeks to {fmt(board.day)}.
          </p>
          {board.rows.map((r) => (
            <SpeciesBlock key={r.species} row={r} from={from[r.species]} />
          ))}
        </>
      )}
    </div>
  )
}

function SpeciesBlock({ row, from }) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '0.45rem 0' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: '0.9rem' }}>{row.species}</b>
        {/* A BOAT'S OWN TOP SPECIES AND A GENERAL GUESS MUST NOT READ ALIKE.
            Telling a skipper these are "his biggest" when they are what most
            boats land is the quiet lie this codebase keeps refusing to tell. */}
        <span className="muted" style={{ fontSize: '0.72rem' }}>
          {from === 'pinned' ? 'watched by everyone'
            : from === 'own' ? 'one of yours'
              : 'what most boats land — yours will replace it'}
        </span>
      </div>

      {/* A SPECIES THE BOARD DOES NOT CARRY SAYS SO. Dropping the row would
          read as the boat not landing it. */}
      {!row.onBoard ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
          Not on this board{row.boardName !== row.species ? ` (it calls it ${row.boardName})` : ''}.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          {/* THE COLUMNS ARE LABELLED ONCE. They were labelled on every row,
              which only showed up on rendering it: seventeen rows of cod,
              haddock and saithe each repeating the same thirty characters,
              which buries the figures the panel exists to show. */}
          <thead>
            <tr className="muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <th style={{ textAlign: 'left', width: '4.5rem', fontWeight: 400 }}>Grade</th>
              <th style={{ textAlign: 'right', width: '4.5rem', fontWeight: 400 }}>Average</th>
              <th style={{ textAlign: 'right', width: '5rem', fontWeight: 400 }}>On the day</th>
              <th style={{ textAlign: 'right', width: '5rem', fontWeight: 400 }}>
                On {avgDays(row)}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {row.grades.map((g) => (
              <tr key={g.grade}>
                <td style={{ padding: '1px 0', width: '4.5rem' }}>{g.grade}</td>
                <td style={{ fontFamily: MONO, textAlign: 'right', width: '4.5rem', fontWeight: 600 }}>
                  {g.ave == null ? <span className="muted">—</span> : money(g.ave)}
                </td>
                <td style={{ textAlign: 'right', width: '5rem' }}><Move v={g.onDay} /></td>
                <td style={{ textAlign: 'right', width: '5rem' }}><Move v={g.onAvg} /></td>
                {/* Said only where it needs saying. A grade that did not sell
                    is the exception, and the exception is what earns the words. */}
                <td className="muted" style={{ paddingLeft: '0.6rem', fontSize: '0.72rem' }}>
                  {g.ave == null ? 'did not sell' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* NULL IS NOT ZERO, and they must not look alike. A grade that did not sell has
   no move; a grade that sold at exactly yesterday's price moved by nothing, and
   that is a real and different fact. */
function Move({ v }) {
  if (v == null) return <span className="muted">—</span>
  if (v === 0) return <span className="muted" title="no change">0.00</span>
  const up = v > 0
  return (
    <span style={{ fontFamily: MONO, color: up ? 'var(--kelp)' : 'var(--rust)' }}>
      {up ? '+' : '−'}{Math.abs(v).toFixed(2)}
    </span>
  )
}

function Boat({ blocks, vessel, canSeeMoney }) {
  const { lastTrip, month, quota, expiring, books } = blocks
  return (
    <>
      {lastTrip.has && canSeeMoney && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>
            Last trip <span className="muted" style={{ fontWeight: 400 }}>
              · {fmt(lastTrip.date)}{lastTrip.vessel ? ` · ${lastTrip.vessel}` : ''}
            </span>
          </h3>
          <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap' }}>
            <Fig label="Gross" value={money0(lastTrip.gross)} />
            <Fig label="Boxes" value={lastTrip.boxes ?? '—'} />
            <Fig label="Kilos" value={lastTrip.kg == null ? '—' : Math.round(lastTrip.kg).toLocaleString('en-GB')} />
            <Fig label="£/kg" value={lastTrip.ppk == null ? '—' : money(lastTrip.ppk)} />
          </div>
          {/* A NOTE THAT DID NOT RECONCILE CANNOT BE TRUSTED FOR ITS FIGURES,
              and the front page is the worst place to print them silently. */}
          {lastTrip.reconciled === false && (
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--brass)' }}>
              This note did not add up to its own printed total, so these figures cannot be
              trusted. <Link to="/sales">Fish Sales</Link> says by how much.
            </p>
          )}
        </div>
      )}

      {month.has && canSeeMoney && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>This month</h3>
          <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap' }}>
            <Fig label="Gross" value={money0(month.gross)} />
            <Fig label="Trips" value={month.trips} />
            {/* NOTHING TO SOMETHING IS NOT A CHANGE. A boat in her first year
                gets the figure and no percentage. */}
            {month.lastYear != null && (
              <Fig label="Same month last year" value={money0(month.lastYear)}
                   hint={`${month.lastYearTrips} trip${month.lastYearTrips === 1 ? '' : 's'} · `
                     + pct(month.gross, month.lastYear)} />
            )}
          </div>
        </div>
      )}

      {/* QUOTA IS A BLOCK LIKE ANY OTHER NOW, and absent for the twelve fleets
          that have none. It used to be the headline. */}
      {quota.has && canSeeMoney && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>
            Quota <span className="muted" style={{ fontWeight: 400 }}>
              {quota.asAt ? `· as at ${fmt(quota.asAt)}` : ''}
            </span>
          </h3>
          {quota.lines.slice(0, 6).map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.6rem', fontSize: '0.84rem',
                                  borderTop: i ? '1px solid var(--line)' : undefined, padding: '2px 0' }}>
              <span style={{ flex: 1 }}>{l.stock || l.species}</span>
              <span style={{ fontFamily: MONO }}>{l.remaining ?? l.balance ?? '—'}</span>
            </div>
          ))}
          <p className="muted" style={{ fontSize: '0.76rem', margin: '0.4rem 0 0' }}>
            The statement position only — trips landed since are not in it.{' '}
            <Link to="/quota">Quota</Link> adds them.
          </p>
        </div>
      )}

      {expiring.has && (
        <div className="card" style={{ borderLeft: '3px solid var(--brass)' }}>
          <h3 style={{ marginTop: 0 }}>Running out</h3>
          {expiring.items.slice(0, 6).map((e, i) => (
            <div key={i} style={{ fontSize: '0.84rem', padding: '1px 0' }}>
              <b>{e.what}</b> <span className="muted">· {e.who || e.category || ''}</span>{' '}
              {e.expiry_date < todayISO()
                ? <span style={{ color: 'var(--rust)' }}>expired {fmt(e.expiry_date)}</span>
                : <span>{fmt(e.expiry_date)}</span>}
            </div>
          ))}
        </div>
      )}

      {books.has && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Books</h3>
          {books.items.map((k) => (
            <div key={k.book} style={{ fontSize: '0.84rem', padding: '1px 0' }}>
              <b>{k.book}</b> —{' '}
              {/* NEVER WRITTEN IN IS NOT "N DAYS AGO", and reporting a number
                  there would invent a date the book does not have. */}
              {k.last == null
                ? <span className="muted">nothing in it yet</span>
                : <>last entry {fmt(k.last)}
                    {k.days > k.stale && <span style={{ color: 'var(--brass)' }}> · {k.days} days ago</span>}</>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function ToDo({ items }) {
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--hull)' }}>
      <h3 style={{ marginTop: 0 }}>What to do next</h3>
      {items.map((i) => (
        <div key={i.key} style={{ fontSize: '0.86rem', padding: '2px 0' }}>
          <span style={{ color: i.urgent ? 'var(--rust)' : undefined }}>{i.says}</span>{' '}
          <Link to={i.to}>open</Link>
        </div>
      ))}
    </div>
  )
}

/* SIX OF THIRTEEN FLEETS HAVE UPLOADED NOTHING, and they were opening the app
   on a blank page. The market band above fills it on its own; this says what
   would fill the rest. */
function FirstSteps() {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Nothing of your own on here yet</h3>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        The prices above are the market and are there whether you upload anything or not. These
        three fill in the rest of the page.
      </p>
      {FIRST_STEPS.map((s) => (
        <div key={s.to} style={{ fontSize: '0.86rem', padding: '2px 0' }}>
          <Link to={s.to}>{s.says}</Link> <span className="muted">— {s.then}</span>
        </div>
      ))}
    </div>
  )
}

function Toggle({ now, set, options }) {
  return (
    <span style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden' }}>
      {options.map(([k, label]) => (
        <button key={k} onClick={() => set?.(k)}
                style={{ border: 0, borderRadius: 0, fontSize: '0.74rem', padding: '0.15rem 0.5rem',
                         background: now === k ? 'var(--hull)' : 'transparent',
                         color: now === k ? '#fff' : undefined, cursor: 'pointer' }}>
          {label}
        </button>
      ))}
    </span>
  )
}

function Fig({ label, value, hint }) {
  return (
    <span>
      <span className="muted" style={{ fontSize: '0.72rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <b style={{ fontSize: '1.05rem', fontFamily: MONO }}>{value}</b>
      {hint && <span className="muted" style={{ fontSize: '0.72rem', display: 'block' }}>{hint}</span>}
    </span>
  )
}

/* How many days the average actually rests on, taken from the grades rather
   than assumed: a thin species may have far fewer than the window allows, and
   a header claiming 28 days over an average of three would be a quiet lie. */
function avgDays(row) {
  const ds = (row.grades || []).map((g) => g.days).filter((d) => d > 0)
  if (!ds.length) return 'the average'
  const most = Math.max(...ds)
  return most + '-day average'
}

const MONO = 'var(--mono, ui-monospace, monospace)'
const todayISO = () => new Date().toISOString().slice(0, 10)
const money = (n) => (n == null ? '—' : '£' + Number(n).toFixed(2))
const money0 = (n) => (n == null ? '—' : '£' + Math.round(Number(n)).toLocaleString('en-GB'))
const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
function pct(now, then) {
  if (!then) return ''
  const p = Math.round(((now - then) / then) * 100)
  return `${p >= 0 ? '+' : ''}${p}%`
}
