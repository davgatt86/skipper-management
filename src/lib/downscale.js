/* Shrink a photographed document before it is uploaded.
 *
 * A certificate snapped on an iPhone arrives at about 4 MB and 4032×3024. What
 * anybody ever does with it is read the expiry date and the certificate number,
 * and 1600px on the long edge does that comfortably — at roughly a tenth of the
 * size.
 *
 * It matters twice over:
 *   — 127 crew and vessel certificates at 4 MB each is ~450 MB, against a 1 GB
 *     allowance that also holds the settlement documents.
 *   — the upload happens on a boat. A 4 MB push over a poor connection is the
 *     difference between filing a ticket and giving up on it.
 *
 * PDFs pass through untouched: they are usually already small, they may hold
 * several pages, and re-encoding one would lose the text layer.
 *
 * If anything at all goes wrong — an unreadable image, a browser without canvas
 * — the ORIGINAL is returned. A slightly large upload is a far better outcome
 * than a lost certificate.
 */

const MAX_EDGE = 1600
const QUALITY = 0.82
// Below this there is nothing worth winning, and re-encoding would only lose
// detail for no gain.
const SKIP_UNDER_BYTES = 400 * 1024

export async function downscaleImage(file, opts = {}) {
  const maxEdge = opts.maxEdge || MAX_EDGE
  const quality = opts.quality || QUALITY

  try {
    if (!file || !file.type || !file.type.startsWith('image/')) return file
    if (file.type === 'image/gif') return file          // could be animated
    if (file.size <= SKIP_UNDER_BYTES) return file

    const bitmap = await loadBitmap(file)
    if (!bitmap) return file

    const { width, height } = bitmap
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    // Already small enough in pixels, even if the file is fat — re-encoding
    // still helps there, so carry on rather than returning early.
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    if (bitmap.close) bitmap.close()

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file     // no win, keep the original

    const name = file.name.replace(/\.(jpe?g|png|heic|heif|webp|bmp|tiff?)$/i, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}

async function loadBitmap(file) {
  // createImageBitmap handles HEIC on iOS Safari, which is what a phone camera
  // actually produces, and decodes off the main thread.
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fall through */ }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

export const kb = (bytes) => Math.round(bytes / 1024).toLocaleString('en-GB') + ' KB'
