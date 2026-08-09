/* Service worker: make the app OPEN with no signal.
 *
 * Offline capture is pointless if the page itself will not load — a man in an
 * engine room with no bars gets a blank screen and never reaches the form. This
 * caches the shell so the app starts, and the outbox in src/lib/offline/queue.js
 * handles what he types once it does.
 *
 * Hand-rolled rather than vite-plugin-pwa. The plugin precaches a generated
 * manifest, which means the build config decides what is available offline; here
 * the rule is simply "anything already fetched stays fetched", which needs no
 * knowledge of Vite's hashed filenames and cannot fall out of step with them.
 *
 * The strategies, and why each is what it is:
 *
 *   navigations   network first, falling back to the cached shell. Network
 *                 first so a deploy is picked up on the next load ashore; the
 *                 fallback is what makes it work at sea.
 *   /assets/*     cache first. Vite content-hashes these, so a given URL's
 *                 contents never change — serving from cache is always correct
 *                 and saves the boat's data allowance.
 *   Supabase      NEVER cached. A stale sales figure or a stale settlement read
 *                 back as current is worse than no figure at all. Reads that
 *                 must survive offline are cached deliberately in IndexedDB by
 *                 the pages that need them, where they carry a timestamp.
 */

const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const ASSETS = `assets-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/index.html', '/favicon.svg'])).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  let url
  try { url = new URL(request.url) } catch { return }

  // Anything not on our own origin — Supabase above all — goes straight to the
  // network and is never stored. Returning a cached settlement or quota figure
  // as if it were current would be worse than showing nothing.
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put('/index.html', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || caches.match('/')))
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || /\.(js|css|woff2?|svg|png|jpe?g|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit
        return fetch(request).then((res) => {
          // Only store a real answer. Caching an error page under an asset URL
          // would break the app until the cache version is bumped.
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone()
            caches.open(ASSETS).then((c) => c.put(request, copy)).catch(() => {})
          }
          return res
        })
      })
    )
  }
})
