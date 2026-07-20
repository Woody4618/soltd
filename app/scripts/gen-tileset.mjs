// Regenerate the grass/path Wang tileset via the PixelLab API and composite the
// 16 tiles into the exact 4x4 layout the renderer expects.
//
// The renderer (app/utils/tdAssets.ts) reads WANG_MAP[cornerKey] -> linearIndex,
// then draws tile at (col = idx % 4, row = floor(idx / 4)) from a 64x64 sheet.
// PixelLab returns each tile with a `corners {NW,NE,SW,SE}` descriptor and an
// `image_data` base64 PNG, so we can place every tile at the position our map
// wants regardless of PixelLab's own ordering.
//
// Usage:
//   PIXELLAB_API_KEY=... node scripts/gen-tileset.mjs
//
// Output (relative to app/):
//   public/assets/tiles/grass-path-tileset.png   (64x64, 4x4 x 16px)
//   public/assets/tiles/grass-path-metadata.json (raw API metadata, for record)

import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"

// --- Minimal dependency-free PNG (truecolor+alpha, 8-bit) codec ------------
// PixelLab tiles are small standard RGBA PNGs, so we only need to support that
// one flavour. This avoids adding an image library to the app.

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

// Decode an 8-bit RGBA PNG into { width, height, data:Uint8Array(RGBA) }.
function decodePNG(buffer) {
  let pos = 8 // skip signature
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString("ascii", pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + len)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === "IDAT") {
      idat.push(data)
    } else if (type === "IEND") {
      break
    }
    pos += 12 + len
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`unsupported PNG (bitDepth=${bitDepth} colorType=${colorType})`)
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = 4
  const stride = width * bpp
  const out = new Uint8Array(width * height * bpp)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++]
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let val
      switch (filter) {
        case 0: val = v; break
        case 1: val = v + a; break
        case 2: val = v + b; break
        case 3: val = v + ((a + b) >> 1); break
        case 4: val = v + paeth(a, b, c); break
        default: throw new Error(`bad filter ${filter}`)
      }
      out[y * stride + x] = val & 0xff
    }
  }
  return { width, height, data: out }
}

