import { Capacitor } from '@capacitor/core'

/* Where the Netlify Functions live.
 *
 * On the web the app is served BY Netlify, so a relative path is right and the
 * request is same-origin. Inside a Capacitor shell it is not: the page is served
 * from the device itself — `capacitor://localhost` on iOS, `https://localhost`
 * on Android — so `/.netlify/functions/parse` would resolve to the phone and
 * fail. It would fail quietly, too: a fetch to a non-existent local path, in a
 * feature the skipper only uses occasionally.
 *
 * Supabase is unaffected, because the client is built with an absolute URL. It
 * is only these five call sites that assumed same-origin.
 */
export const isNative = () => Capacitor.isNativePlatform()

// Where the site is deployed. Overridable at build time for a staging build.
const SITE = (import.meta.env.VITE_SITE_URL || 'https://skipper-management.netlify.app').replace(/\/$/, '')

export const fnUrl = (name) =>
  isNative() ? `${SITE}/.netlify/functions/${name}` : `/.netlify/functions/${name}`
