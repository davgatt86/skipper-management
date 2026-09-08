import React from 'react'
import { Link } from 'react-router-dom'
import { speciesBasis, boatBlocks, isNewBoat, FIRST_STEPS } from '../lib/dashboard'

/* THE FRONT PAGE, DRAWN — prices, your boat, what to do next.
 *
 * Prop-driven and a file of its own so it can be server-rendered. The dashboard
 * is behind a login and the interesting states are the empty ones: six of the
 * thirteen fleets have uploaded nothing at all, and until now they opened the
 * app on a blank page.
 *
 * EVERY STYLE IS A CLASS IN `index.css`, deliberately. The first cut was inline
 * styles, and all four faults David found came out of that: a table left to
 * size its own columns put a grade name a foot away from its price, and a
 * `background: transparent` button inherited `color: var(--on-navy)` off the
 * global cobalt button rule and turned white on white. Drawing it WITH the
 * design system rather than beside it is the fix.
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

/* ==== THE MARKET ========================================================== */

function Market({ board, species, landed, basis, onBasis, source, onSource }) {
  const basisOf = speciesBasis(landed, { basis })
  const from = Object.fromEntries(basisOf.map((x) => [x.species, x.from]))
  const port = source === 'DK' ? 'Denmark' : 'Peterhead'

  return (
    <section className="card">
      <div className="dash-head">
        <div>
          <h3>The market</h3>
          <p className="dash-when">
            {port} board{board?.day ? ' · ' + longDate(board.day) : ' · no prices yet'}
          </p>
        </div>
        <span className="dash-tools">
          <Seg now={source} set={onSource} options={[['PD', 'Peterhead'], ['DK', 'Denmark']]} />
          {/* THE TOGGLE ONLY CHANGES WHICH EXTRAS ARE PICKED. Cod, haddock and
              saithe are pinned either way — they are the market everyone
              watches, whatever a particular boat happens to land. */}
          <Seg now={basis} set={onBasis} options={[['value', 'By value'], ['volume', 'By volume']]} />
        </span>
      </div>

      {!board?.day ? (
        <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          No prices on the {port} board yet.
        </p>
      ) : (
        <>
          {/* A TILE PER SPECIES, NOT ONE WIDE TABLE. Four columns across the
              full width of a laptop left the grade name at the far left and its
              price at the far right with a foot of nothing between them — which
              is the "looks horrible" in one sentence. At 268px a grade and its
              price are an inch apart and the eye reads across. */}
          <div className="dash-grid">
            {board.rows.map((r) => (
              <SpeciesTile key={r.species} row={r} from={from[r.species]} />
            ))}
          </div>
          <p className="dash-foot">
            <b>Avg</b> is the day's average price a kilo. <b>Day</b> is the move against{' '}
            {board.previous ? shortDate(board.previous) : 'the day before'}; <b>4 wk</b> the move
            against the four weeks to {shortDate(board.day)}, not counting that day.
            Cod, haddock and saithe are on every boat's page — the rest are yours.
          </p>
        </>
      )}
    </section>
  )
}

function SpeciesTile({ row, from }) {
  /* GRADES THAT DID NOT SELL ARE NAMED, NOT GIVEN A LINE EACH. On a real board
     day a third of them have no price, and a row of four dashes says nothing
     the word "unsold" does not say better in a tenth of the space. They are
     still SAID — dropping them silently would look like the grade does not
     exist. */
  const sold = row.grades.filter((g) => g.ave != null)
  const unsold = row.grades.filter((g) => g.ave == null).map((g) => g.grade)

  return (
    <article className="sp">
      <div className="sp-h">
        <h4>{row.species}</h4>
        {/* A BOAT'S OWN TOP SPECIES AND A GENERAL GUESS MUST NOT READ ALIKE.
            Telling a skipper these are "his biggest" when they are what most
            boats land is the quiet lie this codebase keeps refusing to tell.
            The pinned three carry NO chip: three identical "watched by
            everyone" labels stacked down the page is noise, and the footnote
            says it once. */}
        {from === 'own' && <span className="chip">yours</span>}
        {from === 'typical' && <span className="chip guess">typical</span>}
      </div>

      {/* A SPECIES THE BOARD DOES NOT CARRY SAYS SO. Dropping it would read as
          the boat not landing it. */}
      {!row.onBoard ? (
        <p className="sp-nil sp-nil-top">
          Not on this board{row.boardName !== row.species ? ' — it calls it ' + row.boardName : ''}.
        </p>
      ) : (
        <>
          {sold.length > 0 && (
            <div className="sp-cols">
              <span>Grade</span><span>Avg</span><span>Day</span><span>4 wk</span>
            </div>
          )}
          {sold.map((g) => (
            <div className="sp-r" key={g.grade}>
              <span className="g" title={g.grade}>{g.grade}</span>
              <span className="v">{money(g.ave)}</span>
              <span className="d"><Move v={g.onDay} /></span>
              <span className="d"><Move v={g.onAvg} /></span>
            </div>
          ))}
          {unsold.length > 0 && <p className="sp-nil">{unsold.join(', ')} did not sell</p>}
          {sold.length === 0 && <p className="sp-nil">Nothing sold on the day</p>}
        </>
      )}
    </article>
  )
}

