import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'

/* THE SAMPLE DOCUMENTS — shown on the pages that accept an upload, and only on
 * the demonstration tenant.
 *
 * A visitor cannot try the app without something to put into it, and the app is
 * the only place he is. The files themselves are static, built and verified by
 * `scripts/make-sample-docs.mjs` and served out of `public/samples/`, so there
 * is no second host and nothing to keep in step by hand.
 *
 * IT IS DRIVEN BY `fleets.is_demo`, NOT BY THE FLEET ID. "If this is fleet
 * ...00de" scattered through the pages would be a branch on a magic value, and
 * the point of the demo being a FLEET rather than a MODE is that there are no
 * such branches. A column on the tenant is data; a hardcoded uuid is a fork in
 * the code that nobody exercises on the real boats.
 */

const DOCS = {
  sales: {
    href: '/samples/sample-sales-note.pdf',
    name: 'Sample sales note (PDF)',
    what: '57 rows across 12 species and 6 buyers, 768 boxes, £111,800.76 — '
      + 'and it reconciles to the penny against its own printed total.',
    then: 'Upload it above. The panel will show what it read and what it changed.',
  },
  tally: {
    href: '/samples/sample-day-tally.xlsx',
    name: 'Sample day tally (Excel)',
    what: '1,954 boxes over five days, the wheelhouse tally as it is actually kept.',
    then: 'Upload it above for the tier count, the chalk sheet and the buyers’ catalogue.',
  },
}

export default function SampleDocs({ kind }) {
  const { appUser } = useAuth()
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    if (!appUser?.fleet_id) return
    let live = true
    supabase.from('fleets').select('is_demo').eq('id', appUser.fleet_id).maybeSingle()
      .then(({ data }) => { if (live) setIsDemo(!!data?.is_demo) })
    return () => { live = false }
  }, [appUser?.fleet_id])

  const doc = DOCS[kind]
  if (!isDemo || !doc) return null

  return (
    <div className="card" style={{ borderColor: 'var(--hull)' }}>
      <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Something to try it with</h3>
      <p className="muted" style={{ margin: '0.3rem 0 0.6rem', fontSize: '0.85rem' }}>
        {doc.what} {doc.then}
      </p>
      {/* A plain link, not a scripted download: the file is served by the app
          itself, so the browser handles it and there is nothing to go wrong
          offline or behind a sandbox. */}
      <a href={doc.href} download style={{ fontWeight: 600 }}>⬇ {doc.name}</a>
      <p className="muted" style={{ margin: '0.6rem 0 0', fontSize: '0.78rem' }}>
        Invented figures for an invented boat. Nothing here belongs to a real vessel,
        buyer or crewman.
      </p>
    </div>
  )
}
