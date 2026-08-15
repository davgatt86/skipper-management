import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { TOP_ROW, BOTTOM_ROW } from '../lib/market/layoutRules'
import {
  sheetPages, assignColours, dayInk, shortSpecies, gradeName, gradeCode,
} from '../lib/market/sheet'

/* The chalk sheet: the layout as something you can print and take to market.
 *
 * Everything here is sized in MILLIMETRES rather than pixels, because the only
 * output that matters is the printed page — what is on screen is a preview of
 * it, not the other way round. A4 portrait, 6mm margins, ten tiers to a page.
 *
 * It renders through a portal onto document.body so that printing can hide the
 * whole app in one rule instead of chasing the sidebar and every card.
 */

/* mm per footprint down the column. Set by the page, not by taste: 47
 * footprints plus the tier head, the walkway, the page head and the legend
 * have to come in under A4's 285mm of usable height, or the last page spills
 * onto a second sheet with three columns on it. Measured at 5.6 and it did. */
const UNIT = 5.2
const TOP_MM = TOP_ROW * UNIT
const BOTTOM_MM = BOTTOM_ROW * UNIT

export default function MarketSheet({ plan, meta, onClose }) {
  if (!plan) return null
  return createPortal(<SheetBody plan={plan} meta={meta} onClose={onClose} />, document.body)
}

/* Split out from the portal for two reasons: the layout page embeds it, so
 * what is on screen IS the sheet rather than a second drawing of the same
 * thing that can drift from it; and scripts/sheet-preview.mjs server-renders
 * it, which is how the printed page gets checked against a real tally without
 * going through a login. */
