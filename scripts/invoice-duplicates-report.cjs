const fs = require('fs')

const rows = [
["Inverboyndie Trawls LLP","INV-0114","2023-05-19",34971.60,3,"06 Jun 2023 | 13 Jun 2023 | 19 Jun 2023","gear"],
["Inverboyndie Trawls LLP","INV-0003","2022-08-29",28261.31,2,"12 Sep 2022 | 13 Oct 2022","gear"],
["Peterhead Port Authority","0000155247","2022-08-31",15634.65,2,"05 Sep 2022 | 12 Sep 2022","harbour"],
["Aberdeen Fish Producers Organisation (AFPO)","2014","2026-05-13",14844.60,2,"18 May 2026 | 01 Jun 2026","quota"],
["Inverboyndie Trawls LLP","INV-0019","2022-11-11",14700.00,2,"13 Dec 2022 | 02 Sep 2026","gear"],
["J.C Hydraulics Ltd","9944","2022-04-14",11370.90,2,"15 Aug 2022 | 24 Aug 2022","hydraulics"],
["Finning (UK) Ltd","PINV8883049","2022-08-31",9727.39,2,"05 Sep 2022 | 12 Sep 2022","engine"],
["Peterhead Marine Electrics Ltd","INV65774","2023-09-30",8672.84,2,"06 Nov 2023 | 06 Nov 2023","electrical"],
["Macduff Ship Design Limited","INV-0098","2022-11-30",7200.00,2,"13 Dec 2022 | 02 Sep 2026","safety"],
["Jackson Trawls Ltd","TPSI004203","2021-10-04",6534.00,2,"25 Oct 2021 | 01 Nov 2021","gear"],
["Woodsons of Aberdeen Ltd Marine Electronics","219877","2024-05-01",5747.40,2,"06 May 2024 | 06 May 2024","electronics"],
["Strachan Nets Limited","INV-17508","2021-09-30",5500.00,2,"18 Oct 2021 | 21 Oct 2021","gear"],
["Jackson Trawls Ltd","TPSI028816","2026-07-15",5200.00,2,"20 Jul 2026","gear"],
["Jackson Trawls Ltd","35431","2019-01-15",5001.00,2,"07 Mar 2019 | 19 Mar 2019","gear"],
["Woodsons of Aberdeen Ltd Marine Electronics","202201","2021-10-18",2129.40,2,"25 Oct 2021 | 01 Nov 2021","electronics"],
["Scanmar","UK-2110213","2021-10-06",2116.80,2,"18 Oct 2021 | 21 Oct 2021","electronics"],
["Jackson Trawls Ltd","TPSI004244","2021-10-18",1892.59,2,"25 Oct 2021 | 01 Nov 2021","gear"],
["Jackson Trawls Ltd","TPSI009116","2022-08-24",1760.00,2,"05 Sep 2022 | 12 Sep 2022","gear"],
["Jackson Trawls Ltd","35265","2018-12-31",1585.00,2,"17 Jan 2019 | 25 Jan 2019","gear"],
["NU Design Ltd","22062","2022-11-30",1531.20,2,"13 Dec 2022 | 02 Sep 2026","electrical"],
["Jackson Trawls Ltd","TPSI004176","2021-10-05",1352.35,2,"25 Oct 2021 | 01 Nov 2021","gear"],
["Seagate Fabrication Ltd","22883","2026-07-16",1272.25,2,"20 Jul 2026","shipyard"],
["Ocean Safety Ltd","417127","2021-10-12",1188.00,2,"18 Oct 2021 | 21 Oct 2021","safety"],
["Blue Anchor Fire & Safety Limited","48201","2021-10-18",1188.00,2,"25 Oct 2021 | 01 Nov 2021","safety"],
["Woodsons of Aberdeen Ltd Marine Electronics","215783","2023-10-01",1180.00,2,"09 Oct 2023 | 16 Oct 2023","electronics"],
["Alexander Paterson","2847","2019-01-08",1151.40,2,"17 Jan 2019 | 25 Jan 2019","chandlery"],
["Jackson Trawls Ltd","35461","2019-01-21",1062.60,2,"07 Mar 2019 | 19 Mar 2019","gear"],
["Jackson Trawls Ltd","TPSI009194","2022-08-30",978.00,2,"05 Sep 2022 | 12 Sep 2022","gear"],
["SM Electrical & Automation Limited","INV-0306","2021-10-11",918.24,2,"18 Oct 2021 | 21 Oct 2021","electrical"],
["Macduff Shipyards Ltd","38276","2022-11-29",894.05,2,"13 Dec 2022 | 02 Sep 2026","shipyard"],
["Seagate Fabrication Ltd","17258","2022-09-01",854.14,2,"05 Sep 2022 | 12 Sep 2022","shipyard"],
["I&K Supplies Ltd","34617","2022-11-30",806.70,2,"13 Dec 2022 | 02 Sep 2026","chandlery"],
["Buchan Power Tools","205875","2021-01-19",804.60,2,"25 Jan 2021 | 01 Feb 2021","tools"],
["Ironside & Son","1055","2022-08-18",720.00,2,"05 Sep 2022 | 12 Sep 2022","freight"],
["Jackson Trawls Ltd","35427","2019-01-14",690.00,2,"07 Mar 2019 | 19 Mar 2019","gear"],
["Ironside & Son","1223","2022-10-11",630.00,2,"13 Dec 2022 | 02 Sep 2026","freight"],
["Premier Refrigeration Ltd","115214","2022-08-24",623.85,2,"05 Sep 2022 | 12 Sep 2022","refrig"],
["Jackson Trawls Ltd","35486","2019-01-28",568.70,2,"07 Mar 2019 | 19 Mar 2019","gear"],
["Malahide Filter Services Ltd","13723","2021-10-18",503.56,2,"25 Oct 2021 | 01 Nov 2021","filters"],
["Aberdeen Fish Producers Organisation (AFPO)","2042","2026-07-15",437.40,2,"20 Jul 2026","quota"],
["Ocean Safety Ltd","417137","2021-10-12",407.40,2,"18 Oct 2021 | 21 Oct 2021","safety"],
["I&K Supplies Ltd","27395","2018-12-31",250.92,2,"17 Jan 2019 | 25 Jan 2019","chandlery"],
["Scanmar","UK-2110221","2021-10-07",242.40,2,"25 Oct 2021 | 01 Nov 2021","electronics"],
["Jackson Trawls Ltd","35300","2018-12-06",241.22,2,"17 Jan 2019 | 25 Jan 2019","gear"],
["Blue Anchor Fire & Safety Limited","47897","2021-10-08",237.50,2,"18 Oct 2021 | 21 Oct 2021","safety"],
["John A Smith & Sons","0000820305","2026-07-10",218.40,2,"20 Jul 2026","chandlery"],
["N.E.F.T.A. Limited","2075/2022","2022-08-23",140.00,2,"05 Sep 2022 | 12 Sep 2022","training"],
["Jackson Trawls Ltd","35435","2019-01-15",135.00,2,"07 Mar 2019 | 19 Mar 2019","gear"],
["Buchan Power Tools","182829","2018-12-18",122.40,2,"17 Jan 2019 | 25 Jan 2019","tools"],
["Strachan Nets Limited","INV-17580","2021-10-15",112.00,2,"25 Oct 2021 | 01 Nov 2021","gear"],
["Seagate Fabrication Ltd","17654","2022-12-06",104.00,2,"13 Dec 2022 | 02 Sep 2026","shipyard"],
["Woodsons of Aberdeen Ltd Marine Electronics","181412","2019-01-04",90.73,2,"17 Jan 2019 | 25 Jan 2019","electronics"],
["Cromwell","0054068040","2018-12-14",89.99,2,"17 Jan 2019 | 25 Jan 2019","tools"],
["John A Smith & Sons","0000543559","2018-12-21",84.32,2,"17 Jan 2019 | 25 Jan 2019","chandlery"],
["Westfield Motors Peterhead Ltd","I081309","2018-12-17",83.40,2,"17 Jan 2019 | 25 Jan 2019","vehicle"],
["Macduff Shipyards Ltd","MCS12393","2022-12-02",66.00,2,"13 Dec 2022 | 02 Sep 2026","shipyard"],
["Palace Hotel Ltd","21172186","2021-10-13",65.00,2,"18 Oct 2021 | 21 Oct 2021","travel"],
["Caley Fisheries Limited","101609","2021-01-19",58.56,2,"25 Jan 2021 | 01 Feb 2021","chandlery"],
["R.D. Downie Ltd","75240","2022-08-31",57.00,2,"05 Sep 2022 | 12 Sep 2022","electrical"],
["Malahide Filter Services Ltd","13692","2021-10-08",33.60,2,"18 Oct 2021 | 21 Oct 2021","filters"],
]

