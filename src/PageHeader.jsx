import { Link, useLocation } from 'react-router-dom'
import { parentOf } from './nav'

// The header every page inside the shell opens with. Replaces the old
// "BackNav + <h1>" pair — the sidebar handles getting back, so the page only
// has to say what it is.
//
//   <PageHeader title="Fish Sales" sub="Trip 214 · Peterhead">
//     <button className="secondary">Export</button>
//   </PageHeader>
//
// `eyebrow` is the small mono line above the title, for pages that need to
// say which direction something flows or what state it is in.
//
// THE BACK LINK IS DERIVED, NOT PASSED. A page off the sidebar needs a way
// back to the page that leads to it (see PARENT in nav.js) — and the whole
// class of bug here is a page shipping without one, so no page is asked to
// remember. Add the route to that map and the link appears; the forty-odd
// pages the sidebar does list get nothing, which is what they had before.
export default function PageHeader({ title, sub, eyebrow, children }) {
  const { pathname } = useLocation()
  const back = parentOf(pathname)

  return (
    <div className="pagehead">
      <div>
        {/* Above the eyebrow and the title, because it is a way out of the page
            rather than a fact about it. Hidden in print: a sheet that leaves
            the app has nothing to click. */}
        {back && (
          <Link to={back.to} className="pagehead-back no-print">
            <span aria-hidden="true">←</span> {back.label}
          </Link>
        )}
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {children && <div className="pagehead-a no-print">{children}</div>}
    </div>
  )
}
