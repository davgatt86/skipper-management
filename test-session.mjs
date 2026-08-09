// "Has he signed out, or has he just lost the signal?"
//
// Getting this wrong in either direction is bad: too strict and an engineer is
// thrown out of the app an hour into a trip, with his outbox stranded behind a
// login page that needs the network he has not got; too loose and someone who
// genuinely signed out is kept in a shell that shows cached data.
//
// The function is pure, so it can be checked here rather than by guesswork.
// It is copied in by regex rather than imported because supabaseClient.js calls
// createClient() at module load and would need real env vars in node.
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./src/supabaseClient.js', import.meta.url), 'utf8')
const m = src.match(/export function sessionHeldInStorage[\s\S]*?\n}/)
if (!m) { console.error('FAIL: sessionHeldInStorage not found in supabaseClient.js'); process.exit(1) }
const sessionHeldInStorage = new Function(`${m[0].replace('export ', '')}; return sessionHeldInStorage`)()

let fail = 0
const eq = (label, got, want) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${got} want ${want}`}`)
}

// Signed out: signOut() removes the key entirely.
eq('null (signed out)', sessionHeldInStorage(null), false)
eq('empty string', sessionHeldInStorage(''), false)
eq('undefined', sessionHeldInStorage(undefined), false)

// Still signed in, just cannot refresh right now. auth-js leaves the record in
// place on a network failure, which is exactly the signal being read here.
eq('session with a refresh token',
  sessionHeldInStorage(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1 })), true)
eq('legacy currentSession shape',
  sessionHeldInStorage(JSON.stringify({ currentSession: { refresh_token: 'r' } })), true)
eq('expired access token still counts',
  sessionHeldInStorage(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 0 })), true)

// Anything without a refresh token cannot be recovered, so it is not "held".
eq('no refresh token', sessionHeldInStorage(JSON.stringify({ access_token: 'a' })), false)
eq('empty refresh token', sessionHeldInStorage(JSON.stringify({ refresh_token: '' })), false)
eq('empty object', sessionHeldInStorage('{}'), false)

// Corrupt storage must not throw — it would take the whole app down on boot.
eq('not json', sessionHeldInStorage('{not json'), false)
eq('json but not an object', sessionHeldInStorage('"a string"'), false)
eq('json null', sessionHeldInStorage('null'), false)
eq('json array', sessionHeldInStorage('[1,2,3]'), false)

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
