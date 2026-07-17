// Deterministic tower-defense simulator, ported 1:1 from the on-chain Rust
// tick loop (`Board::apply_ticks` / `apply_tick_shots` in state/td_board.rs).
//
// Because the on-chain game is pure integer math with a fixed iteration order,
// running this loop from the same starting board state for the same number of
// ticks reproduces the on-chain result bit-for-bit. The client uses this to
// predict/animate ahead of confirmation and to render the board smoothly
// between on-chain advance_game calls.

export const SUBTILES_PER_TILE = 256

// Tower + enemy kind ids and the enemy balance table come from the generated
// mirror (single source of truth, kept in sync with the program by codegen).
import {
  TOWER_KIND_NONE,
  TOWER_KIND_BASIC,
  ENEMY_KIND_NORMAL,
  ENEMY_KIND_FAST,
  ENEMY_KIND_STRONG,
  ENEMY_KIND_BOSS,
  BOSS_WAVE_INTERVAL,
  enemyDef,
} from "./tdDefs"
export {
  TOWER_KIND_NONE,
  TOWER_KIND_BASIC,
  ENEMY_KIND_NORMAL,
  ENEMY_KIND_FAST,
  ENEMY_KIND_STRONG,
  ENEMY_KIND_BOSS,
}

export const UNIT_STATE_EMPTY = 0
export const UNIT_STATE_QUEUED = 1
export const UNIT_STATE_WALKING = 2
export const UNIT_STATE_DEAD = 3
export const UNIT_STATE_REACHED_END = 4

// Mirror of constants.rs. MUST stay in sync with the program so client
// prediction reproduces auto-waves bit-for-bit.
const MAX_UNITS = 16
const UNIT_SPAWN_STAGGER_TICKS = 10
const UNIT_MAX_SPEED_SUBTILES = SUBTILES_PER_TILE

export const WAVE_FIRST_DELAY_TICKS = 40
export const WAVE_INTERVAL_TICKS = 120
// Early-wave trigger: if the board is cleared before the cooldown, the next
// wave starts after only this short breather (mirror of the program).
const WAVE_CLEAR_BREATHER_TICKS = 20
const WAVE_BASE_COUNT = 4
const WAVE_COUNT_GROWTH = 1
// COMPOUNDING per-wave growth (mirror of the program: iterative x(100+g)/100).
const WAVE_HP_GROWTH_PERCENT = 18
const WAVE_SPEED_GROWTH_PERCENT = 3
const WAVE_REWARD_GROWTH_PERCENT = 10

export interface SimPathPoint {
  x: number
  y: number
}

export interface SimTower {
  kind: number
  level: number
  x: number
  y: number
  rangeSubtiles: number
  damage: number
  cooldownTicks: number
  // AoE splash radius in sub-tiles around the target. 0 = single target.
  splashRadiusSubtiles: number
  // Pending upgrade (deferred like the initial build). 0 = none.
  pendingLevel: number
  pendingDamage: number
  pendingRangeSubtiles: number
  lastShotTick: number
  readyAtTick: number
}

export interface SimUnit {
  state: number
  enemyKind: number
  speedSubtiles: number
  hp: number
  maxHp: number
  reward: number
  spawnTick: number
  progressSubtiles: number
}

export interface SimBoard {
  currentTick: number
  lives: number
  gold: number
  kills: number
  waveNumber: number
  nextWaveTick: number
  pathLen: number
  path: SimPathPoint[]
  towerCount: number
  towers: SimTower[]
  units: SimUnit[]
}

// Number of units in wave n (0-indexed), clamped to slot capacity.
function waveUnitCount(n: number): number {
  return Math.min(WAVE_BASE_COUNT + n * WAVE_COUNT_GROWTH, MAX_UNITS)
}

// Is wave n (0-indexed) a boss wave? Mirror of Board::is_boss_wave.
export function isBossWave(n: number): boolean {
  return n > 0 && (n + 1) % BOSS_WAVE_INTERVAL === 0
}

// Enemy type for the `index`-th unit spawned in wave n. Pure function of
// (n, index) - mirror of Board::wave_enemy_kind.
export function waveEnemyKind(n: number, index: number): number {
  if (isBossWave(n) && index === 0) return ENEMY_KIND_BOSS
  switch ((index + n) % 6) {
    case 2:
    case 5:
      return ENEMY_KIND_FAST
    case 3:
      return ENEMY_KIND_STRONG
    case 0:
      return n >= 4 ? ENEMY_KIND_STRONG : ENEMY_KIND_NORMAL
    default:
      return ENEMY_KIND_NORMAL
  }
}

