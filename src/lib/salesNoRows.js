/* WHY A NOTE CAME BACK WITH NOTHING ON IT.
 *
 * Both upload paths used to say the same eight words — `no rows parsed
 * (Unscannable)` — and Sandy McLeman hit it in Aug 2026 with six real
 * Hanstholm notes. He could not say what the error was, because the message
 * does not contain one: it names an internal market label and says nothing
 * about what is wrong with the file or what to do next. It reads as the app
 * being broken, which is the one thing it was not.
 *
 * THERE ARE THREE DIFFERENT OUTCOMES BEHIND THAT ONE SENTENCE, and they want
 * three different things done about them:
 *
 *   noText     the file carries no text AT ALL. Nothing can parse it, now or
 *              ever — the only fix is a different copy of the document, and
 *              that is the skipper's to ask for. His problem to act on.
 *   unknown    there IS text and the app does not recognise the market. A
 *              format nobody has taught it. Ours to add, not his to fix.
 *   noRows     the market WAS recognised and no rows came off it. That is a
 *              fault in this app on a note it claims to read — the worst of
 *              the three, and the one most worth hearing about.
 *
 * WHAT IT MUST NOT DO IS NAME A CAUSE IT CANNOT SEE. A file with no text may
 * be a photograph, a scan, or — as Sandy's six were — a note printed to PDF
 * through a virtual printer, which turns the writing into line art. The app
 * cannot tell those apart and does not need to: the observation is the same
 * and so is the answer. Trouble.jsx carries that lesson in full, from the one
 * time Daily Prices asserted a missing migration and was wrong.
 *
 * Pure, and shared by the browser upload and the CloudMailin webhook, so a
 * note emailed in and a note dropped on the page are explained in the same
 * words. Same reason buyerAliases.js is shared rather than written twice.
 */

/* What the market is called when the parser found text it does not recognise,
 * and when it found no text at all. Both come out of parse-core. */
const UNKNOWN = 'Unknown'
const NO_TEXT = 'Unscannable'

export function whyNoRows(res) {
  const market = (res && res.market) || UNKNOWN

  if (market === NO_TEXT) {
    return {
      code: 'noText',
      /* For the log line on the page. It says what is true of the file, what
       * that means, and the one thing that fixes it. */
      what: 'carries no text',
      say: 'this file carries no text — the writing in it is a picture, so there is nothing for the app to read. '
        + 'Ask whoever sent it for the original note as it came off the auction, rather than a scan, a photo, or a copy printed to PDF.',
      /* Nothing on our side will ever read this file. */
      ours: false,
    }
  }

  if (market === UNKNOWN) {
    return {
      code: 'unknown',
      what: 'not a note the app recognises',
      say: 'the app read the text in this file and does not recognise it as a sales note from any market it handles. '
        + 'If it is a real note, send it on and the format can be added.',
      ours: true,
    }
  }

  /* A market the app claims to read, which then yielded nothing. Named,
   * because "no rows parsed (Hanstholm Afregning)" is a bug report and should
   * be treated as one rather than left looking like the skipper's fault. */
  return {
    code: 'noRows',
    what: `read as ${market}, but no rows came off it`,
    say: `the app recognised this as a ${market} note and then read no rows from it. That is a fault here, not in the file — send it on.`,
    ours: true,
  }
}

/* The line the upload log shows, and the line the webhook records. One
 * function so the two cannot drift into saying different things about one
 * file. */
export function noRowsLine(filename, res) {
  return `✗ ${filename}: ${whyNoRows(res).say}`
}
