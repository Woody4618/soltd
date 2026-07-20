import { useEffect, useRef, useState } from "react"
import { Box, Text, VStack } from "@chakra-ui/react"
import { useTowerDefense } from "@/contexts/TowerDefenseProvider"
import {
  SimBoard,
  SUBTILES_PER_TILE,
  UNIT_STATE_WALKING,
  ENEMY_KIND_NORMAL,
  ENEMY_KIND_FAST,
  ENEMY_KIND_STRONG,
  ENEMY_KIND_BOSS,
  positionAt,
  applyTicks,
  cloneBoard,
  ShotEvent,
} from "@/utils/tdSim"
import {
  GRID_SIZE,
  MS_PER_TICK,
  TOWER_BUILD_TICKS,
  TOWER_UPGRADE_BUILD_TICKS,
  TOWER_MAX_LEVEL,
  TOWER_DEFS,
  TOWER_KIND_BASIC,
  TOWER_KIND_SPLASH,
  TOWER_KIND_SLOW,
  towerDef,
} from "@/utils/anchor"
import {
  drawSprite,
  towerAnim,
  enemyAnim,
  drawTerrainTile,
  drawIcon,
  ICONS,
} from "@/utils/tdAssets"

const CELL = 56 // px per tile
const PADDING = 12
export const BOARD_SIZE = GRID_SIZE * CELL + PADDING * 2
const SIZE = BOARD_SIZE

// Radial "build" ring: the tower kinds offered when you click an empty tile.
// Colours mirror the on-board tower palette so the ring reads like the pieces
// it places.
interface RingItem {
  kind: number
  name: string
  accent: string
}
const RING_ITEMS: RingItem[] = [
  { kind: TOWER_KIND_BASIC, name: "Basic", accent: "#4dabf7" },
  { kind: TOWER_KIND_SPLASH, name: "Splash", accent: "#ff922b" },
  { kind: TOWER_KIND_SLOW, name: "Slow", accent: "#4dd4c0" },
]
const RING_RADIUS_PX = 46 // distance of each option from the click centre
const RING_BTN_PX = 46 // diameter of each round option button

const toPx = (sub: number) =>
  PADDING + (sub / SUBTILES_PER_TILE) * CELL + CELL / 2

// Per-enemy-kind visuals. `radius` is the marker size; `boss` gets a gold ring.
// Kept here (render-only) rather than in the generated defs so the canvas owns
// its own palette; stats/roster stay driven by the program via tdDefs.
interface EnemyStyle {
  fill: string
  stroke: string
  radius: number
  label: string
  boss?: boolean
}
const ENEMY_STYLES: Record<number, EnemyStyle> = {
  [ENEMY_KIND_NORMAL]: {
    fill: "#ff8787",
    stroke: "#c92a2a",
    radius: 10,
    label: "Normal",
  },
  [ENEMY_KIND_FAST]: {
    fill: "#ffd43b",
    stroke: "#e67700",
    radius: 8,
    label: "Fast",
  },
  [ENEMY_KIND_STRONG]: {
    fill: "#9775fa",
    stroke: "#5f3dc4",
    radius: 12,
    label: "Strong",
  },
  [ENEMY_KIND_BOSS]: {
    fill: "#f03e3e",
    stroke: "#ffd43b",
    radius: 17,
    label: "Boss",
    boss: true,
  },
}
const enemyStyle = (kind: number): EnemyStyle =>
  ENEMY_STYLES[kind] ?? ENEMY_STYLES[ENEMY_KIND_NORMAL]

// A floating gold blip. Used both for "+N Gold" rewards when an enemy dies and
// "-N Gold" costs when you buy/upgrade a tower. Position is in canvas pixels;
// it drifts up and fades over BLIP_LIFETIME_MS. `label` is the full text and
// `color` its fill (yellow for gains, red for spends).
interface Blip {
  x: number
  y: number
  label: string
  color: string
  bornAt: number
}
const BLIP_LIFETIME_MS = 1100
const BLIP_RISE_PX = 34
const BLIP_GAIN_COLOR = "#ffd43b"
const BLIP_SPEND_COLOR = "#ff6b6b"
const BLIP_DAMAGE_COLOR = "#ffa8a8"

// A projectile fired from a tower toward the unit it hit. Purely cosmetic: it
// flies from (x0,y0) to (x1,y1) over BULLET_FLIGHT_MS. The target is captured
// as a fixed point (the unit's position at fire time) so it never re-targets.
interface Bullet {
  x0: number
  y0: number
  x1: number
  y1: number
  bornAt: number
  kind: number // firing tower kind -> projectile sprite
}
const BULLET_FLIGHT_MS = 140
const BULLET_RADIUS = 3
const BULLET_SPRITE_PX = 16