// Per-unit stats for enemy `kind` in wave n: [hp, speedSubtiles, reward]. The
// type supplies the wave-0 base (from the generated ENEMY_DEFS); COMPOUNDING
// per-wave growth is applied on top, mirroring the program's integer loop
// exactly (multiply by (100+g)/100 and floor each wave). Values stay well under
// 2^53 so plain numbers match Rust u64.
const U32_MAX = 4294967295
function waveUnitStats(n: number, kind: number): [number, number, number] {
  const def = enemyDef(kind)
  const compound = (base: number, growthPct: number, cap: number): number => {
    const mult = 100 + growthPct
    let v = base
    for (let i = 0; i < n; i++) {
      v = Math.floor((v * mult) / 100)
      if (v >= cap) return cap
    }
    return Math.min(v, cap)
  }
  const hp = Math.max(1, compound(def.hp, WAVE_HP_GROWTH_PERCENT, U32_MAX))
  const speed = Math.min(
    UNIT_MAX_SPEED_SUBTILES,
    Math.max(
      1,
      compound(
        def.speedSubtiles,
        WAVE_SPEED_GROWTH_PERCENT,
        UNIT_MAX_SPEED_SUBTILES
      )
    )
  )
  const reward = compound(def.reward, WAVE_REWARD_GROWTH_PERCENT, U32_MAX)
  return [hp, speed, reward]
}

function freeUnitSlot(board: SimBoard): number {
  for (let i = 0; i < board.units.length; i++) {
    const s = board.units[i].state
    if (
      s === UNIT_STATE_EMPTY ||
      s === UNIT_STATE_DEAD ||
      s === UNIT_STATE_REACHED_END
    ) {
      return i
    }
  }
  return -1
}

// Queue the auto-wave for board.waveNumber, staggered from baseTick. Mirrors
// Board::spawn_auto_wave.
function spawnAutoWave(board: SimBoard, baseTick: number): void {
  const n = board.waveNumber
  const count = waveUnitCount(n)
  let spawned = 0
  let placed = 0
  while (placed < count) {
    const slot = freeUnitSlot(board)
    if (slot === -1) break
    const kind = waveEnemyKind(n, placed)
    const [hp, speed, reward] = waveUnitStats(n, kind)
    const u = board.units[slot]
    u.state = UNIT_STATE_QUEUED
    u.enemyKind = kind
    u.speedSubtiles = speed
    u.hp = hp
    u.maxHp = hp
    u.reward = reward
    u.spawnTick = baseTick + spawned * UNIT_SPAWN_STAGGER_TICKS
    u.progressSubtiles = 0
    spawned += 1
    placed += 1
  }
  board.waveNumber = n + 1
}

// Count of units currently queued or walking (mirror of active_unit_count).
function activeUnitCount(board: SimBoard): number {
  let n = 0
  for (let i = 0; i < board.units.length; i++) {
    const s = board.units[i].state
    if (s === UNIT_STATE_QUEUED || s === UNIT_STATE_WALKING) n += 1
  }
  return n
}

// Total path length in sub-tiles (sum of Manhattan segment lengths).
export function pathLengthSubtiles(board: SimBoard): number {
  let total = 0
  for (let i = 1; i < board.pathLen; i++) {
    const a = board.path[i - 1]
    const b = board.path[i]
    const dx = Math.abs(a.x - b.x)
    const dy = Math.abs(a.y - b.y)
    total += (dx + dy) * SUBTILES_PER_TILE
  }
  return total
}

