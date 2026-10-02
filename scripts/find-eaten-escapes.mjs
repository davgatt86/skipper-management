/* A REGEX LITERAL WHOSE BACKSLASHES HAVE BEEN EATEN.
 *
 * `/^d{4}-d{2}-d{2}$/` matches the letters "dddd-dd-dd" and nothing else, so
 * `dateOrNull` returned null for every date and no work date has ever been saved
 * through the invoices page — the UPDATE ran, wrote null over null, and the page
 * reported success. That is the fourth time in this repo: `split(/s+/)` split the
 * invoice search on the letter "s", `/^d{4}-d{2}-d{2} /` in gmail-attachments.gs
 * would have called every file undated, and the check written to catch THAT lost
 * its own backslash in the same way.
 *
 * THE CAUSE IS WRITING A FILE THROUGH A SHELL HEREDOC, which eats one level of
 * escaping. It happened again writing the first draft of this very scanner —
 * `[^/\n\\]` arrived as `[^/\n\]` and Node refused the file. That refusal is the
 * lucky case: in a character class the damage is a syntax error, while `\d` → `d`
 * is still a perfectly valid regex that silently matches the wrong thing.
 *
 * So the test is a scan, not a code review: find class letters used bare inside a
 * regex literal. `d{2}`, `s+`, `w+` are never what anybody means.
 *
 * It reports rather than fixes. `/[ds]/` inside a class is a real choice of two
 * letters, and `$1,000` style formatting uses bare `d` in strings, so a human
 * reads the list — but the list should be empty, and `npm test` fails if it is
 * not.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['src', 'netlify', 'scripts', 'supabase/functions']
const EXT = /\.(js|jsx|mjs|cjs|ts|tsx|gs)$/

const files = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(f) }
    else if (EXT.test(e.name)) files.push(f)
  }
}
for (const r of ROOTS) {
  const p = path.join(ROOT, r)
  if (fs.existsSync(p)) walk(p)
}

/* A regex literal, roughly: an unescaped slash, a body that may contain escapes
   and character classes, a closing slash and flags. Good enough for a lint — it
   is reading source written by us, not arbitrary JavaScript. */
const LITERAL = new RegExp(
  '/(?![/*])((?:\\\\.|\\[(?:\\\\.|[^\\]])*\\]|[^/\\n\\\\])+)/[gimsuy]*',
  'g'
)

/* A class letter used bare: d{2}, s+, w*, and the quantified forms. Inside a
   character class `[ds]` is a legitimate choice of letters, so classes are
   stripped before testing. */
const BARE = /(?<!\\)[dswDSWb]\{\d|(?<!\\)[dsw]\+|(?<!\\)[dsw]\*/

const skip = (f) => path.resolve(f) === path.resolve(ROOT, 'scripts/find-eaten-escapes.mjs')

/* IT HAS TO BE A REGEX, NOT A DIVISION OR A COMMENT, or the scan cries wolf and
 * gets switched off — which is how the last three of these survived. The first
 * run reported five, and three were `w*x1/100` arithmetic, `S{s+1}` in JSX and a
 * line of prose. A regex literal follows an operator, a comma, an open bracket or
 * `return`; a division follows a value. */
const REGEX_POSITION = /[(,=:!&|?[{;>]\s*$|\breturn\s*$|^\s*$/
const COMMENT = /^\s*(\/\/|\*|\/\*)/

let found = 0
for (const f of files) {
  if (skip(f)) continue
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (COMMENT.test(line)) return
    for (const m of line.matchAll(LITERAL)) {
      const body = m[1].replace(/\[(?:\\.|[^\]])*\]/g, '')
      if (!BARE.test(body)) continue
      if (!REGEX_POSITION.test(line.slice(0, m.index))) continue
      found++
      console.log(`${rel}:${i + 1}  /${m[1]}/`)
      console.log(`    ${line.trim().slice(0, 110)}`)
    }
  })
}

console.log(found
  ? `\neaten escapes: ${found} suspect literal(s) across ${files.length} files`
  : `eaten escapes: none, ${files.length} files scanned`)
process.exit(found ? 1 : 0)
