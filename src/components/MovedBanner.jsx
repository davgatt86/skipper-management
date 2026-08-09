import { useEffect, useState } from 'react'
import { queueCounts, subscribe } from '../lib/offline/queue'

/* "We have moved" — shown only to somebody still on the old address.
 *
 * Everyone installed the app from skipper-management.netlify.app, and an
 * installed PWA stays bound to the origin it came from: it will never drift
 * onto the new domain by itself. So the only people who see this are the ones
 * who need to act, and it disappears for good once they do — no dismissal to
 * build, and no way for it to become permanent furniture.
 *
 * THE OUTBOX CHECK IS THE POINT. Browser storage is per origin, so anything
 * still queued here is invisible from the new domain — an engine-log or garbage
 * entry made at sea would be left behind. So while there is anything unsent the
 * banner says "not yet", and only invites the move once the device is clear.
 * Telling a man to switch while he is carrying an unsent legal record would be
 * worse than not telling him at all.
 */

const OLD_HOSTS = ['skipper-management.netlify.app']
const NEW_URL = 'https://skippermanagement.co.uk'

export default function MovedBanner() {
  const onOldHost = typeof location !== 'undefined' && OLD_HOSTS.includes(location.hostname)
  const [pending, setPending] = useState(null)

  useEffect(() => {
    if (!onOldHost) return
    const read = () => queueCounts().then((c) => setPending(c.pending + c.failed))
    read()
    return subscribe(read)
  }, [onOldHost])

  if (!onOldHost) return null

  const holding = pending > 0

  return (
    <div
      className="card no-print"
      style={{
        borderColor: holding ? 'var(--brass)' : 'var(--hull)',
        borderLeftWidth: 3,
        marginBottom: '1rem',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
        {holding ? 'Send your entries before moving' : 'This app has a new address'}
      </div>

      {holding ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          You have <strong>{pending}</strong> {pending === 1 ? 'entry' : 'entries'} saved on this device
          that {pending === 1 ? 'has' : 'have'} not reached the office yet. They are stored against this
          web address and will <strong>not</strong> come with you. Get a signal, let them send, and this
          will change to the moving instructions.
        </p>
      ) : (
        <>
          <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
            Everything has moved to <strong>skippermanagement.co.uk</strong>. This address still works,
            but new work should happen there. Nothing is lost — you will just sign in again.
          </p>
          <ol className="muted" style={{ margin: '0 0 0.6rem 1.1rem', fontSize: '0.88rem' }}>
            <li>Delete the old icon from your home screen.</li>
            <li>Open <strong>{NEW_URL.replace('https://', '')}</strong> in <strong>Safari</strong> — not Chrome.</li>
            <li>Share → <strong>Add to Home Screen</strong>, then sign in.</li>
          </ol>
          <a href={NEW_URL} style={{ fontWeight: 600 }}>Open the new address →</a>
        </>
      )}
    </div>
  )
}
