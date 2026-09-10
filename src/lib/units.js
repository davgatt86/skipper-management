/* LITRES AND CUBIC METRES.
 *
 * David, Sep 2026: "litres in fuel/oil log as thats what we get on our fuel
 * reciept. but auto convert it so the draft in ORB has m3."
 *
 * Both books keep the same fact in the unit its own reader expects: the fuel
 * log is checked against a delivery note printed in litres, and the Oil Record
 * Book is read by a surveyor who works in cubic metres.
 *
 * THIS IS THE ONE CONVERSION IN THIS CODEBASE THAT IS SAFE TO DO SILENTLY, and
 * it is worth saying why, because the rule everywhere else is the opposite.
 * A currency conversion rests on a rate nobody printed, so `orig_total` and
 * `fx_rate` are kept beside the converted figure and a settling sheet is shown
 * as printed AND as the lines add up. A DKK invoice at face value is a lie.
 *
 * 1 m³ = 1000 L is not a rate. It is exact, it does not move, and it needs no
 * source. Converting it loses nothing and hides nothing — and the litres are
 * carried into the entry's narrative anyway, so the book still says what the
 * receipt said.
 */

/** Litres -> cubic metres. Null in, null out; a real nought stays nought. */
export function toCubic(litres) {
  const n = num(litres)
  if (n == null) return null
  /* Rounded to the nearest litre, which is the precision a delivery note has.
     Done on the litres before dividing, so the float division cannot leave
     18.400000000000002 in a statutory record. */
  return Math.round(n * 1000) / 1e6
}

/** Cubic metres -> litres, for reading an ORB entry back against the log. */
export function toLitres(cubic) {
  const n = num(cubic)
  return n == null ? null : Math.round(n * 1e6) / 1000
}

/**
 * A quantity for a person to read.
 *
 * NO TRAILING NOUGHTS: 18.4 m³, not 18.400 m³. Three decimals is litre
 * precision, which is as fine as any of this gets.
 */
export function fmtCubic(cubic, { unit = true } = {}) {
  const n = num(cubic)
  if (n == null) return null
  return n.toLocaleString('en-GB', { maximumFractionDigits: 3 }) + (unit ? ' m³' : '')
}

export function fmtLitres(litres, { unit = true } = {}) {
  const n = num(litres)
  if (n == null) return null
  return n.toLocaleString('en-GB', { maximumFractionDigits: 1 }) + (unit ? ' L' : '')
}

/**
 * Both, in one phrase — "18.4 m³ (18,400 L)".
 *
 * THE LEAD UNIT IS THE ONE THE READER OF THAT BOOK WORKS IN, and the other is
 * in brackets behind it. On the fuel log that is litres first; in the Oil
 * Record Book it is cubic metres first.
 */
export function bothFromLitres(litres, { lead = 'L' } = {}) {
  const l = num(litres)
  if (l == null) return null
  const m = toCubic(l)
  return lead === 'm3'
    ? fmtCubic(m) + ' (' + fmtLitres(l) + ')'
    : fmtLitres(l) + ' (' + fmtCubic(m) + ')'
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
