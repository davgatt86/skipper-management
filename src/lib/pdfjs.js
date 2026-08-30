/* One pdf.js for the whole app.
 *
 * There were three ways of getting it: the Square Up invoice parser imported
 * the bundled `pdfjs-dist`, while the sales-note, daily-price and quota parsers
 * each injected a <script> tag pointing at pdf.js 3.11.174 on cdnjs. So the app
 * shipped two different major versions of the same library and chose between
 * them by which page you happened to open.
 *
 * The CDN copies were the wrong half in every way that matters here:
 *
 *  - THEY NEED SIGNAL. Every one of those parsers is something a skipper does
 *    with a PDF he already has on the device, and the service worker cannot
 *    cache a cross-origin script — so uploading a note at sea failed on the
 *    network, not on the parsing.
 *  - THEY WERE A DIFFERENT VERSION FROM THE SERVER. The CloudMailin webhook
 *    parses the same notes with pdfjs-dist v4. Two versions of pdf.js reading
 *    one note is a difference nobody would think to look for.
 *  - They pinned an old release nothing ever updated.
 *
 * Bundled and lazy: the chunk is only fetched when something actually parses a
 * PDF, and once fetched the service worker keeps it like any other asset.
 */

import { freshImport } from './liveBuild.js'

let cached = null

export async function ensurePdfjs() {
  if (cached) return cached
  // Same stale-chunk guard as the parser: pdf.js is the other big on-demand
  // load, so it is the other one a deploy can pull out from under an open page.
  const [lib, worker] = await Promise.all([
    freshImport(() => import('pdfjs-dist')),
    // ?url yields the built worker's filename rather than inlining it — pdf.js
    // spawns the worker itself, and same-origin means it is cacheable.
    freshImport(() => import('pdfjs-dist/build/pdf.worker.min.mjs?url')),
  ])
  lib.GlobalWorkerOptions.workerSrc = worker.default
  cached = lib
  return cached
}
