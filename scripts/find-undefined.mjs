/* Every identifier in src/ that is REFERENCED but bound nowhere — no import,
 * no declaration, no parameter, and not a browser global.
 *
 *   node scripts/find-undefined.mjs                 all of src/
 *   node scripts/find-undefined.mjs a.jsx b.js      just these files
 *
 * THIS IS THE BUG THIS REPO KEEPS SHIPPING, and this is the tenth. An undefined
 * name is valid JavaScript right up until the line runs, so `npm run build`
 * passes clean and the page renders — until somebody reaches the branch that
 * uses it.
 *
 * The tenth was the engine log, Sep 2026. `fmtDate()` was called in the warning
 * for a counter that has gone backwards, and the page's date helper is `fmt`.
 * Nothing on the skipper's normal path reached it — until the generator's hour
 * meter read 7,396 against 8,864 on record, which it did on every entry, for
 * both logins. React threw during render, the page went blank, nothing saved,
 * and no request ever reached the server.
 *
 * THE SAME SCAN FOUND AN ELEVENTH that had never been reported: the Open button
 * on each invoice arrival called `signedUrl`, imported nowhere. Inside a click
 * handler it throws without blanking anything, so the button simply did nothing.
 *
 * There is no ESLint in this project, so this uses the Babel parser Vite already
 * brings, with real scope analysis rather than a grep: a name is only reported
 * if no scope it sits in binds it. Exit code 1 on anything found, so it can
 * stand in `npm test`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import traverseMod from '@babel/traverse'

const traverse = traverseMod.default || traverseMod
// fileURLToPath, not URL.pathname: the project folder has a space in its name,
// and .pathname hands back "Skipper%20Management" — a folder that does not exist.
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

// Browser and language globals. A name belongs here only if the runtime
// provides it — never to quiet a finding.
const GLOBALS = new Set(`window document console Math Number String Object Array JSON Date Promise
Set Map WeakMap WeakSet Symbol Error TypeError RangeError RegExp Boolean BigInt Proxy Reflect
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
queueMicrotask structuredClone isNaN isFinite parseFloat parseInt encodeURIComponent
decodeURIComponent encodeURI decodeURI atob btoa Intl URL URLSearchParams Blob File FileReader
FormData Headers Request Response fetch AbortController AbortSignal TextEncoder TextDecoder
Uint8Array Uint8ClampedArray Uint16Array Int32Array Float32Array Float64Array ArrayBuffer DataView
navigator localStorage sessionStorage indexedDB caches crypto performance location history
confirm alert prompt getComputedStyle matchMedia Image Event CustomEvent HTMLElement Node
MutationObserver ResizeObserver IntersectionObserver globalThis undefined NaN Infinity
process self screen open close print scrollTo innerWidth innerHeight devicePixelRatio
OffscreenCanvas createImageBitmap ImageData Worker ServiceWorker Notification
EventSource WebSocket XMLHttpRequest DOMParser XMLSerializer Option arguments`.split(/\s+/))

const args = process.argv.slice(2)
const files = []
if (args.length) {
  files.push(...args.map((a) => resolve(a)))
} else {
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(jsx?|mjs)$/.test(name)) files.push(p)
    }
  }
  walk(join(ROOT, 'src'))
}

let found = 0
for (const file of files) {
  const code = readFileSync(file, 'utf8')
  let ast
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: true })
  } catch (e) {
    console.log(`  PARSE ${relative(ROOT, file)}: ${e.message}`)
    found++
    continue
  }
  const seen = new Set()
  traverse(ast, {
    ReferencedIdentifier(path) {
      const node = path.node
      const name = node.name
      // A lower-case JSX name is an HTML tag, not a reference.
      if (node.type === 'JSXIdentifier' && /^[a-z]/.test(name)) return
      if (path.scope.hasBinding(name, true)) return
      if (GLOBALS.has(name)) return
      const key = `${name}:${node.loc?.start.line}`
      if (seen.has(key)) return
      seen.add(key)
      found++
      console.log(`  ${relative(ROOT, file)}:${node.loc?.start.line}  ${name}`)
    },
  })
}
console.log(`unbound names: ${files.length} file${files.length === 1 ? '' : 's'} scanned, ${found} found`)
if (found) process.exit(1)
