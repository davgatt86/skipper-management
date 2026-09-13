import { supabase } from '../../supabaseClient'
import { runReader } from '../su/parse'
import { downscaleImage } from '../downscale'

/* THE IO HALF OF READING A PHOTO OF THE ENGINE ROOM SHEET.
 *
 * Same shape as the invoice and certificate bundles — upload to storage, the
 * edge function reads it out of the bucket, the page polls — but with its own
 * bucket and its own job table, because the man taking the photo is the officer
 * and both of the shared ones are shut to him. See engine_sheet_reads.sql.
 */

export const ENGINE_SHEET_BUCKET = 'engine-sheets'

// What the reader can open. A HEIC straight off an iPhone is not one of them;
// downscaleImage re-encodes it as JPEG, and if that fails the photo is refused
// here with a sentence rather than by the model with an error.
const READABLE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

export async function uploadSheetPhoto(fleetId, file) {
  if (!fleetId) throw new Error('This login is not attached to a boat.')
  /* Bigger than a certificate's 1600: the sheet is 56 rows of small boxes, and
     the stored photo is the evidence a figure is checked against. */
  const f = await downscaleImage(file, { maxEdge: 2000, quality: 0.85 })
  const type = f.type || (/\.pdf$/i.test(f.name || '') ? 'application/pdf' : '')
  if (!READABLE.includes(type)) {
    throw new Error('That photo is in a format the reader cannot open. Take it with the camera as an ordinary photo and try again.')
  }
  const safe = (f.name || 'sheet.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${fleetId}/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from(ENGINE_SHEET_BUCKET).upload(path, f, { contentType: type })
  if (error) throw new Error(`The photo did not upload: ${error.message}`)
  return path
}

export async function readSheetPhoto({ path, fields, layout, vesselId, onJob }) {
  return runReader(
    { paths: [path], doc_type: 'engine_sheet', fields, layout, vessel_id: vesselId || null },
    {
      table: 'engine_sheet_reads',
      onJob,
      tooLong: 'Reading took too long. The photo is stored — try again, or type the figures in.',
    },
  )
}

export async function sheetPhotoUrl(path, seconds = 3600) {
  const { data, error } = await supabase.storage.from(ENGINE_SHEET_BUCKET).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}
