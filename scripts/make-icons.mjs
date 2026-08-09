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

// Raw RGBA, so the splash can composite the mark over its own ground rather
// than re-deriving the geometry.
function renderRaw(size, r) {
  const SS = 4                                   // supersample for clean edges
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
  return buf
}

function render(size, { maskable = false } = {}) {
  // Maskable / native icons are full-bleed: the platform applies its own mask,
  // and a rounded corner baked in here shows as a dark notch inside theirs.
  const r = maskable ? 0 : (3 / 32) * size
  return png(size, size, renderRaw(size, r))
}

/* The splash screen: the mark small and centred on the ink ground, rather than
 * the icon blown up. Capacitor centre-crops this to every device aspect ratio,
 * so everything that matters has to sit well inside the middle. */
function renderSplash(size) {
  const buf = Buffer.alloc(size * size * 4)
  const INK = [0x0a, 0x1d, 0x26]                 // --ink, matches the config
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = INK[0]; buf[i * 4 + 1] = INK[1]; buf[i * 4 + 2] = INK[2]; buf[i * 4 + 3] = 255
  }
  const markSize = Math.round(size * 0.18)
  const mark = renderRaw(markSize, (markSize * 3) / 32)
  const off = Math.round((size - markSize) / 2)
  for (let y = 0; y < markSize; y++) {
    for (let x = 0; x < markSize; x++) {
      const s = (y * markSize + x) * 4
      const a = mark[s + 3] / 255
      if (!a) continue
      const d = ((y + off) * size + (x + off)) * 4
      for (let c = 0; c < 3; c++) buf[d + c] = Math.round(buf[d + c] * (1 - a) + mark[s + c] * a)
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
  console.log(`${name.padEnd(28)} ${size}x${size}  ${out.length} bytes`)
}

// Sources for @capacitor/assets, which fans these out to every density Android
// and iOS ask for. Full-bleed on purpose: both platforms apply their own mask,
// and a rounded corner baked in here shows as a dark notch inside theirs.
const RES = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
mkdirSync(RES, { recursive: true })
for (const [name, size] of [['icon-only.png', 1024], ['icon-foreground.png', 1024]]) {
  const out = render(size, { maskable: true })
  writeFileSync(join(RES, name), out)
  console.log(`resources/${name.padEnd(17)} ${size}x${size}  ${out.length} bytes`)
}
{
  // A flat background layer for Android's adaptive icon, which moves the
  // foreground about independently of it.
  const size = 1024
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = HULL[0]; buf[i * 4 + 1] = HULL[1]; buf[i * 4 + 2] = HULL[2]; buf[i * 4 + 3] = 255
  }
  writeFileSync(join(RES, 'icon-background.png'), png(size, size, buf))
  console.log(`resources/icon-background.png  ${size}x${size}`)
}
for (const [name, size] of [['splash.png', 2732], ['splash-dark.png', 2732]]) {
  const out = renderSplash(size)
  writeFileSync(join(RES, name), out)
  console.log(`resources/${name.padEnd(17)} ${size}x${size}  ${out.length} bytes`)
}