/* NULL IS NOT ZERO, and they must not look alike. A grade that did not sell has
   no move; a grade that sold at exactly yesterday's price moved by nothing, and
   that is a real and different fact. */
function Move({ v }) {
  if (v == null) return <span className="nil" title="no price to compare">·</span>
  if (v === 0) return <span className="flat" title="no change">0.00</span>
  return (
    <span className={v > 0 ? 'up' : 'dn'}>
      {v > 0 ? '+' : '−'}{Math.abs(v).toFixed(2)}
    </span>
  )
}

/* ==== YOUR BOAT =========================================================== */

function Boat({ blocks, canSeeMoney }) {
  const { lastTrip, month, quota, expiring, books } = blocks
  return (
    <>
      {lastTrip.has && canSeeMoney && (
        <section className="card">
          <div className="dash-head">
            <div>
              <h3>Last trip</h3>
              <p className="dash-when">
                {longDate(lastTrip.date)}{lastTrip.vessel ? ' · ' + lastTrip.vessel : ''}
              </p>
            </div>
          </div>
          <div className="stats">
            <Stat k="Gross" n={money0(lastTrip.gross)} />
            <Stat k="Boxes" n={lastTrip.boxes ?? '—'} />
            <Stat k="Kilos" n={lastTrip.kg == null ? '—' : Math.round(lastTrip.kg).toLocaleString('en-GB')} />
            <Stat k="A kilo" n={lastTrip.ppk == null ? '—' : money(lastTrip.ppk)} />
          </div>
          {/* A NOTE THAT DID NOT RECONCILE CANNOT BE TRUSTED FOR ITS FIGURES,
              and the front page is the worst place to print them silently. */}
          {lastTrip.reconciled === false && (
            <p className="dash-foot warn">
              This note did not add up to its own printed total, so these figures cannot be
              trusted. <Link to="/sales">Fish Sales</Link> says by how much.
            </p>
          )}
        </section>
      )}

      {month.has && canSeeMoney && (
        <section className="card">
          <div className="dash-head">
            <div>
              <h3>This month</h3>
              {/* WHICH DAYS, SAID PLAINLY. The comparison is the first N days
                  against the first N days, and a reader who assumed whole month
                  against whole month would read a half-finished month as a
                  collapse — which is exactly what the page did. */}
              <p className="dash-when">
                {monthName(month.month)} · to the {ordinal(month.through)}
              </p>
            </div>
          </div>
          <div className="stats">
            <Stat k="Gross" n={money0(month.gross)} />
            <Stat k="Trips" n={month.trips} />
            {/* NOTHING TO SOMETHING IS NOT A CHANGE. A boat in her first year
                gets the figure and no percentage. */}
            {month.lastYear != null && (
              <Stat k={'To the ' + ordinal(month.through) + ' last year'}
                    n={money0(month.lastYear)}
                    sub={month.lastYearTrips + ' trip' + (month.lastYearTrips === 1 ? '' : 's')}
                    delta={pct(month.gross, month.lastYear)} />
            )}
          </div>
          {month.lastYear != null && (
            <p className="dash-foot">
              The same days of the month either side, not the whole of it — the month is not
              finished.
            </p>
          )}
        </section>
      )}

      {quota.has && canSeeMoney && <Quota quota={quota} />}

      {expiring.has && (
        <section className="card accent-brass">
          <div className="dash-head"><div><h3>Running out</h3></div></div>
          <div className="dlist">
            {expiring.items.slice(0, 6).map((e, i) => (
              <div className="di" key={i}>
                <span>{e.what}{e.who ? <span className="sub3"> · {e.who}</span> : null}</span>
                <span className={'when ' + (e.expiry_date < todayISO() ? 'dn' : '')}>
                  {e.expiry_date < todayISO() ? 'expired ' : ''}{shortDate(e.expiry_date)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {books.has && (
        <section className="card">
          <div className="dash-head"><div><h3>Books</h3></div></div>
          <div className="dlist">
            {books.items.map((k) => (
              <div className="di" key={k.book}>
                <span>{k.book}</span>
                {/* NEVER WRITTEN IN IS NOT "N DAYS AGO", and reporting a number
                    there would invent a date the book does not have. */}
                {k.last == null
                  ? <span className="sub3">nothing in it yet</span>
                  : <span className={'when ' + (k.days > k.stale ? 'dn' : '')}>
                      {shortDate(k.last)}{k.days > k.stale ? ' · ' + k.days + ' days ago' : ''}
                    </span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

/* THE ONE LINE THAT MATTERS IS THE ONE THAT IS OVER, and it used to look
 * exactly like the five that were fine — a raw float, grey, at the far right:
 *
 *     NS Saithe    -86.54504
 *
 * Audacious is 86.5 t over on North Sea saithe, having caught 214.35 t against
 * an allocation of 127.80. Sorted by how much of the allocation is GONE rather
 * than by whatever order the rows arrived in, because a block listing the six
 * with the most left is a block showing the six that do not matter.
 */
function Quota({ quota }) {
  const lines = quotaRows(quota.lines).slice(0, 6)
  return (
    <section className="card">
      <div className="dash-head">
        <div>
          <h3>Quota</h3>
          <p className="dash-when">
            The statement{quota.asAt ? ' · as at ' + shortDate(quota.asAt) : ''} · tonnes
          </p>
        </div>
      </div>
      {lines.map((l) => (
        <div className={'qr ' + l.state} key={l.stock}>
          <span className="qn">
            {l.stock}
            {l.used != null && <span className="qp">{Math.round(l.used * 100)}% caught</span>}
          </span>
          <b className="qv">
            {l.balance == null ? '—'
              : l.balance < 0 ? tonnes(-l.balance) + ' over'
                : tonnes(l.balance) + ' left'}
          </b>
          {l.used != null && (
            <span className="qbar"><i style={{ width: Math.round(Math.min(100, l.used * 100)) + '%' }} /></span>
          )}
        </div>
      ))}
      <p className="dash-foot">
        The statement position only — trips landed since are not in it.{' '}
        <Link to="/quota">Quota</Link> adds them.
      </p>
    </section>
  )
}

/* `balance` is the column and `remaining` never existed, which is why the old
   row fell through to the next thing it tried. A line with no allocation on it
   is not scored at all — a blank is not a nought. */
export function quotaRows(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => {
      const alloc = numOrNull(l.allocation)
      const balance = numOrNull(l.balance ?? l.remaining)
      const caught = numOrNull(l.catch_total)
      const used = alloc > 0 && caught != null ? caught / alloc : null
      return {
        stock: l.stock || l.species || 'Unnamed', balance, used,
        state: balance != null && balance < 0 ? 'over'
          : used != null && used >= 0.85 ? 'tight' : '',
      }
    })
    .filter((l) => l.balance != null || l.used != null)
    .sort((a, b) => (b.used ?? -1) - (a.used ?? -1))
}

/* ==== WHAT TO DO NEXT ===================================================== */

function ToDo({ items }) {
  return (
    <section className="card accent-hull">
      <div className="dash-head"><div><h3>What to do next</h3></div></div>
      <div className="dlist">
        {items.map((i) => (
          <div className="di" key={i.key}>
            <span className={i.urgent ? 'dn' : undefined}>{i.says}</span>
            <Link to={i.to} className="when">open</Link>
          </div>
        ))}
      </div>
    </section>
  )
}

/* SIX OF THIRTEEN FLEETS HAVE UPLOADED NOTHING, and they were opening the app
   on a blank page. The market band above fills it on its own; this says what
   would fill the rest. */
function FirstSteps() {
  return (
    <section className="card accent-hull">
      <div className="dash-head"><div><h3>Nothing of your own on here yet</h3></div></div>
      <p className="muted dash-lead">
        The prices above are the market and are there whether you upload anything or not. These
        three fill in the rest of the page.
      </p>
      <div className="dlist">
        {FIRST_STEPS.map((s) => (
          <div className="di" key={s.to}>
            <span><Link to={s.to}>{s.says}</Link> <span className="sub3">— {s.then}</span></span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ==== bits ================================================================ */

function Seg({ now, set, options }) {
  return (
    <span className="seg">
      {options.map(([k, label]) => (
        <button key={k} type="button" className={now === k ? 'on' : undefined}
                onClick={() => set?.(k)}>{label}</button>
      ))}
    </span>
  )
}

function Stat({ k, n, sub, delta }) {
  return (
    <span className="stat">
      <span className="k">{k}</span>
      <b className="n">{n}</b>
      {(sub || delta) && (
        <span className="n2">
          {sub}{sub && delta ? ' · ' : ''}
          {delta ? <span className={delta.charAt(0) === '−' ? 'dn' : 'up'}>{delta}</span> : null}
        </span>
      )}
    </span>
  )
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const money = (n) => (n == null ? '—' : '£' + Number(n).toFixed(2))
const money0 = (n) => (n == null ? '—' : '£' + Math.round(Number(n)).toLocaleString('en-GB'))

/* RAW FLOATS OFF A NUMERIC COLUMN — "34.83933000000001" — were being printed
   straight onto the front page. One decimal is what the office works in. */
const tonnes = (n) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + ' t'
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const shortDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—')
function longDate(d) {
  const s = String(d || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—'
  return Number(s.slice(8)) + ' ' + MONTHS[Number(s.slice(5, 7)) - 1] + ' ' + s.slice(0, 4)
}
function monthName(m) {
  const s = String(m || '')
  return /^\d{4}-\d{2}$/.test(s) ? MONTHS[Number(s.slice(5, 7)) - 1] + ' ' + s.slice(0, 4) : ''
}

/* "to the 8th", not "to day 8" — the card is read on a boat, not in a report. */
function ordinal(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  const t = v % 100
  const suf = (t >= 11 && t <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')
  return v + suf
}

function pct(now, then) {
  if (!then) return ''
  const p = Math.round(((now - then) / then) * 100)
  return (p >= 0 ? '+' : '−') + Math.abs(p) + '%'
}