export function SheetBody({ plan, meta, onClose, embedded, onPrint }) {
  const pages = useMemo(() => sheetPages(plan, 10), [plan])
  const colours = useMemo(() => assignColours(pages), [pages])
  if (!plan || !pages.length) return null

  return (
    <div className={`msheet${embedded ? ' is-embedded' : ''}`}>
      {/* dangerouslySetInnerHTML, not children: React escapes text children,
          so a `>` in a selector renders as `&gt;` and the browser drops the
          whole rule. It silently took out the one that hides the app when
          printing, which is not a failure you would notice until a sheet came
          off the printer with a sidebar down the side of it. */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="msheet-bar no-print">
        <strong>Chalk sheet</strong>
        <span className="msheet-bar-note">
          {plan.tiers} tiers over {pages.length} {pages.length === 1 ? 'page' : 'pages'} · A4 portrait
        </span>
        {/* Embedded, this opens the full-screen copy and prints from there.
            It has to: printing hides #root so the page's sidebar and cards do
            not come out with the sheet, and the embedded sheet is INSIDE
            #root — printing it in place gives a blank page. Showing the pages
            full screen before printing is the better order anyway. */}
        <button onClick={onPrint || (() => window.print())}>
          {onPrint ? '🖨 Print sheet' : '🖨 Print'}
        </button>
        {onClose && <button className="secondary" onClick={onClose}>Close</button>}
      </div>

      <div className="msheet-scroll">
        {pages.map((page, pi) => (
          <div className="msheet-page" key={pi}>
            <div className="msheet-head">
              <div>
                <strong>{meta?.vessel || 'Market layout'}</strong>
                <span className="msheet-sub">
                  {meta?.port || 'Peterhead'} · tiers {page.from}–{page.to} · {plan.totalBoxes} boxes
                </span>
              </div>
              <div className="msheet-sub">page {pi + 1} of {pages.length}</div>
            </div>

            <div className="msheet-cols">
              {page.columns.map((col) => (
                <div className="msheet-col" key={col.tier}>
                  <div className="msheet-tier">{col.tier}</div>
                  <Band runs={col.top} slots={TOP_ROW} mm={TOP_MM} colours={colours} label="TOP" />
                  <div className="msheet-walk"><span>walkway</span></div>
                  <Band runs={col.bottom} slots={BOTTOM_ROW} mm={BOTTOM_MM} colours={colours} label="BOT" />
                </div>
              ))}
              {/* Keep the last page's columns the same width as a full one, so
                  a short page prints to the same scale as the rest. */}
              {Array.from({ length: 10 - page.columns.length }).map((_, i) => (
                <div className="msheet-col msheet-col-empty" key={`pad${i}`} />
              ))}
            </div>

            {/* On every page, not just the last. A man holding page 2 on the
                market should not have to go back to page 1 to find out what
                the blue block is. */}
            <Legend colours={colours} plan={plan} last={pi === pages.length - 1} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* One row of a tier, drawn down the column. The grid is one track per
 * footprint, so a block's height IS its footprint count and the same
 * horizontal line means the same depth in every tier across the page. */
function Band({ runs, slots, mm, colours, label }) {
  const used = runs.reduce((s, r) => s + r.footprints, 0)
  return (
    <div className="msheet-band" style={{ height: `${mm}mm`, gridTemplateRows: `repeat(${slots}, 1fr)` }}>
      <div className="msheet-band-tag">{label}</div>
      {runs.map((r, i) => {
        const st = colours.styleFor(r.species, r.grade)
        const n = r.footprints
        /* Every block says the same five things in the same order, whatever
         * its size — what fish, which grade (NAME AND CODE, since the tally
         * uses both and neither on its own identifies a grade), which day
         * tag, how many boxes, and how high it is stacked.
         *
         * Only the type scale changes with the block. A one-footprint block
         * is 5.2mm and gets two tight lines rather than one crowded one;
         * dropping a field instead would mean the sheet says different things
         * in different places, which is worse than small type. */
        const code = gradeCode(r.grade)
        return (
          <div key={i}
               className={`msheet-blk${r.newSpecies ? ' is-species' : r.newGrade ? ' is-grade' : ''}${r.newDay ? ' is-day' : ''}`}
               // Hover on screen, and the handle the layout check uses to tell
               // two blocks apart.
               title={`${r.species} ${r.grade} — day ${r.days.join('/')} — ${r.boxes} boxes, ${r.footprints} footprint${r.footprints === 1 ? '' : 's'}, ${r.height > 1 ? `${r.height} high` : 'flat'}`}
               data-fish={`${r.species}||${r.grade}`}
               style={{
                 gridRow: `span ${n}`, background: st.fill, borderLeftColor: st.edge,
                 // Same fish, new tag: a hairline in the tag's own colour. It
                 // happens on two blocks in three, so it has to be quiet.
                 ...(r.newDay ? { borderTopColor: dayInk(r.days[0]) } : null),
               }}>
            <div className={`msheet-blk-in${n === 1 ? ' is-1' : n === 2 ? ' is-2' : ''}`}>
              <span className="msheet-name">
                <span className="msheet-sp">{shortSpecies(r.species)}</span>
                <span className="msheet-gr">{gradeName(r.grade)}</span>
                {code && <span className="msheet-code">{code}</span>}
              </span>
              <span className="msheet-meta">
                <span className="msheet-day" style={{ background: dayInk(r.days[0]) }}>
                  {r.days.length > 1 ? r.days.join('/') : r.days[0]}
                </span>
                <span className="msheet-n">{r.boxes}</span>
                {/* How high it goes. Flat is the one that matters most on the
                    floor, so it gets the word and the heaviest chip. */}
                <span className={`msheet-hi h${r.height}`}>{r.height > 1 ? `${r.height}HI` : 'FLAT'}</span>
              </span>
            </div>
          </div>
        )
      })}
      {used < slots && (
        <div className="msheet-blk msheet-spare" style={{ gridRow: `span ${slots - used}` }}>
          <span>spare {slots - used}</span>
        </div>
      )}
    </div>
  )
}

function Legend({ colours, plan, last }) {
  return (
    <div className="msheet-legend">
      <div className="msheet-legend-row">
        {colours.species.map((sp) => {
          const st = colours.styleFor(sp, '')
          return (
            <span className="msheet-key" key={sp}>
              <i style={{ background: st.fill, borderColor: st.edge }} />
              {sp}
            </span>
          )
        })}
      </div>
      <div className="msheet-legend-note">
        <span className="msheet-legend-keys">
          <span><b className="msheet-hi h1">FLAT</b> one box high</span>
          <span><b className="msheet-hi h2">2HI</b> two</span>
          <span><b className="msheet-hi h3">3HI</b> three</span>
          <span><b className="msheet-hi h4">4HI</b> four</span>
        </span>
        Each block reads <b>species · grade · code</b> on the top line and <b>day tag · boxes ·
        height</b> on the bottom. Heavy rule = new species · medium rule = new grade · coloured
        rule and tab = new day tag · the shade alternates with each grade down a species.
        {last && plan.lowered?.length > 0 && (
          <> Laid lower than the guideline to use the spare room:{' '}
            {plan.lowered.map((l) => `${l.species} ${gradeName(l.grade)} ${gradeCode(l.grade) ? `(${gradeCode(l.grade)}) ` : ''}${l.from}→${l.to}`).join(', ')}.</>
        )}
      </div>
    </div>
  )
}

const CSS = `
.msheet {
  position: fixed; inset: 0; z-index: 9000; background: #fff; color: #111;
  display: flex; flex-direction: column;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
}
.msheet-bar {
  display: flex; align-items: center; gap: .75rem;
  padding: .6rem 1rem; border-bottom: 1px solid #ccc; background: #f4f5f6; flex: 0 0 auto;
}
.msheet-bar-note { color: #666; font-size: .85rem; margin-right: auto; }
.msheet-scroll { flex: 1 1 auto; overflow: auto; padding: 6mm; background: #e9eaec; }

/* Embedded on the layout page, the sheet IS the screen view — same component,
   same geometry, so what is looked at is what gets printed. It sits in the
   page flow instead of covering it, and the page is allowed to scroll
   sideways on a phone rather than shrinking the sheet to illegibility. */
.msheet.is-embedded { position: static; inset: auto; z-index: auto; background: transparent; }
.msheet.is-embedded .msheet-bar { border: 1px solid var(--border); border-radius: 6px 6px 0 0; background: var(--card, #f4f5f6); }
.msheet.is-embedded .msheet-scroll { padding: 4mm; border: 1px solid var(--border); border-top: none; border-radius: 0 0 6px 6px; max-height: 80vh; }
.msheet.is-embedded .msheet-page { margin-bottom: 4mm; }

.msheet-page {
  width: 198mm; background: #fff; margin: 0 auto 8mm; padding: 0;
  box-shadow: 0 1px 6px rgba(0,0,0,.2);
}
.msheet-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 0 0 1.5mm; border-bottom: .6mm solid #111; margin-bottom: 1.5mm;
  font-size: 3.4mm;
}
.msheet-sub { color: #555; font-size: 2.8mm; margin-left: 2mm; }

.msheet-cols { display: flex; gap: .8mm; align-items: flex-start; }
.msheet-col { flex: 1 1 0; min-width: 0; }
.msheet-col-empty { visibility: hidden; }
.msheet-tier {
  text-align: center; font-weight: 700; font-size: 4mm; line-height: 6mm;
  border: .4mm solid #111; border-bottom: none; background: #111; color: #fff;
  font-family: 'Big Shoulders Display', Impact, sans-serif; letter-spacing: .04em;
}

.msheet-band {
  display: grid; border: .4mm solid #111; position: relative; overflow: hidden;
}
.msheet-band-tag {
  position: absolute; top: 0; right: 0; font-size: 1.9mm; letter-spacing: .05em;
  background: #111; color: #fff; padding: 0 .6mm; z-index: 2; line-height: 2.6mm;
}
.msheet-walk {
  height: 4mm; display: flex; align-items: center; justify-content: center;
  background: repeating-linear-gradient(90deg, #111 0 1.2mm, transparent 1.2mm 2.4mm);
}
.msheet-walk span {
  font-size: 1.9mm; letter-spacing: .08em; text-transform: uppercase;
  background: #fff; padding: 0 1mm; color: #444;
}

.msheet-blk {
  border-top: .2mm solid rgba(0,0,0,.2);
  border-left: .9mm solid transparent;
  overflow: hidden; min-height: 0;
}
/* Three boundaries, three weights, in the order they matter.
   A new species is the heaviest mark on the sheet because getting that wrong
   sends a buyer to the wrong fish; a new grade is next; a new day tag inside
   one grade is a hairline in the tag's own colour, because it happens on two
   blocks in three and anything louder would drown the other two out. */
.msheet-blk.is-species { border-top: .8mm solid #111; }
.msheet-blk.is-grade   { border-top: .4mm solid rgba(0,0,0,.7); }
.msheet-blk.is-day     { border-top-width: .45mm; border-top-style: solid; }

.msheet-blk-in {
  padding: .5mm .7mm; display: flex; flex-direction: column; gap: .3mm;
  height: 100%; line-height: 1.05; overflow: hidden;
}
/* Two tight lines rather than one crowded one, so a single-footprint block
   still says all five things. Type shrinks; nothing is dropped. */
.msheet-blk-in.is-1 { padding: .15mm .5mm; gap: 0; justify-content: center; }
.msheet-blk-in.is-1 .msheet-sp   { font-size: 2mm; }
.msheet-blk-in.is-1 .msheet-gr   { font-size: 1.85mm; }
.msheet-blk-in.is-1 .msheet-code,
.msheet-blk-in.is-1 .msheet-n    { font-size: 1.75mm; }
.msheet-blk-in.is-1 .msheet-day  { font-size: 1.75mm; line-height: 2.4mm; padding: 0 .5mm; }
.msheet-blk-in.is-1 .msheet-hi   { font-size: 1.7mm; line-height: 2.4mm; padding: 0 .5mm; }
.msheet-blk-in.is-2 .msheet-sp   { font-size: 2.3mm; }
.msheet-blk-in.is-2 .msheet-gr   { font-size: 2mm; }

/* Line 1 — what fish and which grade, name AND code. The tally uses both and
   neither identifies a grade on its own: Seed (2a) and Chipper (2b) are the
   same size band, and "Large" is four different fish. */
.msheet-name {
  display: flex; align-items: baseline; gap: .6mm;
  white-space: nowrap; overflow: hidden; min-width: 0;
}
.msheet-sp { font-weight: 800; font-size: 2.5mm; letter-spacing: .02em; flex: 0 0 auto; }
.msheet-gr { font-size: 2.1mm; overflow: hidden; text-overflow: ellipsis; }
.msheet-code {
  font-size: 1.9mm; color: #333; font-family: 'IBM Plex Mono', monospace;
  flex: 0 0 auto; margin-left: auto;
}

/* Line 2 — tag, count, height. Always these three, always this order, so the
   eye finds the same thing in the same place down a 47-deep column. */
.msheet-meta {
  display: flex; align-items: center; gap: .7mm; margin-top: auto;
  flex-wrap: nowrap; white-space: nowrap; overflow: hidden;
}
.msheet-day {
  color: #fff; font-weight: 700; font-size: 2mm; border-radius: .6mm;
  padding: 0 .8mm; line-height: 2.9mm; flex: 0 0 auto;
}
.msheet-n {
  font-family: 'IBM Plex Mono', monospace; font-size: 2mm; font-weight: 700;
  flex: 0 0 auto;
}
/* How high it is stacked, which was the thing you could not tell at a glance.
   FLAT gets the word and the heaviest chip because it is the one that matters:
   it is the dear fish, and it is the row you must not stack on. */
.msheet-hi {
  font-family: 'IBM Plex Mono', monospace; font-size: 1.9mm; font-weight: 700;
  line-height: 2.9mm; padding: 0 .7mm; border-radius: .6mm; margin-left: auto;
  flex: 0 0 auto; border: .2mm solid #111;
}
.msheet-hi.h1 { background: #111; color: #fff; }          /* flat */
.msheet-hi.h2 { background: #fff; color: #111; }
.msheet-hi.h3 { background: #fff; color: #111; border-style: dashed; }
.msheet-hi.h4 { background: transparent; color: #111; border-style: dotted; }

.msheet-spare {
  background: repeating-linear-gradient(45deg, #f4f4f4 0 1.5mm, #e8e8e8 1.5mm 3mm);
  display: flex; align-items: center; justify-content: center;
  font-size: 2.2mm; color: #777;
}

.msheet-legend { margin-top: 1.4mm; border-top: .4mm solid #111; padding-top: 1mm; }
.msheet-legend-row { display: flex; flex-wrap: wrap; gap: .5mm 2.6mm; }
.msheet-key { display: inline-flex; align-items: center; gap: 1mm; font-size: 2.4mm; }
.msheet-key i {
  width: 3.6mm; height: 2.6mm; border: .4mm solid; border-radius: .5mm; display: inline-block;
}
.msheet-legend-note { margin-top: .8mm; font-size: 2.15mm; color: #444; line-height: 1.25; }
.msheet-legend-keys { display: inline-flex; flex-wrap: wrap; gap: .5mm 2.4mm; margin-right: 2.4mm; }
.msheet-legend-keys span { display: inline-flex; align-items: center; gap: .8mm; }
.msheet-legend-keys .msheet-hi { margin-left: 0; font-size: 1.9mm; line-height: 2.7mm; }

@media print {
  @page { size: A4 portrait; margin: 6mm; }
  html, body { background: #fff !important; }
  body > #root { display: none !important; }
  .no-print { display: none !important; }
  /* Belt and braces: if an embedded sheet is ever on screen at print time it
     is inside #root and already hidden, but say so rather than rely on it. */
  .msheet.is-embedded { display: none !important; }
  .msheet { position: static !important; inset: auto !important; }
  .msheet-scroll { overflow: visible !important; padding: 0 !important; background: #fff !important; }
  .msheet-page {
    width: auto !important; margin: 0 !important; box-shadow: none !important;
    break-after: page; page-break-after: always;
  }
  .msheet-page:last-child { break-after: auto; page-break-after: auto; }
  /* Chrome and Safari drop background fills when printing unless told not to,
     which would take every colour off the sheet — the whole point of it. */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`
