import assert from 'node:assert'
import { decideReset, looksLikeEmail, GENERIC } from './netlify/functions/password-reset.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

const real = { id: 'u1', email: 'sandymcleman@btinternet.com', fleets: { name: 'BOY JOHN', is_demo: false } }
const demo = { id: 'u2', email: 'demo@skippermanagement.co.uk', fleets: { name: 'NORTH WIND (DEMO)', is_demo: true } }
const base = { mailerReady: true, recentSend: false }

/* ---- WHO GETS A LINK ------------------------------------------------------
 * The same class of boundary as `planDigest` in alert-digest.js: the decision
 * about who receives mail, pulled out where it can be tested, because it
 * cannot be tested through a handler that opens an SMTP connection.
 */
{
  eq(decideReset({ ...base, email: real.email, user: real }),
     { send: true, outcome: 'sent' }, 'a real account gets a link')

  /* NO ACCOUNT IS NOT AN ERROR, it is a non-event -- and the caller is told
     exactly what a real account is told. */
  eq(decideReset({ ...base, email: 'nobody@example.com', user: null }),
     { send: false, outcome: 'no account' }, 'an address on no account sends nothing')

  /* THE SHARED DEMO LOGIN. One account, its password handed out to visitors;
     a visitor resetting it locks out every visitor after him, and only the
     Supabase dashboard could undo that. */
  eq(decideReset({ ...base, email: demo.email, user: demo }),
     { send: false, outcome: 'demo' }, 'the demo login is never resettable')

  eq(decideReset({ ...base, email: real.email, user: real, recentSend: true }),
     { send: false, outcome: 'cooldown' }, 'a link already sent recently is not sent again')
}

/* ---- THE MAILER IS CHECKED FIRST, AND THAT ORDER IS THE POINT -------------
 * Checked after the lookup it would only ever fire on accounts that exist, so
 * an outage would answer differently for a real address than for a made-up
 * one -- which is precisely the oracle the single generic reply exists to
 * close. Every vessel here is a separate business, and "does this fisherman
 * have an account" must not be answerable from a browser.
 */
{
  const down = { mailerReady: false, recentSend: false }
  eq(decideReset({ ...down, email: real.email, user: real }).outcome, 'send failed',
     'a real account gets no link when the mailer is down')
  eq(decideReset({ ...down, email: 'nobody@example.com', user: null }).outcome, 'send failed',
     'and an unknown address is refused for the SAME reason, not a different one')
  eq(decideReset({ ...down, email: demo.email, user: demo }).outcome, 'send failed',
     'the demo account too — the mailer decides before anything about the account does')
  ok(!decideReset({ ...down, email: real.email, user: real }).send, 'and nothing is sent either way')
}

/* ---- NOTHING IS EVER SENT WITHOUT A USER --------------------------------- */
{
  for (const bad of [null, undefined, '', 'not an email', 'a@b', '@example.com', 'a b@c.com']) {
    eq(decideReset({ ...base, email: bad, user: real }).send, false,
       `nothing is sent for ${JSON.stringify(bad)}, even with a user attached`)
  }
  /* A LIKE WILDCARD IS NOT AN ADDRESS. The handler looks up with `.eq` for
     this reason -- `.ilike` would have taken these as PATTERNS, so
     "sandymcleman@btinternet.co%" matched a real account and fired a reset
     into that man's inbox from an address only half known, and a bare "%"
     matched all eighteen. One address on this project contains an underscore
     already. These shapes still pass the format test, which is exactly why
     the lookup and not the format has to be the thing that is safe. */
  ok(looksLikeEmail('sandymcleman@btinternet.co%'), 'a wildcard tail still looks like an address')
  ok(looksLikeEmail('%@%.%'), 'and so does a bare pattern')
}

/* ---- ONE ANSWER, WHATEVER HAPPENED --------------------------------------- */
{
  const outcomes = new Set()
  for (const c of [
    { ...base, email: real.email, user: real },
    { ...base, email: real.email, user: real, recentSend: true },
    { ...base, email: demo.email, user: demo },
    { ...base, email: 'nobody@example.com', user: null },
    { mailerReady: false, email: real.email, user: real },
  ]) outcomes.add(decideReset(c).outcome)
  eq(outcomes.size, 5, 'the five cases are told apart in the record')

  /* ...and NOT told apart in the reply. There is one message and the handler
     returns it on every path, which is why this is a constant rather than
     something built per branch. */
  ok(/If that address is on an account/.test(GENERIC), 'the reply is conditional, never a confirmation')
  ok(!/no account|not found|unknown|demo|cooldown/i.test(GENERIC), 'and it names no outcome')
  /* IT MUST NOT PROMISE. A man whose mailer failed is told the same thing, so
     the wording has to leave him somewhere to go. */
  ok(/contact the office/i.test(GENERIC), 'and it says what to do when nothing arrives')
}

console.log('password reset: ' + n + ' checks passed')
