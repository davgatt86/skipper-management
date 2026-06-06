// Loads pdf.js (CDN) and the canonical shared parser parse-core.js, which is
// hosted in the fish-sales-tracker repo and served at fish-sales.netlify.app.
// ALL sales-note parsing fixes are made in parse-core.js, never here.

const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
const PARSE_CORE_SRC = 'https://fish-sales.netlify.app/parse-core.js'

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res()
    const s = document.createElement('script')
    s.src = src
    s.onload = res
    s.onerror = () => rej(new Error('Failed to load ' + src))
    document.body.appendChild(s)
  })
}

export async function ensureParsing() {
  if (!window.pdfjsLib) {
    await loadScript(PDFJS_SRC)
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
  }
  if (!window.ParseCore) await loadScript(PARSE_CORE_SRC)
  return { pdfjsLib: window.pdfjsLib, ParseCore: window.ParseCore }
}

// Parse one File -> ParseCore result {market, rows, meta, reconcile, filename}
export async function parseSalesPdf(file) {
  const { pdfjsLib, ParseCore } = await ensureParsing()
  return ParseCore.parsePdf(await file.arrayBuffer(), pdfjsLib, file.name)
}

// Same dedup key scheme as the Fish Sales Tracker.
export function dedupKey(res) {
  const m = res.meta || {}
  return (res.market || '') + '|' + (m.vessel || '') + '|' + (m.saleNo || m.isoDate || res.filename || '')
}
