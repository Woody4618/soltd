// Art for towers and enemies, wired to the themed asset pack in
// app/public/assets/ (see manifest.json). Enemies are snails, towers are food
// stations. Each kind maps to an ANIMATED sprite sheet (a horizontal strip of
// square frames) with a still-frame fallback, and the board falls back to its
// built-in vector shapes if an image is missing — so everything degrades
// gracefully.
//
// Sprite sheets are horizontal strips: width = frames * height, each frame is
// height x height (square). We derive the frame count from the loaded image
// (width / height) so we don't have to hardcode per-asset dimensions, but the
// manifest's `frames`/`fps` drive timing.

import {
  TOWER_KIND_BASIC,
  TOWER_KIND_SPLASH,
  TOWER_KIND_SLOW,
  ENEMY_KIND_NORMAL,
  ENEMY_KIND_FAST,
  ENEMY_KIND_STRONG,
  ENEMY_KIND_BOSS,
} from "./tdDefs"

const ASSET_BASE = "/assets/"

export interface SpriteAnim {
  src: string // path under public/assets
  frames: number // frame count in the strip (1 = static)
  fps: number // playback speed
}

// Tower kind -> themed sprite. Basic = Cucumber Catapult (a thrower), Splash =
// Strawberry Splatter (messy AoE), Slow = Herb Sprinkler (sprays a chilling
// mist that slows everything in range). All from manifest.json.
export const TOWER_ANIMS: Record<number, SpriteAnim> = {
  [TOWER_KIND_BASIC]: {
    src: "animations/tower-catapult-throw.png",
    frames: 9,
    fps: 10,
  },
  [TOWER_KIND_SPLASH]: {
    src: "animations/tower-strawberry-fire.png",
    frames: 9,
    fps: 10,
  },
  [TOWER_KIND_SLOW]: {
    src: "animations/tower-sprinkler-spray.png",
    frames: 9,
    fps: 9,
  },
}

// Enemy kind -> themed snail. Normal/Fast/Strong/Boss = garden / speedy / big /
// gourmet-boss snail crawl cycles.
export const ENEMY_ANIMS: Record<number, SpriteAnim> = {
  [ENEMY_KIND_NORMAL]: { src: "animations/snail-crawl.png", frames: 9, fps: 10 },
  [ENEMY_KIND_FAST]: {
    src: "animations/snail-speedy-crawl.png",
    frames: 9,
    fps: 14,
  },
  [ENEMY_KIND_STRONG]: {
    src: "animations/snail-big-crawl.png",
    frames: 9,
    fps: 8,
  },
  [ENEMY_KIND_BOSS]: { src: "animations/boss-snail-crawl.png", frames: 9, fps: 8 },
}

// Per-path load state so we attempt each image exactly once. A 404 resolves to
// "missing" and we never retry, keeping the render loop cheap.
type Entry = {
  img: HTMLImageElement
  status: "loading" | "ready" | "missing"
}
const cache = new Map<string, Entry>()

function load(path: string): HTMLImageElement | null {
  if (typeof window === "undefined") return null
  const full = path.startsWith(ASSET_BASE) ? path : ASSET_BASE + path
  const existing = cache.get(full)
  if (existing) return existing.status === "ready" ? existing.img : null
  const img = new Image()
  const entry: Entry = { img, status: "loading" }
  cache.set(full, entry)
  img.onload = () => {
    entry.status = "ready"
  }
  img.onerror = () => {
    entry.status = "missing"
  }
  img.src = full
  return null
}

/**
 * Draw an animated sprite centered at (cx, cy) scaled to `size` px. Picks the
 * current frame from a horizontal strip based on `now` (ms) and the anim's fps.
 * Returns true if it drew (image ready), false if the caller should fall back
 * to vector rendering. Safe to call every frame.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  anim: SpriteAnim | undefined,
  cx: number,
  cy: number,
  size: number,
  now: number
): boolean {
  if (!anim) return false
  const img = load(anim.src)
  if (!img) return false

  // Square frames: frame side = image height; frame count from width so we
  // tolerate the manifest and the actual file disagreeing.
  const fh = img.height
  const count = Math.max(1, Math.round(img.width / fh) || anim.frames)
  const frame =
    count > 1 ? Math.floor((now / 1000) * anim.fps) % count : 0
  const sx = frame * fh

  ctx.drawImage(
    img,
    sx,
    0,
    fh,
    fh,
    cx - size / 2,
    cy - size / 2,
    size,
    size
  )
  return true
}

export function towerAnim(kind: number): SpriteAnim | undefined {
  return TOWER_ANIMS[kind]
}
export function enemyAnim(kind: number): SpriteAnim | undefined {
  return ENEMY_ANIMS[kind]
}

// --- Single-frame images (icons, projectiles, tileset) -------------------

/** Load a static image; returns it once ready, else null. Cached like sprites. */
export function getImage(path: string): HTMLImageElement | null {
  return load(path)
}

// Icon sprites (single frame). Paths under public/assets.
export const ICONS = {
  heart: "sprites/icon-heart.png",
  coin: "sprites/icon-coin.png",
  trophy: "sprites/icon-trophy.png",
  cucumberSlice: "sprites/icon-cucumber-slice.png",
  strawberry: "sprites/icon-strawberry.png",
} as const

/** Draw a static icon centered at (cx, cy) at `size` px. No-op until loaded. */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  path: string,
  cx: number,
  cy: number,
  size: number
): boolean {
  const img = load(path)
  if (!img) return false
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size)
  return true
}

// --- Grass/path Wang tileset ---------------------------------------------
// grass-path-tileset.png is a 4x4 grid of 16 corner-Wang tiles (16px each).
// wang-map.json maps a 4-bit corner key "NW NE SW SE" (1 = path/upper) to the
// tile's linear index (col = idx % 4, row = floor(idx / 4)).

const TILESET_SRC = "tiles/grass-path-tileset.png"
const TILE_PX = 16
const TILES_PER_ROW = 4

// Corner key (NW,NE,SW,SE as 1/0) -> tile index, from wang-map.json.
const WANG_MAP: Record<string, number> = {
  "1101": 0,
  "1010": 1,
  "0100": 2,
  "1100": 3,
  "0110": 4,
  "1000": 5,
  "0000": 6,
  "0001": 7,
  "1011": 8,
  "0011": 9,
  "0010": 10,
  "0101": 11,
  "1111": 12,
  "1110": 13,
  "1001": 14,
  "0111": 15,
}

/**
 * Draw one grass/path tile into the cell rect (dx, dy, size). `corners` is
 * [NW, NE, SW, SE] where true = path. Falls back to false (draws nothing, so
 * the caller's flat color shows) until the tileset image has loaded.
 */
export function drawTerrainTile(
  ctx: CanvasRenderingContext2D,
  corners: [boolean, boolean, boolean, boolean],
  dx: number,
  dy: number,
  size: number
): boolean {
  const img = load(TILESET_SRC)
  if (!img) return false
  const key = corners.map((c) => (c ? "1" : "0")).join("")
  const idx = WANG_MAP[key] ?? WANG_MAP["0000"]
  const sx = (idx % TILES_PER_ROW) * TILE_PX
  const sy = Math.floor(idx / TILES_PER_ROW) * TILE_PX
  // Slightly overdraw (size, not size-2) so tiles butt together seamlessly.
  ctx.drawImage(img, sx, sy, TILE_PX, TILE_PX, dx, dy, size, size)
  return true
}