// Sub-tile position along the path at a given progress offset.
export function positionAt(board: SimBoard, progress: number): [number, number] {
  const len = board.pathLen
  if (len === 0) return [0, 0]
  let remaining = progress
  for (let i = 1; i < len; i++) {
    const a = board.path[i - 1]
    const b = board.path[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const segTiles = Math.abs(dx) + Math.abs(dy)
    const segSub = segTiles * SUBTILES_PER_TILE
    if (remaining < segSub) {
      const ax = a.x * SUBTILES_PER_TILE
      const ay = a.y * SUBTILES_PER_TILE
      const stepX = Math.sign(dx)
      const stepY = Math.sign(dy)
      return [ax + stepX * remaining, ay + stepY * remaining]
    }
    remaining -= segSub
  }
  const last = board.path[len - 1]
  return [last.x * SUBTILES_PER_TILE, last.y * SUBTILES_PER_TILE]
}

// A single tower shot that landed during simulation. Emitted via the optional
// ShotSink so the renderer can draw one distinct bullet + damage number per
// shot, instead of lumping several shots into one frame-diff delta.
export interface ShotEvent {
  tick: number
  towerIndex: number
  towerX: number
  towerY: number
  unitIndex: number
  damage: number // actual hp removed (clamped to remaining hp)
  killed: boolean
}
export type ShotSink = (e: ShotEvent) => void

// Resolve tower shots for a single tick (mirror of apply_tick_shots). When
// `onShot` is provided, each landed shot is reported for animation.
function applyTickShots(
  board: SimBoard,
  tick: number,
  onShot?: ShotSink
): void {
  for (let ti = 0; ti < board.towerCount; ti++) {
    const tower = board.towers[ti]
    if (tower.kind === TOWER_KIND_NONE) continue
    // Initial-build gate only (pendingLevel === 0). A tower with a pending
    // upgrade is already built and keeps firing at its current stats.
    if (tower.pendingLevel === 0 && tick < tower.readyAtTick) continue
    if (tower.lastShotTick !== 0 && tick - tower.lastShotTick < tower.cooldownTicks) {
      continue
    }

    const tx = tower.x * SUBTILES_PER_TILE
    const ty = tower.y * SUBTILES_PER_TILE
    const rangeSq = tower.rangeSubtiles * tower.rangeSubtiles

    let best = -1
    let bestProgress = 0
    for (let ui = 0; ui < board.units.length; ui++) {
      const u = board.units[ui]
      if (u.state !== UNIT_STATE_WALKING) continue
      const [ux, uy] = positionAt(board, u.progressSubtiles)
      const dx = ux - tx
      const dy = uy - ty
      const distSq = dx * dx + dy * dy
      if (distSq <= rangeSq) {
        if (best === -1 || u.progressSubtiles > bestProgress) {
          best = ui
          bestProgress = u.progressSubtiles
        }
      }
    }

    if (best !== -1) {
      // Apply `tower.damage` to a unit (walking + alive only), handling kill
      // bookkeeping and emitting a ShotEvent. Mirrors Board::damage_unit.
      const damageUnit = (idx: number) => {
        const u = board.units[idx]
        if (u.state !== UNIT_STATE_WALKING) return
        const dealt = Math.min(u.hp, tower.damage)
        u.hp = Math.max(0, u.hp - tower.damage)
        const killed = u.hp === 0
        if (killed) {
          u.state = UNIT_STATE_DEAD
          board.gold += u.reward
          board.kills += 1
        }
        if (onShot) {
          onShot({
            tick,
            towerIndex: ti,
            towerX: tower.x,
            towerY: tower.y,
            unitIndex: idx,
            damage: dealt,
            killed,
          })
        }
      }

      damageUnit(best)

      // Splash: also hit every OTHER walking unit within splashRadius of the
      // PRIMARY TARGET's position. Mirror of the program (fixed index order,
      // integer squared distance, same damage). splashRadius === 0 skips it.
      const splash = tower.splashRadiusSubtiles
      if (splash > 0) {
        const [cx, cy] = positionAt(board, board.units[best].progressSubtiles)
        const splashSq = splash * splash
        for (let si = 0; si < board.units.length; si++) {
          if (si === best) continue
          if (board.units[si].state !== UNIT_STATE_WALKING) continue
          const [ux, uy] = positionAt(board, board.units[si].progressSubtiles)
          const dx = ux - cx
          const dy = uy - cy
          if (dx * dx + dy * dy <= splashSq) damageUnit(si)
        }
      }

      board.towers[ti].lastShotTick = tick
    }
  }
}

// Advance the simulation by exactly `ticks` ticks (mirror of apply_ticks). When
// `onShot` is provided, every individual tower shot is reported so the renderer
// can animate distinct hits.
export function applyTicks(
  board: SimBoard,
  ticks: number,
  onShot?: ShotSink
): void {
  const pathLenSub = pathLengthSubtiles(board)
  for (let applied = 0; applied < ticks; applied++) {
    const tick = board.currentTick + 1

    // Early-wave trigger: once a wave has spawned, if the board is fully cleared
    // before the cooldown elapses, pull the next wave forward to a short
    // breather (never push it later). Mirror of the program.
    if (board.waveNumber > 0 && activeUnitCount(board) === 0) {
      const early = tick + WAVE_CLEAR_BREATHER_TICKS
      if (early < board.nextWaveTick) {
        board.nextWaveTick = early
      }
    }

    if (tick >= board.nextWaveTick) {
      spawnAutoWave(board, tick)
      board.nextWaveTick = tick + WAVE_INTERVAL_TICKS
    }

    // Commit any pending tower upgrades that finish this tick (mirror of the
    // program). Until then the tower keeps its current stats and stays online.
    const tc = board.towerCount
    for (let tu = 0; tu < tc; tu++) {
      const t = board.towers[tu]
      if (t.pendingLevel !== 0 && tick >= t.readyAtTick) {
        t.level = t.pendingLevel
        t.damage = t.pendingDamage
        t.rangeSubtiles = t.pendingRangeSubtiles
        t.pendingLevel = 0
        t.pendingDamage = 0
        t.pendingRangeSubtiles = 0
      }
    }

    applyTickShots(board, tick, onShot)

    for (let i = 0; i < board.units.length; i++) {
      const u = board.units[i]
      if (u.state === UNIT_STATE_QUEUED) {
        if (u.spawnTick <= tick) u.state = UNIT_STATE_WALKING
      } else if (u.state === UNIT_STATE_WALKING) {
        const newProgress = u.progressSubtiles + u.speedSubtiles
        if (newProgress >= pathLenSub) {
          u.progressSubtiles = pathLenSub
          u.state = UNIT_STATE_REACHED_END
          board.lives = Math.max(0, board.lives - 1)
        } else {
          u.progressSubtiles = newProgress
        }
      }
    }

    board.currentTick = tick
  }
}

// Convert an on-chain (Anchor-decoded) board account into a SimBoard. Handles
// BN / number fields from the IDL decoder.
export function fromChain(acc: any): SimBoard {
  const num = (v: any) => (typeof v === "number" ? v : Number(v))
  return {
    currentTick: num(acc.currentTick),
    lives: num(acc.lives),
    gold: num(acc.gold),
    kills: num(acc.kills),
    waveNumber: num(acc.waveNumber),
    nextWaveTick: num(acc.nextWaveTick),
    pathLen: num(acc.pathLen),
    path: acc.path.map((p: any) => ({ x: num(p.x), y: num(p.y) })),
    towerCount: num(acc.towerCount),
    towers: acc.towers.map((t: any) => ({
      kind: num(t.kind),
      level: num(t.level),
      x: num(t.x),
      y: num(t.y),
      rangeSubtiles: num(t.rangeSubtiles),
      damage: num(t.damage),
      cooldownTicks: num(t.cooldownTicks),
      splashRadiusSubtiles: num(t.splashRadiusSubtiles),
      pendingLevel: num(t.pendingLevel),
      pendingDamage: num(t.pendingDamage),
      pendingRangeSubtiles: num(t.pendingRangeSubtiles),
      lastShotTick: num(t.lastShotTick),
      readyAtTick: num(t.readyAtTick),
    })),
    units: acc.units.map((u: any) => ({
      state: num(u.state),
      enemyKind: num(u.enemyKind),
      speedSubtiles: num(u.speedSubtiles),
      hp: num(u.hp),
      maxHp: num(u.maxHp),
      reward: num(u.reward),
      spawnTick: num(u.spawnTick),
      progressSubtiles: num(u.progressSubtiles),
    })),
  }
}

// Deep-clone a SimBoard so prediction can run without mutating confirmed state.
export function cloneBoard(board: SimBoard): SimBoard {
  return {
    currentTick: board.currentTick,
    lives: board.lives,
    gold: board.gold,
    kills: board.kills,
    waveNumber: board.waveNumber,
    nextWaveTick: board.nextWaveTick,
    pathLen: board.pathLen,
    path: board.path.map((p) => ({ ...p })),
    towerCount: board.towerCount,
    towers: board.towers.map((t) => ({ ...t })),
    units: board.units.map((u) => ({ ...u })),
  }
}