// A short burst of particles when an enemy dies.
interface Explosion {
  x: number
  y: number
  bornAt: number
}
const EXPLOSION_LIFETIME_MS = 420
const EXPLOSION_PARTICLES = 9
const EXPLOSION_RADIUS_PX = 22

// Per-hit wobble: a unit jitters briefly when it takes damage. Stored keyed by
// unit slot index -> the time the latest hit landed.
const WOBBLE_LIFETIME_MS = 180
const WOBBLE_AMPLITUDE_PX = 3

// Draw in-flight bullets. Returns the still-live ones.
function drawBullets(
  ctx: CanvasRenderingContext2D,
  bullets: Bullet[],
  now: number
): Bullet[] {
  const alive: Bullet[] = []
  for (const b of bullets) {
    const age = now - b.bornAt
    if (age >= BULLET_FLIGHT_MS) continue
    alive.push(b)
    // Scheduled for a future tick (staggered replay) - keep, draw later.
    if (age < 0) continue
    const t = age / BULLET_FLIGHT_MS
    const x = b.x0 + (b.x1 - b.x0) * t
    const y = b.y0 + (b.y1 - b.y0) * t
    // Slow tower fires a chilly water droplet (vector, cyan) rather than a
    // fruit; other kinds throw a themed spinning projectile: cucumber slice
    // (basic) / strawberry (splash). Falls back to the yellow dot until loaded.
    if (b.kind === TOWER_KIND_SLOW) {
      ctx.beginPath()
      ctx.fillStyle = "#79d0ff"
      ctx.arc(x, y, BULLET_RADIUS + 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.strokeStyle = "rgba(255,255,255,0.8)"
      ctx.lineWidth = 1
      ctx.arc(x, y, BULLET_RADIUS + 1, 0, Math.PI * 2)
      ctx.stroke()
      continue
    }
    const iconPath =
      b.kind === TOWER_KIND_SPLASH ? ICONS.strawberry : ICONS.cucumberSlice
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((age / BULLET_FLIGHT_MS) * Math.PI * 2)
    const drewIcon = drawIcon(ctx, iconPath, 0, 0, BULLET_SPRITE_PX)
    ctx.restore()
    if (!drewIcon) {
      ctx.beginPath()
      ctx.fillStyle = "#ffe066"
      ctx.arc(x, y, BULLET_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      // Faint trailing streak toward the origin.
      ctx.strokeStyle = "rgba(255, 224, 102, 0.35)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - (b.x1 - b.x0) * 0.12, y - (b.y1 - b.y0) * 0.12)
      ctx.stroke()
    }
  }
  return alive
}

// Draw death explosions (radial particles that fly out and fade). Returns the
// still-live ones.
function drawExplosions(
  ctx: CanvasRenderingContext2D,
  explosions: Explosion[],
  now: number
): Explosion[] {
  const alive: Explosion[] = []
  for (const e of explosions) {
    const age = now - e.bornAt
    if (age >= EXPLOSION_LIFETIME_MS) continue
    alive.push(e)
    if (age < 0) continue
    const t = age / EXPLOSION_LIFETIME_MS
    const dist = EXPLOSION_RADIUS_PX * t
    const alpha = 1 - t
    ctx.globalAlpha = alpha
    for (let p = 0; p < EXPLOSION_PARTICLES; p++) {
      const ang = (p / EXPLOSION_PARTICLES) * Math.PI * 2
      const px = e.x + Math.cos(ang) * dist
      const py = e.y + Math.sin(ang) * dist
      ctx.fillStyle = p % 2 === 0 ? "#ff8787" : "#ffd43b"
      ctx.beginPath()
      ctx.arc(px, py, 3 * (1 - t) + 1, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  return alive
}

// Which tiles the path passes through (for shading).
function pathTiles(board: SimBoard): Set<string> {
  const set = new Set<string>()
  for (let i = 1; i < board.pathLen; i++) {
    const a = board.path[i - 1]
    const b = board.path[i]
    const x0 = Math.min(a.x, b.x)
    const x1 = Math.max(a.x, b.x)
    const y0 = Math.min(a.y, b.y)
    const y1 = Math.max(a.y, b.y)
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) set.add(`${x},${y}`)
  }
  return set
}

// `board` drives the animated state (tick, units). `towerSource` provides the
// tower list: we draw towers from the latest CONFIRMED board so a freshly built
// tower shows up immediately (with an empty build bar) even before playback
// reaches its placement tick. Build progress is still keyed off `board`'s
// current tick, so the bar fills in sync with the animation.
function draw(
  ctx: CanvasRenderingContext2D,
  board: SimBoard,
  towerSource: SimBoard,
  wobble: Map<number, number>,
  now: number,
  hover: { x: number; y: number } | null
) {
  ctx.clearRect(0, 0, SIZE, SIZE)

  // Background.
  ctx.fillStyle = "#0f1117"
  ctx.fillRect(0, 0, SIZE, SIZE)

  const tiles = pathTiles(board)
  // Terrain is sampled at CELL CENTERS (a cell is grass or path). We draw the
  // Wang tiles on the VERTEX grid (offset by half a cell) so each rendered tile
  // straddles four cell-centers - this is the correct corner-Wang setup and
  // makes a 1-cell-wide path render as a clean, smooth band instead of an
  // inflated jagged one. Out-of-bounds cells count as grass.
  const isPath = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE && tiles.has(`${x},${y}`)

  // Clip terrain to the board rect: vertex tiles extend half a cell past every
  // edge, and we don't want them spilling into the padding / dark background.
  ctx.save()
  ctx.beginPath()
  ctx.rect(PADDING, PADDING, GRID_SIZE * CELL, GRID_SIZE * CELL)
  ctx.clip()

  // First lay a flat grass/dirt base so any seams between tiles read as terrain,
  // not the dark background.
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      ctx.fillStyle = isPath(x, y) ? "#b07a52" : "#8ba86a"
      ctx.fillRect(PADDING + x * CELL, PADDING + y * CELL, CELL, CELL)
    }
  }

  // Wang tiles on the vertex grid. Vertex (vx, vy) sits at the shared corner of
  // cells (vx-1,vy-1)=NW, (vx,vy-1)=NE, (vx-1,vy)=SW, (vx,vy)=SE, and is drawn
  // centered on that vertex (top-left = vertex - CELL/2).
  for (let vx = 0; vx <= GRID_SIZE; vx++) {
    for (let vy = 0; vy <= GRID_SIZE; vy++) {
      const corners: [boolean, boolean, boolean, boolean] = [
        isPath(vx - 1, vy - 1),
        isPath(vx, vy - 1),
        isPath(vx - 1, vy),
        isPath(vx, vy),
      ]
      const px = PADDING + vx * CELL - CELL / 2
      const py = PADDING + vy * CELL - CELL / 2
      drawTerrainTile(ctx, corners, px, py, CELL)
    }
  }

  ctx.restore()

  // Start (green) and end (red) markers - drawn as subtle translucent overlays
  // so they don't hide the tile art underneath.
  if (board.pathLen > 0) {
    const s = board.path[0]
    const e = board.path[board.pathLen - 1]
    ctx.fillStyle = "rgba(47, 158, 68, 0.45)"
    ctx.fillRect(PADDING + s.x * CELL, PADDING + s.y * CELL, CELL - 2, CELL - 2)
    ctx.fillStyle = "rgba(224, 49, 49, 0.45)"
    ctx.fillRect(PADDING + e.x * CELL, PADDING + e.y * CELL, CELL - 2, CELL - 2)
  }

  // Placement grid: thin lines on every tile boundary so it's unambiguous which
  // cell a click lands in. Drawn crisp on the pixel edge (offset 0.5) over the
  // terrain but under the towers/units.
  ctx.save()
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)"
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= GRID_SIZE; i++) {
    const p = PADDING + i * CELL + 0.5
    ctx.moveTo(PADDING + 0.5, p)
    ctx.lineTo(PADDING + GRID_SIZE * CELL + 0.5, p)
    ctx.moveTo(p, PADDING + 0.5)
    ctx.lineTo(p, PADDING + GRID_SIZE * CELL + 0.5)
  }
  ctx.stroke()
  ctx.restore()

  // Hover highlight: outline the tile under the cursor. Green if it's a legal
  // build spot (empty, off-path), red if not - a quick "can I place here?" cue.
  if (hover && hover.x >= 0 && hover.y >= 0 && hover.x < GRID_SIZE && hover.y < GRID_SIZE) {
    const occupied = towerSource.towers.some(
      (t) => t.kind !== 0 && t.x === hover.x && t.y === hover.y
    )
    const buildable = !isPath(hover.x, hover.y) && !occupied
    const hx = PADDING + hover.x * CELL
    const hy = PADDING + hover.y * CELL
    ctx.save()
    ctx.fillStyle = buildable ? "rgba(64, 192, 87, 0.18)" : "rgba(224, 49, 49, 0.16)"
    ctx.fillRect(hx, hy, CELL, CELL)
    ctx.strokeStyle = buildable ? "rgba(105, 219, 124, 0.9)" : "rgba(255, 107, 107, 0.85)"
    ctx.lineWidth = 2
    ctx.strokeRect(hx + 1, hy + 1, CELL - 2, CELL - 2)
    ctx.restore()
  }

  // Towers: base square, range ring, level pips.
  //  - INITIAL build (pendingLevel === 0, tick < readyAtTick): dimmed, no range
  //    ring, yellow build bar - it can't shoot until it arms.
  //  - UPGRADE in progress (pendingLevel !== 0): drawn normally (keeps firing
  //    at current stats), with a cyan bar showing upgrade progress.
  // Bars fill deterministically toward readyAtTick, in sync with the chain.
  // Iterate every slot present in EITHER board. The predicted board carries all
  // confirmed towers plus any optimistic placement (a greyed-out "building"
  // ghost injected the instant you click, before the chain confirms), so we
  // take the higher count and prefer the predicted slot for existence - that's
  // what makes a just-placed tower appear immediately.
  const slotCount = Math.max(towerSource.towerCount, board.towerCount)
  for (let i = 0; i < slotCount; i++) {
    // Prefer the predicted slot (has the optimistic ghost + latest stats); fall
    // back to the confirmed slot.
    const pt = board.towers[i]
    const ct = towerSource.towers[i]
    const t = pt && pt.kind !== 0 ? pt : ct
    if (!t || t.kind === 0) continue
    const cx = PADDING + t.x * CELL + CELL / 2
    const cy = PADDING + t.y * CELL + CELL / 2

    // Read STATS (level, range, pending upgrade, readyAtTick) from the PREDICTED
    // board's same-slot tower when it's the same tower, so level pips, range
    // ring and build/upgrade bar all update on the predicted timeline together.
    // Fall back to the confirmed tower otherwise.
    const et =
      pt && pt.kind !== 0 && pt.x === t.x && pt.y === t.y ? pt : t

    const upgrading =
      et.pendingLevel !== 0 && board.currentTick < et.readyAtTick
    const initialBuilding =
      et.pendingLevel === 0 && board.currentTick < et.readyAtTick
    const buildTicks = upgrading ? TOWER_UPGRADE_BUILD_TICKS : TOWER_BUILD_TICKS
    const buildStartTick = et.readyAtTick - buildTicks
    const progress =
      initialBuilding || upgrading
        ? Math.max(
            0,
            Math.min(1, (board.currentTick - buildStartTick) / buildTicks)
          )
        : 1

    // Both splash and slow towers have an AoE footprint (splashRadius > 0), but
    // they read apart by kind: splash = warm orange (damage), slow = cool cyan
    // (chill field).
    const hasAoe = et.splashRadiusSubtiles > 0
    const isSlow = et.kind === TOWER_KIND_SLOW

    // Range ring for anything that can shoot (armed, or upgrading = still live).
    if (!initialBuilding) {
      ctx.beginPath()
      ctx.strokeStyle = "rgba(116, 192, 252, 0.25)"
      ctx.arc(
        cx,
        cy,
        (et.rangeSubtiles / SUBTILES_PER_TILE) * CELL,
        0,
        Math.PI * 2
      )
      ctx.stroke()

      // AoE towers additionally show their effect radius as a dashed ring so
      // you can see the footprint around where they hit (orange = splash
      // damage, cyan = slow field).
      if (hasAoe) {
        ctx.beginPath()
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = isSlow
          ? "rgba(77, 212, 192, 0.4)"
          : "rgba(255, 146, 43, 0.35)"
        ctx.arc(
          cx,
          cy,
          (et.splashRadiusSubtiles / SUBTILES_PER_TILE) * CELL,
          0,
          Math.PI * 2
        )
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // Body - dimmed only during the initial build. If a sprite for this tower
    // kind has been dropped into public/assets/, draw it; otherwise fall back
    // to a vector body coloured by kind (slow = teal, splash = orange, basic =
    // blue) so the kinds read apart at a glance.
    ctx.globalAlpha = initialBuilding ? 0.45 : 1
    if (!drawSprite(ctx, towerAnim(et.kind), cx, cy, 44, now)) {
      const bodyFill = isSlow ? "#4dd4c0" : hasAoe ? "#ff922b" : "#4dabf7"
      const capFill = isSlow ? "#0ca678" : hasAoe ? "#d9480f" : "#1864ab"
      ctx.fillStyle = bodyFill
      ctx.fillRect(cx - 16, cy - 16, 32, 32)
      ctx.fillStyle = capFill
      ctx.fillRect(cx - 16, cy - 16, 32, 6)
    }

    // Level pips - from the predicted tower (et) so a new pip appears exactly
    // when the upgrade commits in the sim, in sync with the bar completing.
    ctx.fillStyle = "#ffd43b"
    for (let l = 0; l < et.level; l++) {
      ctx.fillRect(cx - 14 + l * 8, cy + 10, 5, 5)
    }
    ctx.globalAlpha = 1

    // Progress bar above the tower (build = yellow, upgrade = cyan).
    if (initialBuilding || upgrading) {
      const buildProgress = progress
      const barW = 32
      const barH = 5
      const bx = cx - barW / 2
      const by = cy - 26
      ctx.fillStyle = "#2b2f3a"
      ctx.fillRect(bx, by, barW, barH)
      ctx.fillStyle = upgrading ? "#4dd4c0" : "#ffd43b"
      ctx.fillRect(bx, by, barW * buildProgress, barH)
      ctx.strokeStyle = "rgba(0,0,0,0.5)"
      ctx.strokeRect(bx, by, barW, barH)
    }
  }

  // Units: circle with HP bar. Only walking units are on the board. A unit that
  // was hit recently wobbles (a quick decaying jitter) for feedback.
  for (let ui = 0; ui < board.units.length; ui++) {
    const u = board.units[ui]
    if (u.state !== UNIT_STATE_WALKING) continue
    const [sx, sy] = positionAt(board, u.progressSubtiles)
    let cx = toPx(sx)
    let cy = toPx(sy)

    // Apply hit wobble: a decaying sinusoidal jitter based on how long ago the
    // last hit landed.
    const hitAt = wobble.get(ui)
    if (hitAt !== undefined) {
      const age = now - hitAt
      if (age < WOBBLE_LIFETIME_MS) {
        const decay = 1 - age / WOBBLE_LIFETIME_MS
        const amp = WOBBLE_AMPLITUDE_PX * decay
        cx += Math.sin(age * 0.08) * amp
        cy += Math.cos(age * 0.11) * amp
      }
    }

    const style = enemyStyle(u.enemyKind)
    const r = style.radius

    // Slowed: a chilly cyan aura + pulsing ring so it's obvious a unit is under
    // a slow tower's effect. slowedUntilTick is a tick counter; compare to the
    // board's current (confirmed/predicted) tick.
    const slowed = u.slowedUntilTick > board.currentTick
    if (slowed) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.012)
      ctx.beginPath()
      ctx.fillStyle = `rgba(120, 200, 255, ${0.18 + 0.12 * pulse})`
      ctx.arc(cx, cy, r + 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.strokeStyle = `rgba(140, 220, 255, ${0.55 + 0.25 * pulse})`
      ctx.lineWidth = 2
      ctx.arc(cx, cy, r + 5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }

    // Boss: outer gold ring to make it unmistakable.
    if (style.boss) {
      ctx.beginPath()
      ctx.strokeStyle = "#ffd43b"
      ctx.lineWidth = 3
      ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }

    // Body: animated snail sprite for this kind if present, else the colored
    // circle. Sprite is scaled a bit larger than the hit marker so it reads
    // well; type sizes (fast small, boss big) still come through via `r`.
    if (!drawSprite(ctx, enemyAnim(u.enemyKind), cx, cy, r * 2.6, now)) {
      ctx.beginPath()
      ctx.fillStyle = style.fill
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.strokeStyle = style.stroke
      ctx.lineWidth = 2
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }

    // HP bar, sized to the marker so a boss's bar isn't tiny.
    const w = Math.max(22, r * 2 + 4)
    const barY = cy - r - 8
    const hpFrac = u.maxHp > 0 ? u.hp / u.maxHp : 0
    ctx.fillStyle = "#2b2f3a"
    ctx.fillRect(cx - w / 2, barY, w, 4)
    ctx.fillStyle = "#69db7c"
    ctx.fillRect(cx - w / 2, barY, w * hpFrac, 4)
  }
}

// Draw the active reward blips, rising and fading. Returns the still-live ones.
function drawBlips(
  ctx: CanvasRenderingContext2D,
  blips: Blip[],
  now: number
): Blip[] {
  const alive: Blip[] = []
  ctx.textAlign = "center"
  ctx.font = "bold 13px sans-serif"
  for (const b of blips) {
    const age = now - b.bornAt
    if (age >= BLIP_LIFETIME_MS) continue
    alive.push(b)
    if (age < 0) continue
    const t = age / BLIP_LIFETIME_MS
    const y = b.y - BLIP_RISE_PX * t
    const alpha = 1 - t
    ctx.globalAlpha = alpha
    ctx.fillStyle = "#000000"
    ctx.fillText(b.label, b.x + 1, y + 1)
    ctx.fillStyle = b.color
    ctx.fillText(b.label, b.x, y)
  }
  ctx.globalAlpha = 1
  return alive
}

// An open radial build menu: the empty tile it targets plus the pixel centre
// (CSS px within the board container) the ring is drawn around.
interface RingMenu {
  x: number
  y: number
  cx: number
  cy: number
}

const TowerDefenseBoard = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const {
    predicted,
    confirmed,
    placeTower,
    upgradeTower,
    busy,
    readOnly,
  } = useTowerDefense()

  // Open radial build menu (null = closed).
  const [ring, setRing] = useState<RingMenu | null>(null)

  // Towers come from the confirmed board (so newly built ones show instantly);
  // everything animated comes from the predicted playback board.
  const towerSource = confirmed ?? predicted

  // Latest boards kept in refs so the rAF draw loop always reads current state
  // without re-subscribing every frame.
  const predictedRef = useRef<SimBoard | null>(predicted)
  const towerSourceRef = useRef<SimBoard | null>(towerSource)
  predictedRef.current = predicted
  towerSourceRef.current = towerSource

  // Combat feedback, all derived by diffing the playback board frame-to-frame:
  //  - kill    : WALKING -> DEAD  => "+N Gold" blip + death explosion.
  //  - hit     : hp dropped       => bullet from the shooting tower, target
  //              wobble, and a "-N" damage blip.
  // A dedicated rAF loop drives smooth animation independent of React renders.
  const blipsRef = useRef<Blip[]>([])
  const bulletsRef = useRef<Bullet[]>([])
  const explosionsRef = useRef<Explosion[]>([])
  const wobbleRef = useRef<Map<number, number>>(new Map())
  const prevBoardRef = useRef<SimBoard | null>(null)
  // Tile currently under the cursor (grid coords), for the build-spot highlight.
  const hoverRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let raf: number
    const frame = () => {
      const canvas = canvasRef.current
      const board = predictedRef.current
      const towers = towerSourceRef.current
      if (canvas && board && towers) {
        const ctx = canvas.getContext("2d")
        if (ctx) {
          // HiDPI + pixel art: size the backing buffer to device pixels so the
          // browser doesn't bilinear-upscale a low-res canvas (the main source
          // of the "blurry tiles"), then draw in CSS px via a dpr transform.
          const dpr = window.devicePixelRatio || 1
          const wantW = Math.round(SIZE * dpr)
          if (canvas.width !== wantW) {
            canvas.width = wantW
            canvas.height = wantW
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          // Never bilinear-smooth when scaling 16px source tiles up to CELL px.
          ctx.imageSmoothingEnabled = false
          const now = performance.now()
          const prevBoard = prevBoardRef.current
          // Reset detection: the playback tick rewound (game was reset, or a
          // fresh board loaded). Clear all transient combat effects so bullets /
          // blips / explosions / wobble from the previous game don't linger.
          if (prevBoard && board.currentTick < prevBoard.currentTick) {
            bulletsRef.current = []
            blipsRef.current = []
            explosionsRef.current = []
            wobbleRef.current.clear()
          }
          // Replay the ticks that elapsed since the last frame on a clone of the
          // previous board, capturing EACH individual tower shot. This yields one
          // distinct damage number + bullet per shot - even when several shots
          // land in the same render frame (multiple ticks) or on the same tick
          // (multiple towers) - instead of the old frame-diff which lumped the
          // combined hp drop into a single summed number.
          if (prevBoard) {
            const gap = board.currentTick - prevBoard.currentTick
            if (gap > 0 && gap <= 240) {
              const replay = cloneBoard(prevBoard)
              const firstTick = prevBoard.currentTick + 1
              const onShot = (e: ShotEvent) => {
                // Unit position right after this shot resolved (pre-movement).
                const u = replay.units[e.unitIndex]
                const [sx, sy] = positionAt(replay, u.progressSubtiles)
                const tx = toPx(sx)
                const ty = toPx(sy)
                // Stagger animation start by the shot's tick so shots on
                // successive ticks don't all pop at the same instant.
                const bornAt = now + (e.tick - firstTick) * MS_PER_TICK
                // Wobble the struck unit.
                wobbleRef.current.set(e.unitIndex, bornAt)
                // Distinct damage number for THIS shot.
                blipsRef.current.push({
                  x: tx,
                  y: ty - 14,
                  label: `-${e.damage}`,
                  color: BLIP_DAMAGE_COLOR,
                  bornAt,
                })
                // Bullet from the exact tower that fired. Look up its kind so
                // the projectile sprite matches (cucumber vs strawberry).
                const firing = replay.towers.find(
                  (tw) => tw.x === e.towerX && tw.y === e.towerY && tw.kind !== 0
                )
                bulletsRef.current.push({
                  x0: PADDING + e.towerX * CELL + CELL / 2,
                  y0: PADDING + e.towerY * CELL + CELL / 2,
                  x1: tx,
                  y1: ty,
                  bornAt,
                  kind: firing ? firing.kind : 0,
                })
                // Kill: reward blip + explosion at the death spot.
                if (e.killed) {
                  blipsRef.current.push({
                    x: tx,
                    y: ty - 20,
                    label: `+${u.reward} Gold`,
                    color: BLIP_GAIN_COLOR,
                    bornAt,
                  })
                  explosionsRef.current.push({ x: tx, y: ty, bornAt })
                }
              }
              applyTicks(replay, gap, onShot)
            }
          }
          prevBoardRef.current = board

          // Prune expired wobble entries so the map doesn't grow unbounded.
          for (const [idx, at] of wobbleRef.current) {
            if (now - at >= WOBBLE_LIFETIME_MS) wobbleRef.current.delete(idx)
          }

          draw(ctx, board, towers, wobbleRef.current, now, hoverRef.current)
          bulletsRef.current = drawBullets(ctx, bulletsRef.current, now)
          explosionsRef.current = drawExplosions(ctx, explosionsRef.current, now)
          blipsRef.current = drawBlips(ctx, blipsRef.current, now)
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Push a floating "-N Gold" / "Not enough gold" blip at a tile centre.
  const blipAt = (tileX: number, tileY: number, label: string, color: string) => {
    blipsRef.current.push({
      x: PADDING + tileX * CELL + CELL / 2,
      y: PADDING + tileY * CELL + CELL / 2 - 24,
      label,
      color,
      bornAt: performance.now(),
    })
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = (e.clientX - rect.left) * (SIZE / rect.width) - PADDING
    const py = (e.clientY - rect.top) * (SIZE / rect.height) - PADDING
    const x = Math.floor(px / CELL)
    const y = Math.floor(py / CELL)
    hoverRef.current =
      x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE ? { x, y } : null
  }

  const onMouseLeave = () => {
    hoverRef.current = null
  }

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Any board click first dismisses an open ring.
    if (ring) {
      setRing(null)
      return
    }
    // Spectating: the board is read-only, so no building/upgrading.
    if (readOnly) return
    if (busy) return
    if (!predicted || predicted.lives <= 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    // Work in CSS px: the drawing context is scaled by devicePixelRatio, but
    // PADDING/CELL are CSS-space constants, so map the mouse into CSS coords via
    // the element rect (which is CSS-sized) - do NOT scale to device pixels.
    const rect = canvas.getBoundingClientRect()
    const px = (e.clientX - rect.left) * (SIZE / rect.width) - PADDING
    const py = (e.clientY - rect.top) * (SIZE / rect.height) - PADDING
    const x = Math.floor(px / CELL)
    const y = Math.floor(py / CELL)
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return

    // If the clicked tile already has a tower, upgrade it directly; otherwise
    // open the radial build ring so the player can pick a tower kind to place.
    // Use the confirmed tower list so a just-placed tower is clickable at once.
    let towerIdx = -1
    const towers = towerSource ?? predicted
    for (let i = 0; i < towers.towerCount; i++) {
      const t = towers.towers[i]
      if (t.kind !== 0 && t.x === x && t.y === y) {
        towerIdx = i
        break
      }
    }

    // A tile can hold an OPTIMISTIC tower (greyed-out ghost) that exists only on
    // the predicted board until the chain confirms it. If the tile is occupied
    // there but not yet in the confirmed list, ignore the click: it's neither a
    // valid new build (tile taken) nor an upgradeable confirmed tower yet.
    if (towerIdx < 0 && predicted) {
      const ghost = predicted.towers.some(
        (t) => t.kind !== 0 && t.x === x && t.y === y
      )
      if (ghost) return
    }

    const guardBoard = predicted ?? confirmed
    const availableGold = guardBoard?.gold ?? 0

    if (towerIdx >= 0) {
      const t = guardBoard?.towers[towerIdx]
      // Only surface the gold message when the upgrade is otherwise valid:
      // exists, finished its initial build (armed), not already upgrading, and
      // not max level. Otherwise the provider rejects it for a different reason
      // and a gold blip would be misleading.
      const stillBuilding =
        !!t &&
        t.pendingLevel === 0 &&
        (guardBoard?.currentTick ?? 0) < t.readyAtTick
      const upgradeable =
        !!t &&
        !stillBuilding &&
        t.pendingLevel === 0 &&
        t.level < TOWER_MAX_LEVEL
      if (upgradeable) {
        // Upgrade cost is per tower KIND (basic/splash/slow differ), so read it
        // from that tower's balance row rather than a single global constant.
        const upgradeCost = towerDef(t!.kind)?.upgradeCost ?? 0
        blipAt(
          x,
          y,
          availableGold >= upgradeCost ? `-${upgradeCost} Gold` : "Not enough gold",
          BLIP_SPEND_COLOR
        )
      }
      upgradeTower(towerIdx).catch((err) =>
        console.warn("upgradeTower failed:", err?.message ?? err)
      )
    } else {
      // Path tiles are not buildable - the program rejects them. Block it here
      // (with feedback) instead of opening the ring and sending a doomed tx.
      const board = guardBoard ?? predicted
      if (board && pathTiles(board).has(`${x},${y}`)) {
        blipAt(x, y, "Can't build on the path", BLIP_SPEND_COLOR)
        return
      }
      // Empty tile: open the build ring centred on the tile (CSS px = tile math
      // since the canvas renders 1:1 at SIZE).
      setRing({
        x,
        y,
        cx: PADDING + x * CELL + CELL / 2,
        cy: PADDING + y * CELL + CELL / 2,
      })
    }
  }

  // Place the chosen kind from the ring at its target tile, then close the ring.
  const placeFromRing = (kind: number) => {
    if (!ring) return
    const { x, y } = ring
    setRing(null)
    if (busy) return
    const guardBoard = predicted ?? confirmed
    // Defense in depth: never send a placement onto a path tile (program rejects
    // it). The ring shouldn't open on the path, but guard here regardless.
    if (guardBoard && pathTiles(guardBoard).has(`${x},${y}`)) {
      blipAt(x, y, "Can't build on the path", BLIP_SPEND_COLOR)
      return
    }
    const availableGold = guardBoard?.gold ?? 0
    const buildCost = towerDef(kind)?.cost ?? 0
    blipAt(
      x,
      y,
      availableGold >= buildCost ? `-${buildCost} Gold` : "Not enough gold",
      BLIP_SPEND_COLOR
    )
    placeTower(x, y, kind).catch((err) =>
      console.warn("placeTower failed:", err?.message ?? err)
    )
  }

  return (
    <Box position="relative" w={`${SIZE}px`} h={`${SIZE}px`}>
      <Box
        borderRadius="md"
        overflow="hidden"
        border="1px solid #2b2f3a"
        lineHeight={0}
      >
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          style={{
            cursor: busy ? "wait" : "crosshair",
            width: SIZE,
            height: SIZE,
            imageRendering: "pixelated",
          }}
          onClick={onClick}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />
      </Box>

      {ring && (
        <RingMenuOverlay
          ring={ring}
          gold={(predicted ?? confirmed)?.gold ?? 0}
          onPick={placeFromRing}
          onDismiss={() => setRing(null)}
        />
      )}
    </Box>
  )
}

// Radial build menu overlaid on the board. Renders the tower options in an arc
// around the clicked tile; picking one places that kind. A translucent
// backdrop catches outside clicks to dismiss.
const RingMenuOverlay = ({
  ring,
  gold,
  onPick,
  onDismiss,
}: {
  ring: RingMenu
  gold: number
  onPick: (kind: number) => void
  onDismiss: () => void
}) => {
  // Spread the items across a fan so options never hide under the finger. The
  // fan points AWAY from the nearest vertical edge (down for top-row tiles, up
  // otherwise) so the buttons always land inside the board.
  const n = RING_ITEMS.length
  const spread = Math.PI * 0.9 // ~162° fan
  const pointDown = ring.cy < RING_RADIUS_PX + RING_BTN_PX
  const center = pointDown ? Math.PI / 2 : -Math.PI / 2
  const start = center - spread / 2

  return (
    <Box
      position="absolute"
      inset={0}
      onClick={onDismiss}
      zIndex={5}
      // Fill so clicks anywhere outside the buttons dismiss the ring.
    >
      {RING_ITEMS.map((item, i) => {
        const angle = n === 1 ? center : start + (spread * i) / (n - 1)
        const bx = ring.cx + Math.cos(angle) * RING_RADIUS_PX
        const by = ring.cy + Math.sin(angle) * RING_RADIUS_PX
        const cost = TOWER_DEFS[item.kind - 1]?.cost ?? 0
        const affordable = gold >= cost
        return (
          <Box
            key={item.kind}
            position="absolute"
            left={`${bx}px`}
            top={`${by}px`}
            transform="translate(-50%, -50%)"
            as="button"
            onClick={(e) => {
              e.stopPropagation()
              onPick(item.kind)
            }}
            w={`${RING_BTN_PX}px`}
            h={`${RING_BTN_PX}px`}
            borderRadius="full"
            bg="#151822"
            border="2px solid"
            borderColor={item.accent}
            color={item.accent}
            opacity={affordable ? 1 : 0.5}
            boxShadow="0 2px 8px rgba(0,0,0,0.6)"
            _hover={{ bg: item.accent, color: "#0f1117", transform: "translate(-50%, -50%) scale(1.12)" }}
            transition="transform 0.08s, background 0.08s, color 0.08s"
            sx={{ animation: "tdRingIn 0.12s ease-out" }}
          >
            <VStack spacing={0} lineHeight={1}>
              <Text fontSize="11px" fontWeight="bold">
                {item.name}
              </Text>
              <Text fontSize="9px">{cost}g</Text>
            </VStack>
          </Box>
        )
      })}
      <style jsx global>{`
        @keyframes tdRingIn {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.6);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
      `}</style>
    </Box>
  )
}

export default TowerDefenseBoard