/* THREE CAUSES, and they are not the same decision.
 *
 *   upload   one PDF put in twice during the bulk load — 2022-12-13, identical
 *            byte size and page count under two names. That is mine, and the
 *            whole extra bundle can go.
 *   read     one bundle where the reader returned the same invoice twice.
 *   office   the approval run re-sending an unapproved invoice next week. */
const causeOf = (bundles) => {
  if (bundles.includes('02 Sep 2026')) return 'upload'
  const parts = bundles.split(' | ')
  if (parts.length < 2 || new Set(parts).size === 1) return 'read'
  return 'office'
}

const LABEL = {
  upload: 'The 13 Dec 2022 bundle was uploaded twice',
  read: 'One bundle, the reader saw it twice',
  office: 'The office re-sent it in a later bundle',
}
const NOTE = {
  upload: 'Identical file, 8 pages, 1,289,916 bytes, under two names — one with the date prefix the Gmail script adds and one without. Mine, from the bulk load. The whole second bundle can go.',
  read: 'Both copies came off the same scan. Nothing to do with the office.',
  office: 'Denise re-sends an invoice in the following week&rsquo;s approval bundle until it has been signed off, so the same cost arrives twice or three times. This is most of it.',
}

const money = (n) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const items = rows.map(([firm, no, dated, total, copies, bundles, cat]) =>
  ({ firm, no, dated, total, copies, bundles, cat, cause: causeOf(bundles), excess: total * (copies - 1) }))

