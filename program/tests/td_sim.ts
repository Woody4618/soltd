// Deterministic tower-defense simulator, ported 1:1 from the on-chain Rust
// tick loop (`Board::apply_ticks` / `apply_tick_shots` in state/td_board.rs).
//
// Because the on-chain game is pure integer math with a fixed iteration order,
// running this loop from the same starting board state for the same number of
// ticks reproduces the on-chain result bit-for-bit. The client uses this to
// predict/animate ahead of confirmation and to render multiplayer boards from
// a streamed account.

// Mirror of constants.rs (Tower Defense section).
export const SUBTILES_PER_TILE = 256;

export const TOWER_KIND_NONE = 0;

export const UNIT_STATE_EMPTY = 0;
export const UNIT_STATE_QUEUED = 1;
export const UNIT_STATE_WALKING = 2;
export const UNIT_STATE_DEAD = 3;
export const UNIT_STATE_REACHED_END = 4;

export interface SimPathPoint {
  x: number;
  y: number;
}

export interface SimTower {
  kind: number;
  level: number;
  x: number;
  y: number;
  rangeSubtiles: number;
  damage: number;
  cooldownTicks: number;
  lastShotTick: number;
  readyAtTick: number;
}

export interface SimUnit {
  state: number;
  speedSubtiles: number;
  hp: number;
  maxHp: number;
  reward: number;
  spawnTick: number;
  progressSubtiles: number;
}

export interface SimBoard {
  currentTick: number;
  lives: number;
  gold: number;
  kills: number;
  pathLen: number;
  path: SimPathPoint[];
  towerCount: number;
  towers: SimTower[];
  units: SimUnit[];
}

// Total path length in sub-tiles (sum of Manhattan segment lengths).
export function pathLengthSubtiles(board: SimBoard): number {
  let total = 0;
  for (let i = 1; i < board.pathLen; i++) {
    const a = board.path[i - 1];
    const b = board.path[i];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    total += (dx + dy) * SUBTILES_PER_TILE;
  }
  return total;
}

// Sub-tile position along the path at a given progress offset.
export function positionAt(board: SimBoard, progress: number): [number, number] {
  const len = board.pathLen;
  if (len === 0) return [0, 0];
  let remaining = progress;
  for (let i = 1; i < len; i++) {
    const a = board.path[i - 1];
    const b = board.path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segTiles = Math.abs(dx) + Math.abs(dy);
    const segSub = segTiles * SUBTILES_PER_TILE;
    if (remaining < segSub) {
      const ax = a.x * SUBTILES_PER_TILE;
      const ay = a.y * SUBTILES_PER_TILE;
      const stepX = Math.sign(dx);
      const stepY = Math.sign(dy);
      return [ax + stepX * remaining, ay + stepY * remaining];
    }
    remaining -= segSub;
  }
  const last = board.path[len - 1];
  return [last.x * SUBTILES_PER_TILE, last.y * SUBTILES_PER_TILE];
}

// Resolve tower shots for a single tick (mirror of apply_tick_shots).
function applyTickShots(board: SimBoard, tick: number): void {
  for (let ti = 0; ti < board.towerCount; ti++) {
    const tower = board.towers[ti];
    if (tower.kind === TOWER_KIND_NONE) continue;
    if (tick < tower.readyAtTick) continue;
    if (tower.lastShotTick !== 0 && tick - tower.lastShotTick < tower.cooldownTicks) {
      continue;
    }

    const tx = tower.x * SUBTILES_PER_TILE;
    const ty = tower.y * SUBTILES_PER_TILE;
    const rangeSq = tower.rangeSubtiles * tower.rangeSubtiles;

    let best = -1;
    let bestProgress = 0;
    for (let ui = 0; ui < board.units.length; ui++) {
      const u = board.units[ui];
      if (u.state !== UNIT_STATE_WALKING) continue;
      const [ux, uy] = positionAt(board, u.progressSubtiles);
      const dx = ux - tx;
      const dy = uy - ty;
      const distSq = dx * dx + dy * dy;
      if (distSq <= rangeSq) {
        if (best === -1 || u.progressSubtiles > bestProgress) {
          best = ui;
          bestProgress = u.progressSubtiles;
        }
      }
    }

    if (best !== -1) {
      const unit = board.units[best];
      unit.hp = Math.max(0, unit.hp - tower.damage);
      if (unit.hp === 0) {
        unit.state = UNIT_STATE_DEAD;
        board.gold += unit.reward;
        board.kills += 1;
      }
      board.towers[ti].lastShotTick = tick;
    }
  }
}

// Advance the simulation by exactly `ticks` ticks (mirror of apply_ticks).
export function applyTicks(board: SimBoard, ticks: number): void {
  const pathLenSub = pathLengthSubtiles(board);
  for (let applied = 0; applied < ticks; applied++) {
    const tick = board.currentTick + 1;

    applyTickShots(board, tick);

    for (let i = 0; i < board.units.length; i++) {
      const u = board.units[i];
      if (u.state === UNIT_STATE_QUEUED) {
        if (u.spawnTick <= tick) u.state = UNIT_STATE_WALKING;
      } else if (u.state === UNIT_STATE_WALKING) {
        const newProgress = u.progressSubtiles + u.speedSubtiles;
        if (newProgress >= pathLenSub) {
          u.progressSubtiles = pathLenSub;
          u.state = UNIT_STATE_REACHED_END;
          board.lives = Math.max(0, board.lives - 1);
        } else {
          u.progressSubtiles = newProgress;
        }
      }
    }

    board.currentTick = tick;
  }
}

// Convert an on-chain (Anchor-decoded) board account into a SimBoard. Handles
// BN / number fields from the IDL decoder.
export function fromChain(acc: any): SimBoard {
  const num = (v: any) => (typeof v === "number" ? v : Number(v));
  return {
    currentTick: num(acc.currentTick),
    lives: num(acc.lives),
    gold: num(acc.gold),
    kills: num(acc.kills),
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
      lastShotTick: num(t.lastShotTick),
      readyAtTick: num(t.readyAtTick),
    })),
    units: acc.units.map((u: any) => ({
      state: num(u.state),
      speedSubtiles: num(u.speedSubtiles),
      hp: num(u.hp),
      maxHp: num(u.maxHp),
      reward: num(u.reward),
      spawnTick: num(u.spawnTick),
      progressSubtiles: num(u.progressSubtiles),
    })),
  };
}
