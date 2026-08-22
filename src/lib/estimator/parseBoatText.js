/* The Where-to-Land boat tally, read from text.
 *
 * Lifted out of `Estimator.jsx` unchanged. It closed over nothing but its
 * argument, and it lives here so the sample-document generator can put its
 * output through the REAL reader rather than a copy — a sample checked against
 * a second implementation proves only that the two agree with each other, which
 * is exactly how the two parse-core copies drifted for months.
 *
 * THE FORMAT IS NOT THE MARKET DAY TALLY'S, and the two are easy to confuse:
 *
 *     COD,*                 <- species header: second cell is a bare star
 *     ,A1,18,690            <- a grade line: FIRST CELL EMPTY, then size, boxes, kg
 *     ,A2,34,1290
 *     TOTAL,,281,10670      <- skipped
 *
 * A line with a size but no weight is dropped, deliberately: the estimator
 * prices by the kilo, and a row it cannot weigh would come out as a species
 * landed for nothing.
 */
export function parseBoatText(txt) {
  const out = []
  let curSp = null
  String(txt || '').split(/\r?\n/).forEach((line) => {
    const cells = line.split(/[\t,]/).map((c) => c.trim().replace(/^"|"$/g, ''))
    if (cells.length < 2) return
    const first = cells[0]
    if (first && first === first.toUpperCase() && /[A-Z]/.test(first) && cells[1] === '*') { curSp = first; return }
    if (/^total$/i.test(first)) return
    if (!first && curSp) {
      const size = cells[1]
      const boxes = +cells[2] || 0
      const wt = +cells[3] || 0
      if (size && wt) out.push({ sp: curSp, size, boxes, wt })
    }
  })
  return out
}
