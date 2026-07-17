import { useEffect, useRef } from "react"
import { Box } from "@chakra-ui/react"
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
  TOWER_UPGRADE_COST,
  TOWER_MAX_LEVEL,
  towerDef,
} from "@/utils/anchor"

const CELL = 56 // px per tile
const PADDING = 12
const SIZE = GRID_SIZE * CELL + PADDING * 2

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
}
const BULLET_FLIGHT_MS = 140
const BULLET_RADIUS = 3

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
  now: number
) {
  ctx.clearRect(0, 0, SIZE, SIZE)

  // Background.
  ctx.fillStyle = "#0f1117"
  ctx.fillRect(0, 0, SIZE, SIZE)

  const tiles = pathTiles(board)

  // Grid + path tiles.
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      const px = PADDING + x * CELL
      const py = PADDING + y * CELL
      ctx.fillStyle = tiles.has(`${x},${y}`) ? "#3a2f1a" : "#1a1d27"
      ctx.fillRect(px, py, CELL - 2, CELL - 2)
    }
  }

  // Start (green) and end (red) markers.
  if (board.pathLen > 0) {
    const s = board.path[0]
    const e = board.path[board.pathLen - 1]
    ctx.fillStyle = "#2f9e44"
    ctx.fillRect(PADDING + s.x * CELL, PADDING + s.y * CELL, CELL - 2, CELL - 2)
    ctx.fillStyle = "#e03131"
    ctx.fillRect(PADDING + e.x * CELL, PADDING + e.y * CELL, CELL - 2, CELL - 2)
  }

  // Towers: base square, range ring, level pips.
  //  - INITIAL build (pendingLevel === 0, tick < readyAtTick): dimmed, no range
  //    ring, yellow build bar - it can't shoot until it arms.
  //  - UPGRADE in progress (pendingLevel !== 0): drawn normally (keeps firing
  //    at current stats), with a cyan bar showing upgrade progress.
  // Bars fill deterministically toward readyAtTick, in sync with the chain.
  for (let i = 0; i < towerSource.towerCount; i++) {
    const t = towerSource.towers[i]
    if (t.kind === 0) continue
    const cx = PADDING + t.x * CELL + CELL / 2
    const cy = PADDING + t.y * CELL + CELL / 2

    // Towers occupy fixed slots by index in both boards. Read the STATS
    // (level, range, pending upgrade, readyAtTick) from the PREDICTED board's
    // same-slot tower when it's the same tower, so the level pips, range ring
    // and build/upgrade bar all update on the predicted timeline together - the
    // moment the upgrade commits in the sim, not a confirmation round-trip later.
    // Fall back to the confirmed tower for a just-placed tower the predicted
    // board hasn't caught up to yet.
    const pt = board.towers[i]
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

    const isSplash = et.splashRadiusSubtiles > 0

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

      // Splash towers additionally show their blast radius as a warm dashed
      // ring so you can see the AoE footprint around where they hit.
      if (isSplash) {
        ctx.beginPath()
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = "rgba(255, 146, 43, 0.35)"
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

    // Body - dimmed only during the initial build. Splash towers are orange,
    // basic towers blue, so the two kinds read apart at a glance.
    ctx.globalAlpha = initialBuilding ? 0.45 : 1
    ctx.fillStyle = isSplash ? "#ff922b" : "#4dabf7"
    ctx.fillRect(cx - 16, cy - 16, 32, 32)
    ctx.fillStyle = isSplash ? "#d9480f" : "#1864ab"
    ctx.fillRect(cx - 16, cy - 16, 32, 6)

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

    // Boss: outer gold ring to make it unmistakable.
    if (style.boss) {
      ctx.beginPath()
      ctx.strokeStyle = "#ffd43b"
      ctx.lineWidth = 3
      ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }

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

const TowerDefenseBoard = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const {
    predicted,
    confirmed,
    placeTower,
    upgradeTower,
    busy,
    selectedKind,
  } = useTowerDefense()

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

  useEffect(() => {
    let raf: number
    const frame = () => {
      const canvas = canvasRef.current
      const board = predictedRef.current
      const towers = towerSourceRef.current
      if (canvas && board && towers) {
        const ctx = canvas.getContext("2d")
        if (ctx) {
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
                // Bullet from the exact tower that fired.
                bulletsRef.current.push({
                  x0: PADDING + e.towerX * CELL + CELL / 2,
                  y0: PADDING + e.towerY * CELL + CELL / 2,
                  x1: tx,
                  y1: ty,
                  bornAt,
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

          draw(ctx, board, towers, wobbleRef.current, now)
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

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (busy) return
    if (!predicted || predicted.lives <= 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const px = (e.clientX - rect.left) * scaleX - PADDING
    const py = (e.clientY - rect.top) * scaleY - PADDING
    const x = Math.floor(px / CELL)
    const y = Math.floor(py / CELL)
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return

    // If the clicked tile already has a tower, upgrade it; otherwise build a
    // new tower there. Use the confirmed tower list so a just-placed tower is
    // clickable immediately.
    let towerIdx = -1
    const towers = towerSource ?? predicted
    for (let i = 0; i < towers.towerCount; i++) {
      const t = towers.towers[i]
      if (t.kind !== 0 && t.x === x && t.y === y) {
        towerIdx = i
        break
      }
    }

    // Pop a floating blip at the tile centre. On a valid buy/upgrade it shows
    // the "-N Gold" cost; when the player can't afford it we show "Not enough
    // gold" instead of a misleading cost. Guard against the PREDICTED board
    // (predicted-first) so the message matches what the provider will actually
    // do - a build/upgrade bundles a settle that confirms predicted gold.
    const cx = PADDING + x * CELL + CELL / 2
    const cy = PADDING + y * CELL + CELL / 2
    const guardBoard = predicted ?? confirmed
    const blip = (label: string, color: string) => {
      blipsRef.current.push({
        x: cx,
        y: cy - 24,
        label,
        color,
        bornAt: performance.now(),
      })
    }
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
        if (availableGold >= TOWER_UPGRADE_COST) {
          blip(`-${TOWER_UPGRADE_COST} Gold`, BLIP_SPEND_COLOR)
        } else {
          blip("Not enough gold", BLIP_SPEND_COLOR)
        }
      }
      upgradeTower(towerIdx).catch((err) =>
        console.warn("upgradeTower failed:", err?.message ?? err)
      )
    } else {
      const buildCost = towerDef(selectedKind)?.cost ?? 0
      if (availableGold >= buildCost) {
        blip(`-${buildCost} Gold`, BLIP_SPEND_COLOR)
      } else {
        blip("Not enough gold", BLIP_SPEND_COLOR)
      }
      placeTower(x, y).catch((err) =>
        console.warn("placeTower failed:", err?.message ?? err)
      )
    }
  }

  return (
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
        style={{ cursor: busy ? "wait" : "crosshair", width: SIZE, height: SIZE }}
        onClick={onClick}
      />
    </Box>
  )
}

export default TowerDefenseBoard