/* The uploaded copy is GONE — removed 04-09-2026, the whole bundle and its
   eight invoices. It stays out of the table because this list is what is left
   to decide, not a history of what has been done. */
const DONE = new Set(['upload'])
const groups = ['read', 'office'].map((k) => ({
  key: k,
  rows: items.filter((i) => i.cause === k).sort((a, b) => b.excess - a.excess),
})).filter((g) => g.rows.length)

const removed = items.filter((i) => DONE.has(i.cause))
const left = items.filter((i) => !DONE.has(i.cause))
const grand = left.reduce((t, i) => t + i.excess, 0)
const goneValue = removed.reduce((t, i) => t + i.excess, 0)
const extraRows = left.reduce((t, i) => t + (i.copies - 1), 0)

const byYear = {}
for (const i of left) {
  const y = i.dated.slice(0, 4)
  byYear[y] = (byYear[y] || 0) + i.excess
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

const table = (g) => `
  <section>
    <h2>${LABEL[g.key]}
      <span class="n">${g.rows.length} invoice${g.rows.length === 1 ? '' : 's'} ·
      ${money(g.rows.reduce((t, r) => t + r.excess, 0))}</span></h2>
    <p class="note">${NOTE[g.key]}</p>
    <table>
      <thead><tr>
        <th>Firm</th><th>Invoice</th><th>Dated</th><th class="r">Each</th>
        <th class="c">Copies</th><th class="r">Counted twice</th><th>In the bundles of</th>
      </tr></thead>
      <tbody>
        ${g.rows.map((r) => `<tr>
          <td>${esc(r.firm)}<span class="cat">${esc(r.cat)}</span></td>
          <td class="m">${esc(r.no)}</td>
          <td class="m">${r.dated}</td>
          <td class="r m">${money(r.total)}</td>
          <td class="c${r.copies > 2 ? ' three' : ''}">${r.copies}</td>
          <td class="r m b">${money(r.excess)}</td>
          <td class="m sm">${esc(r.bundles)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>`

fs.writeFileSync('invoice-duplicates.html', `<!doctype html><meta charset="utf-8">
<title>Invoices counted twice</title>
<style>
  :root { --ink:#0A1D26; --hull:#1749A8; --paper:#ECEFEE; --line:#d7dcda; --mute:#5d6b70;
          --brass:#A97614; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  * { box-sizing: border-box }
  body { font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper);
         margin: 0; padding: 2rem 1.25rem 4rem }
  .wrap { max-width: 62rem; margin: 0 auto }
  h1 { font-size: 1.5rem; margin: 0 0 .2rem; letter-spacing: -.01em }
  .lede { color: var(--mute); margin: 0 0 1.5rem; max-width: 44rem }
  .heads { display: flex; gap: 2.2rem; flex-wrap: wrap; background: #fff; border: 1px solid var(--line);
           border-radius: 6px; padding: 1rem 1.2rem; margin-bottom: 1.4rem }
  .heads div span { display:block; font-size:.7rem; text-transform:uppercase; letter-spacing:.07em;
                    color: var(--mute) }
  .heads div b { font-family: var(--mono); font-size: 1.5rem; font-weight: 700 }
  section { background:#fff; border:1px solid var(--line); border-radius:6px; padding:1rem 1.2rem;
            margin-bottom:1.1rem }
  h2 { font-size:1rem; margin:0 0 .1rem; display:flex; gap:.7rem; align-items:baseline; flex-wrap:wrap }
  h2 .n { font-family:var(--mono); font-weight:400; font-size:.85rem; color:var(--mute) }
  .note { color:var(--mute); font-size:.84rem; margin:.1rem 0 .8rem; max-width:46rem }
  table { width:100%; border-collapse:collapse; font-size:.85rem }
  th { text-align:left; font-size:.72rem; text-transform:uppercase; letter-spacing:.05em;
       color:var(--mute); font-weight:600; padding:.3rem .4rem; border-bottom:1px solid var(--line) }
  td { padding:.34rem .4rem; border-bottom:1px solid var(--line); vertical-align:top }
  tr:last-child td { border-bottom:0 }
  .m { font-family:var(--mono) } .r { text-align:right } .c { text-align:center }
  .b { font-weight:700 } .sm { font-size:.76rem; color:var(--mute) }
  .cat { display:block; font-size:.7rem; color:var(--mute) }
  .three { color:#fff; background:var(--brass); border-radius:3px; font-weight:700 }
  .years { display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.4rem }
  .years b { font-family:var(--mono) }
  .years span { border:1px solid var(--line); border-radius:4px; padding:.2rem .5rem; font-size:.8rem }
  .done { background:#fff; border:1px solid var(--line); border-left:3px solid var(--hull);
          border-radius:4px; padding:.7rem .9rem; color:var(--ink); font-size:.86rem;
          max-width:46rem }
  footer { color:var(--mute); font-size:.8rem; margin-top:1.4rem; max-width:46rem }
  @media print { body { background:#fff; padding:0 } section, .heads { border:0; padding:0 } }
</style>
<div class="wrap">
  <h1>Invoices counted twice</h1>
  <p class="lede">Every invoice still in the record that appears more than once under the
     same firm, the same number, the same date and the same amount. Nothing in this table
     has been changed &mdash; it is a list to decide, not a list of things done.</p>
  <p class="lede done"><b>Already removed.</b> The bundle of 13 Dec 2022 had been uploaded
     twice during the bulk load, the second time without the date prefix the Gmail
     extraction adds. Identical file &mdash; 8 pages, 1,289,916 bytes, the same 8 invoices,
     nothing unique to either side. That copy and its invoices went on 4 September 2026,
     worth ${money(goneValue)}.</p>

  <div class="heads">
    <div><span>Counted twice</span><b>${money(grand)}</b></div>
    <div><span>Invoices</span><b>${extraRows}</b></div>
    <div><span>Groups</span><b>${left.length}</b></div>
    <div><span>Record now</span><b>£7,884,406</b></div>
    <div><span>Record after</span><b>${'£' + Math.round(7884406 - grand).toLocaleString('en-GB')}</b></div>
  </div>

  <section>
    <h2>By the year the invoice is dated</h2>
    <div class="years">
      ${Object.keys(byYear).sort().map((y) =>
        `<span>${y} <b>${money(byYear[y])}</b></span>`).join('')}
    </div>
    <p class="note">2020 and 2025 have none at all.</p>
  </section>

  ${groups.map(table).join('')}

  <footer>
    An invoice with no number is not in this list &mdash; it cannot be matched this way, and
    guessing from the amount and date would catch every routine repeat order.
    Eleven more share a firm and number but not an amount; reading their descriptions they are
    one invoice split across pages rather than duplicates, so the money is probably right and
    only the count is inflated. They are deliberately not here.
  </footer>
</div>`)

console.log('invoice-duplicates.html')
console.log('  ' + left.length + ' groups left · ' + extraRows + ' rows · ' + money(grand)
  + '   (already removed: ' + money(goneValue) + ')')
for (const g of groups) {
  console.log('  ' + g.key.padEnd(7) + ' ' + String(g.rows.length).padStart(2) + ' groups · '
    + money(g.rows.reduce((t, r) => t + r.excess, 0)))
}