// Encode { width, height, data:Uint8Array(RGBA) } as an 8-bit RGBA PNG (no
// per-row filtering - filter 0 - which keeps the encoder trivial).
function encodePNG(width, height, data) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  const chunk = (type, body) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length, 0)
    const t = Buffer.from(type, "ascii")
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([t, body])), 0)
    return Buffer.concat([len, t, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

export { decodePNG, encodePNG }

// Copy a 16x16 tile (RGBA) into the sheet at pixel (dx, dy).
function bitblt(sheet, sheetW, tile, tileW, tileH, dx, dy) {
  for (let y = 0; y < tileH; y++) {
    for (let x = 0; x < tileW; x++) {
      const s = (y * tileW + x) * 4
      const d = ((dy + y) * sheetW + (dx + x)) * 4
      sheet[d] = tile[s]
      sheet[d + 1] = tile[s + 1]
      sheet[d + 2] = tile[s + 2]
      sheet[d + 3] = tile[s + 3]
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, "../public/assets/tiles")

const API = "https://api.pixellab.ai/v2"

const TILE_PX = 16
const COLS = 4

// Corner key "NW NE SW SE" (1 = upper/path, 0 = lower/grass) -> linear tile
// index. Must stay in sync with WANG_MAP in app/utils/tdAssets.ts.
const WANG_MAP = {
  "1101": 0, "1010": 1, "0100": 2, "1100": 3,
  "0110": 4, "1000": 5, "0000": 6, "0001": 7,
  "1011": 8, "0011": 9, "0010": 10, "0101": 11,
  "1111": 12, "1110": 13, "1001": 14, "0111": 15,
}

// Tuned prompts: keep the cozy garden feel but add a touch more contrast and a
// soft outline so tile edges read clearly even at small size (the old set was
// "lineless / low detail" which looked mushy). "upper" is the dirt path.
const BODY = {
  // Toned-down, natural sage green (the first pass came out neon). Keep the
  // grass interior almost featureless so the single all-grass tile doesn't show
  // a repeating pattern when tiled.
  lower_description:
    "muted natural grass, desaturated sage green, soft even lawn, flat and uniform, no flowers, no pebbles, minimal texture, cozy top-down pixel art",
  // Path: uniform packed dirt. NO pebbles / footprints - any spot detail on the
  // all-path tile repeats across the whole path interior, which reads as an
  // ugly tiled artifact. Keep the interior clean; detail lives on the edges.
  upper_description:
    "uniform packed dirt path, soft warm brown, smooth even ground, no pebbles, no rocks, no cracks, minimal texture, cozy top-down pixel art",
  transition_description:
    "crisp grassy edge meeting the dirt path, short blades overlapping the rim",
  transition_size: 0.25,
  tile_size: { width: 16, height: 16 },
  view: "high top-down",
  outline: "single color black outline",
  shading: "basic shading",
  detail: "low detail",
  text_guidance_scale: 9,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const KEY = process.env.PIXELLAB_API_KEY
  if (!KEY) {
    console.error("Set PIXELLAB_API_KEY in the environment.")
    process.exit(1)
  }
  const headers = {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  }
  console.log("Requesting tileset generation...")
  const res = await fetch(`${API}/create-tileset`, {
    method: "POST",
    headers,
    body: JSON.stringify(BODY),
  })
  if (!res.ok) {
    console.error("create-tileset failed", res.status, await res.text())
    process.exit(1)
  }
  const job = await res.json()
  const tilesetId = job.tileset_id
  const jobId = job.background_job_id
  console.log(`  tileset_id=${tilesetId} job=${jobId}`)

  // Poll the background job until it's no longer processing.
  let done = false
  for (let i = 0; i < 120 && !done; i++) {
    await sleep(3000)
    const jr = await fetch(`${API}/background-jobs/${jobId}`, { headers })
    if (!jr.ok) {
      console.error("job poll failed", jr.status, await jr.text())
      process.exit(1)
    }
    const j = await jr.json()
    process.stdout.write(`  [${i}] status=${j.status}\n`)
    if (j.status === "completed") done = true
    else if (j.status === "failed") {
      console.error("generation failed:", JSON.stringify(j.last_response))
      process.exit(1)
    }
  }
  if (!done) {
    console.error("timed out waiting for generation")
    process.exit(1)
  }

  console.log("Fetching finished tileset...")
  const tr = await fetch(`${API}/tilesets/${tilesetId}`, { headers })
  if (!tr.ok) {
    console.error("get tileset failed", tr.status, await tr.text())
    process.exit(1)
  }
  const data = await tr.json()
  const tiles = data.tileset?.tiles ?? []
  if (tiles.length < 16) {
    console.error(`expected 16 tiles, got ${tiles.length}`)
    process.exit(1)
  }

  // Composite into the 4x4 sheet at WANG_MAP positions.
  const sheetW = COLS * TILE_PX
  const sheet = new Uint8Array(sheetW * sheetW * 4)
  let placed = 0
  const seen = new Set()
  for (const tile of tiles) {
    const c = tile.corners
    const key = `${c.NW === "upper" ? 1 : 0}${c.NE === "upper" ? 1 : 0}${
      c.SW === "upper" ? 1 : 0
    }${c.SE === "upper" ? 1 : 0}`
    const idx = WANG_MAP[key]
    if (idx === undefined || seen.has(idx)) continue
    seen.add(idx)
    const b64 = String(tile.image?.base64 ?? tile.image_data ?? "").replace(
      /^data:image\/png;base64,/,
      ""
    )
    const src = decodePNG(Buffer.from(b64, "base64"))
    const dx = (idx % COLS) * TILE_PX
    const dy = Math.floor(idx / COLS) * TILE_PX
    bitblt(sheet, sheetW, src.data, TILE_PX, TILE_PX, dx, dy)
    placed++
  }
  console.log(`  placed ${placed}/16 tiles`)
  if (placed < 16) {
    console.error("missing tiles - aborting so we don't ship a broken sheet")
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const outPng = path.join(OUT_DIR, "grass-path-tileset.png")
  fs.writeFileSync(outPng, encodePNG(sheetW, sheetW, sheet))
  fs.writeFileSync(
    path.join(OUT_DIR, "grass-path-metadata.json"),
    JSON.stringify(data, null, 0)
  )
  console.log(`Wrote ${outPng}`)
}

// Only run generation when invoked directly (allows importing the codec for
// tests without hitting the API).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
