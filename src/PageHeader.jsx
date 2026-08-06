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
export default function PageHeader({ title, sub, eyebrow, children }) {
  return (
    <div className="pagehead">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {children && <div className="pagehead-a no-print">{children}</div>}
    </div>
  )
}
