// The wording shown behind "what happens to it" on the sample upload screen.
// CONSENT_VERSION is stored on every su_format_samples row, so if this text
// changes it stays possible to say which version somebody actually agreed to.
// Bump it whenever the meaning below changes — not for typos.
export const CONSENT_VERSION = '2026-08-a'

export default function FormatSampleTerms() {
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--hull)' }}>
      <h2 style={{ marginTop: 0 }}>What happens to a sheet you send</h2>

      <p style={{ marginBottom: '0.8rem' }}>
        Skipper Management can only read settling sheets it has been taught to read.
        Right now that is two layouts. To add yours, the person who writes the reader
        has to see a real one — a sheet built from guesswork gets the figures wrong,
        confidently, which is worse than not reading it at all.
      </p>

      <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.4rem' }}>Who sees it</h3>
      <p style={{ marginBottom: '0.8rem' }}>
        David Gatt, who runs Skipper Management. Nobody else. It is not shown to other
        skippers, not sent to any third party, and not used to train anything.
      </p>

      <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.4rem' }}>What is on it</h3>
      <p style={{ marginBottom: '0.8rem' }}>
        A settling sheet usually carries your crew's wages — names, gross, deductions
        and net. Those are your crew's details, not just yours.{' '}
        <strong>You are welcome to black the names out before sending it.</strong> The
        reader is being built around the shape of the sheet — which figure sits in which
        column — not around who is on it. A redacted sheet works nearly as well.
      </p>

      <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.4rem' }}>How long it is kept</h3>
      <p style={{ marginBottom: '0.8rem' }}>
        Until your format is supported, then it is deleted. You can withdraw it before
        then from this page, at any time, without giving a reason — that removes both
        the file and the record of it.
      </p>

      <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.4rem' }}>What is recorded</h3>
      <p style={{ marginBottom: '0.8rem' }}>
        The file, which fleet sent it, which login sent it, anything you type in the
        note, and the date you agreed to this. Nothing else.
      </p>

      <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.4rem' }}>Sending nothing</h3>
      <p style={{ marginBottom: 0 }}>
        Entirely fine. Everything else in Skipper Management works without it. The only
        thing you lose is having settling sheets read automatically — the figures can
        always be typed in by hand instead.
      </p>
    </div>
  )
}
