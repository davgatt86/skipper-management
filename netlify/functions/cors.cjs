// Cross-origin access for the native app, and for nothing else.
//
// On the web these functions are same-origin and CORS never comes up. Inside a
// Capacitor shell the page is served from the device, so the browser sends an
// Origin header — `capacitor://localhost` on iOS, `https://localhost` on
// Android — and without a matching Access-Control-Allow-Origin the request is
// refused before it ever reaches the handler.
//
// Deliberately an ALLOW-LIST rather than `*`. These functions run with the
// service-role key behind a bearer-token check, and `*` would let any page on
// the internet put a request to them from a victim's browser. The token makes
// that hard to exploit, but there is no reason to widen it at all: the origins
// that need access are known and there are four of them.
//
// Note `Vary: Origin` — without it a CDN can cache the response for one origin
// and serve it to another, which looks exactly like CORS being broken at random.

const ALLOWED = new Set([
  'capacitor://localhost',   // iOS WKWebView
  'https://localhost',       // Android, with androidScheme https
  'http://localhost',        // Android fallback / local dev
  'http://localhost:5173',   // vite dev server
  'http://localhost:4173',   // vite preview
  // The live site. skippermanagement.co.uk is canonical; the rest are kept
  // because a redirect does not help a cross-origin request — the browser
  // checks the ORIGIN it started from, not where it ended up, so anything a
  // user might have bookmarked has to be listed in its own right.
  'https://skippermanagement.co.uk',
  'https://www.skippermanagement.co.uk',
  'https://skipper-management.com',
  'https://www.skipper-management.com',
  // "skippermangement" — missing an 'a'. Bought by mistake and kept pointing
  // at the site so a mistyped or already-bookmarked address still works.
  // Never use it as a sender or in anything printed.
  'https://skippermangement.co.uk',
  'https://www.skippermangement.co.uk',
  'https://skipper-management.netlify.app',
])

function corsHeaders(event) {
  const origin = (event && event.headers &&
    (event.headers.origin || event.headers.Origin)) || ''
  if (!origin || !ALLOWED.has(origin)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// Answer the browser's preflight. Returns null when this is not one, so a
// handler can simply `const pre = preflight(event); if (pre) return pre`.
function preflight(event) {
  if ((event.httpMethod || '').toUpperCase() !== 'OPTIONS') return null
  return { statusCode: 204, headers: corsHeaders(event), body: '' }
}

module.exports = { corsHeaders, preflight, ALLOWED }
