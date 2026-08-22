import { existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'

/* REFUSE TO WRITE A RENDERED PREVIEW OVER SOMEBODY'S DATA.
 *
 * Several of these scripts take their OUTPUT path as the first positional
 * argument, and several others take an INPUT there. That is a trap, and it
 * caught me: `node scripts/catalogue-preview.mjs "…/trip 64.xlsx"` looks
 * exactly like every other script in here being handed a tally to read, and
 * instead it rendered a PDF straight over the workbook. Two of David's real
 * day tallies were destroyed that way in one session, and the only reason they
 * were recoverable is that they happened to live in OneDrive.
 *
 * The rule is narrow on purpose: an output file may be created, or replaced if
 * it is already the kind of file this script writes. Replacing a .xlsx with a
 * .pdf is never what anybody meant.
 *
 * It does NOT try to be clever about whether the existing file was ours. A
 * preview being overwritten by a later preview is the normal case and must
 * stay silent, or the guard gets switched off.
 */
export function safeOut(path, ext) {
  const want = ext.startsWith('.') ? ext : '.' + ext
  const got = extname(path).toLowerCase()

  if (got !== want) {
    throw new Error(
      `Refusing to write ${want} to "${path}".\n`
      + `  This argument is the OUTPUT file, not the tally to read.\n`
      + `  Give it a ${want} path, or leave it off for the default.`,
    )
  }
  if (existsSync(path) && !statSync(path).isFile()) {
    throw new Error(`Refusing to write over "${path}" — it is not a plain file.`)
  }
  return path
}
