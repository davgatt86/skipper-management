// A section rule is a hairline with a short cobalt tick — never a patterned
// bar. `side` is the optional right-hand note, e.g. "to 31 Dec".
export default function SectionRule({ children, side }) {
  return (
    <div className="rule">
      <span className="tick" />
      <h2>{children}</h2>
      <span className="ln" />
      {side && <span className="side">{side}</span>}
    </div>
  )
}
