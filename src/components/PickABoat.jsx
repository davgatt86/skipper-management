/* "Which boat?" — asked in one voice, in one place.
 *
 * Three pages now have to ask, and they must not each invent their own wording.
 * The reason DIFFERS every time and the reason is the whole message: a crew
 * list needs one boat because it is a border document, quota needs one because
 * combining two boats' allocations hides one running short behind one that is
 * not. Saying only "pick a boat" would lose that.
 *
 * It says WHERE to answer, because the control is in the sidebar and a man
 * looking at a page in the middle of the screen has no reason to look there.
 */
export default function PickABoat({ vessels = [], reason, title = 'Which boat?' }) {
  return (
    <div className="card" style={{ borderColor: 'var(--brass)' }}>
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>{title}</h2>
      <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
        {reason}{' '}
        Pick one under <strong>Showing</strong> in the menu
        {vessels.length ? ` — ${vessels.map((v) => v.label || v.name).join(' or ')}.` : '.'}
      </p>
    </div>
  )
}
