/* Generate the PWA / home-screen PNG icons from the favicon's own geometry.
 *
 * iOS will not use an SVG for a home-screen icon — without a PNG the engineer
 * gets a screenshot of the page as his app icon. So these have to exist.
 *
 * Written by hand rather than pulling in sharp or a CLI: the mark is a rounded
 * rectangle and two parallelograms, the same device as VesselPlate and the
 * login, and rasterising that needs nothing but zlib. It also means the icons
 * can be regenerated on any machine with node and no network.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(OUT, { recursive: true })

const HULL = [0x17, 0x49, 0xa8]          // --hull cobalt, as in index.css
const WHITE = [0xff, 0xff, 0xff]
const FLASH_ALPHA = 0.28                 // matches favicon.svg

// ---- PNG writing ----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  // One filter byte (0 = None) per scanline, as the spec requires.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- the mark, in the favicon's 32-unit space -----------------------------
// Both flashes are parallelograms leaning the same way: at height y their x
// range slides left by (y + 2) / 6. Taken straight off the SVG path data so the
// icon and the favicon cannot drift apart.
const slide = (y) => (y + 2) / 6
const BANDS = [[25.5, 34], [20, 23]]

function insideRounded(x, y, size, r) {
  if (r <= 0) return true
  const cx = Math.min(Math.max(x, r), size - r)
  const cy = Math.min(Math.max(y, r), size - r)
  const dx = x - cx, dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function render(size, { maskable = false } = {}) {
  const SS = 4                                   // supersample for clean edges
  const r = maskable ? 0 : (3 / 32) * size       // maskable icons are full-bleed
  const buf = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let inside = 0, flash = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS
          const y = py + (sy + 0.5) / SS
          if (!insideRounded(x, y, size, r)) continue
          inside++
          const u = (x / size) * 32, v = (y / size) * 32
          const t = slide(v)
          for (const [a, b] of BANDS) if (u >= a - t && u <= b - t) { flash++; break }
        }
      }
      const n = SS * SS
      const cov = inside / n
      const fl = inside ? (flash / inside) * FLASH_ALPHA : 0
      const i = (py * size + px) * 4
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(HULL[c] * (1 - fl) + WHITE[c] * fl)
      buf[i + 3] = Math.round(255 * cov)
    }
  }
  return png(size, size, buf)
}

const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-512-maskable.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],   // iOS applies its own mask
]
for (const [name, size, opts] of jobs) {
  const out = render(size, opts)
  writeFileSync(join(OUT, name), out)
  console.log(`${name.padEnd(24)} ${size}x${size}  ${out.length} bytes`)
}
