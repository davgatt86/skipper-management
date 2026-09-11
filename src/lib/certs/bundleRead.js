import { supabase } from '../../supabaseClient'
import { runReader } from '../su/parse'
import { ensurePdfjs } from '../pdfjs'
import { withPage } from './bundle'

/* THE IO HALF OF READING A CERTIFICATE BUNDLE.
 *
 * Deliberately NOT the single-certificate path. That one sends the whole file
 * through the `parse` Netlify function in the request body, and a Netlify
 * function refuses a request over about 6 MB — `L.S.A Certs.pdf` is 9.9 MB of
 * photographs before base64 adds a third. The bundle goes the way the invoice
 * bundles go: uploaded to storage first, read by the edge function straight out
 * of the bucket, and waited on by polling.
 */

export const CERT_BUCKET = 'vessel-certs'

/** Pages in the PDF, counted by pdf.js — the one fact about the document that is
 *  not the reader's opinion. Null for anything that is not a PDF. */
export async function pageCountOf(file) {
  try {
    const pdfjs = await ensurePdfjs()
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    return doc.numPages
  } catch {
    return null
  }
}

export async function readCertBundle(path, pageCount) {
  return runReader(
    { paths: [path], doc_type: 'vessel_cert_bundle', page_count: Number.isInteger(pageCount) ? pageCount : null },
    { tooLong: 'Reading took too long. The bundle is uploaded — try again, or add the certificates by hand.' },
  )
}

/** Open a certificate's document at its own page of the bundle. */
export async function openCertAt(path, page) {
  const { data, error } = await supabase.storage.from(CERT_BUCKET).createSignedUrl(path, 3600)
  if (error) throw error
  window.open(withPage(data.signedUrl, page), '_blank', 'noopener')
}
