/* WHEN A BUNDLE ARRIVED, READ OFF ITS FILE NAME.
 *
 * `received_at` defaults to now(), and `uploadBundle` never set it — so a
 * bundle dropped on the page claimed to have arrived the day it was dropped.
 * That is not a small cosmetic thing: it is how ALL 364 BUNDLES OF THE ORIGINAL
 * LOAD CAME TO CLAIM THEY ARRIVED ON 1-2 SEPTEMBER 2026, which took
 * `supabase/invoice_arrival_dates.sql` to repair afterwards.
 *
 * That repair only worked because `gmail-attachments.gs` writes the email's date
 * on the front of every file it saves. So the fact was always there in the name;
 * nothing was reading it. This is the same recovery, done at the door instead of
 * by migration — with 290 more bundles about to go in, the migration would
 * otherwise have to be written a second time.
 *
 * THE ARRIVAL DATE IS THE ONE FACT ABOUT A BUNDLE THAT IS NOT IN IT. Every other
 * column can be read back off the scan — the supplier, the invoice number, the
 * total, even the page it sits on. When the bundle arrived is knowable only from
 * the email that carried it, so once it is lost it is lost for good.
 */

/* The prefix `gmail-attachments.gs` writes: `2015-04-24 SKM_C224e15042414370.pdf`. */
const PREFIX = /^(\d{4})-(\d{2})-(\d{2}) /

/**
 * The date on the front of a file name, or null where there is none.
 *
 * NULL IS THE HONEST ANSWER, not today. A caller that gets null leaves
 * `received_at` alone and the column defaults to now() — which is wrong, but
 * visibly and knowably wrong for that one bundle, rather than a date this
 * function invented and nobody can tell from a real one.
 */
export function arrivalFromName(filename) {
  const m = PREFIX.exec(String(filename || ''))
  if (!m) return null

  const [, y, mo, d] = m
  const year = +y, month = +mo, day = +d

  /* CHECKED AS A REAL DATE, not just as four digits and two and two. A name
     carrying `2015-13-45` would otherwise be handed to Postgres to reject at
     the end of an upload of hundreds — and the whole point of reading it here
     is that it cannot fail halfway. Date rolls a bad day over into the next
     month, so it is compared back rather than merely constructed. */
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null
  }

  /* NOT FROM THE FUTURE. A scanner with its clock set wrong, or a typo in a
     name, would otherwise file a bundle ahead of every real one and sit at the
     top of the arrivals list for ever. */
  if (dt.getTime() > Date.now() + 24 * 3600 * 1000) return null

  return dt.toISOString()
}

/**
 * What to say about where the date came from, for the bundle's own record.
 *
 * A DATE READ OFF A NAME AND A DATE NOBODY KNEW MUST NOT LOOK ALIKE — the same
 * rule as *since measured / since fitted / since aboard* on the gear matrix, and
 * as *counted / never counted* on the parts ledger. The subject line is the only
 * place a hand-added bundle can carry it.
 */
export function arrivalSubject(filename) {
  return arrivalFromName(filename)
    ? 'Added by hand — arrived ' + String(arrivalFromName(filename)).slice(0, 10)
    : 'Added by hand — arrival date unknown'
}
