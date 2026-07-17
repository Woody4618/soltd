use crate::constants::*;
use anchor_lang::prelude::*;

// Tower kinds. Stored as u8 in zero-copy structs (enums-with-data are not Pod).
pub const TOWER_KIND_NONE: u8 = 0;
pub const TOWER_KIND_BASIC: u8 = 1;
pub const TOWER_KIND_SPLASH: u8 = 2;

// Unit status flags stored as u8.
pub const UNIT_STATE_EMPTY: u8 = 0; // slot unused
pub const UNIT_STATE_QUEUED: u8 = 1; // spawned, waiting for spawn_tick
pub const UNIT_STATE_WALKING: u8 = 2; // moving along the path
pub const UNIT_STATE_DEAD: u8 = 3; // killed by a tower
pub const UNIT_STATE_REACHED_END: u8 = 4; // reached the end of the path (leaked)

// Enemy kinds. Stored as u8 on the Unit. Each kind has one row in ENEMY_DEFS
// (constants.rs), indexed by its id. Kind 0 = NORMAL so an all-zero (freshly
// zeroed) unit slot decodes as a plain normal unit.
pub const ENEMY_KIND_NORMAL: u8 = 0;
pub const ENEMY_KIND_FAST: u8 = 1;
pub const ENEMY_KIND_STRONG: u8 = 2;
pub const ENEMY_KIND_BOSS: u8 = 3;

/// A single waypoint on the deterministic path, in grid tile coordinates.
#[zero_copy]
#[repr(C)]
pub struct PathPoint {
    pub x: u8,
    pub y: u8,
    pub _pad: [u8; 2],
}

/// A tower placed on the grid.
///
/// Upgrades are deferred like the initial build: the boosted stats are stored
/// in the `pending_*` fields and only committed once `current_tick` reaches
/// `ready_at_tick`. Until then the tower keeps shooting with its current
/// (pre-upgrade) stats. `pending_level == 0` means "no pending upgrade".
#[zero_copy]
#[repr(C)]
pub struct Tower {
    pub kind: u8, // TOWER_KIND_*
    pub level: u8,
    pub x: u8,
    pub y: u8,
    pub range_subtiles: u32, // targeting range in sub-tiles
    pub damage: u32,         // damage per shot
    pub cooldown_ticks: u32, // ticks between shots
    pub pending_level: u8,   // level after the in-progress upgrade (0 = none)
    pub _pad2: [u8; 3],
    pub pending_damage: u32, // damage after the in-progress upgrade
    pub pending_range_subtiles: u32, // range after the in-progress upgrade
    // AoE radius in sub-tiles around the primary target. 0 = single-target
    // (basic tower). Fixed per kind; NOT changed by upgrades. Occupies the u32
    // slot that used to be _pad3, so the account layout/size is unchanged and
    // existing on-chain boards stay valid without a realloc.
    pub splash_radius_subtiles: u32,
    pub last_shot_tick: u64, // tick of the last shot fired (0 = never)
    pub ready_at_tick: u64,  // tick the build/upgrade finishes (stats commit)
}

/// A moving enemy unit. Position is a scalar offset along the path measured in
/// sub-tiles from the first waypoint. Fully deterministic given (spawn_tick,
/// speed, current_tick).
#[zero_copy]
#[repr(C)]
pub struct Unit {
    pub state: u8, // UNIT_STATE_*
    // Enemy type (ENEMY_KIND_*). Occupies the first byte of what used to be
    // pure padding, so the Unit layout/size is unchanged and existing on-chain
    // boards stay valid. NORMAL == 0 means an old/zeroed unit reads as normal.
    pub enemy_kind: u8,
    pub _pad: [u8; 2],
    pub speed_subtiles: u32, // sub-tiles travelled per tick
    pub hp: u32,
    pub max_hp: u32,
    pub reward: u32,
    pub _pad1: u32, // keep the following u64 fields 8-byte aligned (no implicit padding)
    pub spawn_tick: u64,      // tick at which the unit starts walking
    pub progress_subtiles: u64, // distance travelled along the path
}

/// The full game board. Zero-copy so it can be large and cheap to touch.
#[account(zero_copy)]
#[repr(C)]
pub struct Board {
    pub authority: Pubkey,
    pub current_tick: u64,
    pub last_tick_timestamp: i64, // wall-clock of last advance (tick-budget gate)
    pub last_id: u16,             // uniqueness for same-block slices
    pub grid_size: u8,
    pub path_len: u8,
    pub tower_count: u8,
    pub _pad0: [u8; 3],
    pub lives: u32,           // leaks remaining before game over
    pub gold: u32,            // currency for placing/upgrading towers
    pub kills: u32,           // units killed
    pub next_unit_id: u32,    // monotonic id for spawned units
    pub wave_number: u32,     // how many auto-waves have spawned so far
    pub _pad1: [u8; 4],       // keep the following u64 8-byte aligned
    pub next_wave_tick: u64,  // tick at which the next auto-wave spawns
    pub path: [PathPoint; MAX_PATH_LEN],
    pub towers: [Tower; MAX_TOWERS],
    pub units: [Unit; MAX_UNITS],
}

impl Board {
    /// Total length of the path in sub-tiles (sum of Manhattan segment lengths
    /// between consecutive waypoints). Deterministic integer math.
    pub fn path_length_subtiles(&self) -> u64 {
        let mut total: u64 = 0;
        let len = self.path_len as usize;
        let mut i = 1usize;
        while i < len {
            let a = &self.path[i - 1];
            let b = &self.path[i];
            let dx = (a.x as i32 - b.x as i32).unsigned_abs();
            let dy = (a.y as i32 - b.y as i32).unsigned_abs();
            total = total.saturating_add(((dx + dy) as u64) * SUBTILES_PER_TILE as u64);
            i += 1;
        }
        total
    }

    /// Convert a progress offset (in sub-tiles) into a grid tile position by
    /// walking the path segments. Returns (x_subtile, y_subtile) in sub-tile
    /// units so callers can do integer distance math without floats.
    pub fn position_at(&self, progress_subtiles: u64) -> (i64, i64) {
        let len = self.path_len as usize;
        if len == 0 {
            return (0, 0);
        }
        let mut remaining = progress_subtiles;
        let mut i = 1usize;
        while i < len {
            let a = &self.path[i - 1];
            let b = &self.path[i];
            let dx = b.x as i32 - a.x as i32;
            let dy = b.y as i32 - a.y as i32;
            let seg_tiles = (dx.abs() + dy.abs()) as u64;
            let seg_sub = seg_tiles * SUBTILES_PER_TILE as u64;
            if remaining < seg_sub {
                // Interpolate along this segment. Only one of dx/dy is nonzero
                // for an axis-aligned path, but handle both to be safe.
                let ax = a.x as i64 * SUBTILES_PER_TILE as i64;
                let ay = a.y as i64 * SUBTILES_PER_TILE as i64;
                let step_x = dx.signum() as i64;
                let step_y = dy.signum() as i64;
                return (
                    ax + step_x * remaining as i64,
                    ay + step_y * remaining as i64,
                );
            }
            remaining -= seg_sub;
            i += 1;
        }
        // Past the end: clamp to the last waypoint.
        let last = &self.path[len - 1];
        (
            last.x as i64 * SUBTILES_PER_TILE as i64,
            last.y as i64 * SUBTILES_PER_TILE as i64,
        )
    }

    /// Is (x, y) inside the grid bounds?
    pub fn in_bounds(&self, x: u8, y: u8) -> bool {
        x < self.grid_size && y < self.grid_size
    }

    /// Does any path waypoint segment pass through tile (x, y)? Towers may not
    /// be built on the path itself. Path is axis-aligned so this is exact.
    pub fn is_on_path(&self, x: u8, y: u8) -> bool {
        let len = self.path_len as usize;
        let mut i = 1usize;
        while i < len {
            let a = &self.path[i - 1];
            let b = &self.path[i];
            let (x0, x1) = (a.x.min(b.x), a.x.max(b.x));
            let (y0, y1) = (a.y.min(b.y), a.y.max(b.y));
            if x >= x0 && x <= x1 && y >= y0 && y <= y1 {
                return true;
            }
            i += 1;
        }
        // Also check the very first waypoint when there is only one point.
        if len == 1 {
            return self.path[0].x == x && self.path[0].y == y;
        }
        false
    }

    /// Is a tower already occupying tile (x, y)?
    pub fn tile_has_tower(&self, x: u8, y: u8) -> bool {
        let count = self.tower_count as usize;
        let mut i = 0usize;
        while i < count {
            let t = &self.towers[i];
            if t.kind != TOWER_KIND_NONE && t.x == x && t.y == y {
                return true;
            }
            i += 1;
        }
        false
    }

    /// Find the first reusable unit slot index, if any. A slot is reusable when
    /// it is unused (EMPTY) or holds a unit that is no longer in play (DEAD, or
    /// REACHED_END after leaking) - those units are done and can be overwritten.
    pub fn free_unit_slot(&self) -> Option<usize> {
        let mut i = 0usize;
        while i < MAX_UNITS {
            let s = self.units[i].state;
            if s == UNIT_STATE_EMPTY
                || s == UNIT_STATE_DEAD
                || s == UNIT_STATE_REACHED_END
            {
                return Some(i);
            }
            i += 1;
        }
        None
    }

    /// Number of units in wave `n` (0-indexed), clamped to slot capacity.
    pub fn wave_unit_count(n: u32) -> u32 {
        let raw = WAVE_BASE_COUNT.saturating_add(n.saturating_mul(WAVE_COUNT_GROWTH));
        raw.min(MAX_UNITS as u32)
    }

    /// Is wave `n` (0-indexed) a boss wave? True on every BOSS_WAVE_INTERVAL-th
    /// wave (n = 4, 9, 14, ... => the 5th, 10th, ...). Wave 0 never has a boss.
    pub fn is_boss_wave(n: u32) -> bool {
        n > 0 && (n + 1) % BOSS_WAVE_INTERVAL == 0
    }

    /// Deterministic enemy type for the `index`-th unit spawned in wave `n`.
    /// Pure function of (n, index) so the client reproduces the exact roster.
    ///
    /// - On a boss wave the FIRST unit is the BOSS (it takes a normal's slot -
    ///   the "replace" model), the rest use the standard mix.
    /// - The standard mix is a fixed repeating pattern (rotated by wave number
    ///   so successive waves aren't identical) with a growing share of tougher
    ///   types as waves climb.
    pub fn wave_enemy_kind(n: u32, index: u32) -> u8 {
        if Self::is_boss_wave(n) && index == 0 {
            return ENEMY_KIND_BOSS;
        }
        // Rotate the pattern by wave so the lineup shifts each wave.
        match (index + n) % 6 {
            2 | 5 => ENEMY_KIND_FAST,
            3 => ENEMY_KIND_STRONG,
            // From wave 4 onward, promote one more slot to STRONG for pressure.
            0 if n >= 4 => ENEMY_KIND_STRONG,
            _ => ENEMY_KIND_NORMAL,
        }
    }

    /// Per-unit stats for a given enemy `kind` in wave `n` (0-indexed):
    /// (hp, speed_subtiles, reward). The enemy type supplies the wave-0 base
    /// (from ENEMY_DEFS); difficulty then COMPOUNDS per wave: each wave
    /// multiplies the base by (100+growth)/100, applied `n` times with integer
    /// math (dividing every step keeps values small and overflow-free, and is
    /// bit-identical to the TS client which runs the exact same loop). A u64
    /// accumulator with a hard cap makes this safe for arbitrarily deep runs.
    pub fn wave_unit_stats(n: u32, kind: u8) -> (u32, u32, u32) {
        let def = enemy_def(kind);
        // Iteratively compound `base` by `growth_pct` for `n` waves, clamped to
        // `cap` so a very deep run can never overflow a u32 stat.
        let compound = |base: u32, growth_pct: u32, cap: u64| -> u64 {
            let mult = 100u64.saturating_add(growth_pct as u64);
            let mut v = base as u64;
            let mut i = 0u32;
            while i < n {
                v = v.saturating_mul(mult) / 100;
                if v >= cap {
                    return cap;
                }
                i += 1;
            }
            v.min(cap)
        };
        let hp = compound(def.hp, WAVE_HP_GROWTH_PERCENT, u32::MAX as u64).max(1) as u32;
        let speed = (compound(
            def.speed_subtiles,
            WAVE_SPEED_GROWTH_PERCENT,
            UNIT_MAX_SPEED_SUBTILES as u64,
        ) as u32)
            .max(1)
            .min(UNIT_MAX_SPEED_SUBTILES);
        let reward = compound(def.reward, WAVE_REWARD_GROWTH_PERCENT, u32::MAX as u64) as u32;
        (hp, speed, reward)
    }

    /// Queue the auto-wave for the current `wave_number`, filling free unit
    /// slots with staggered spawn ticks relative to `base_tick`. Deterministic.
    fn spawn_auto_wave(&mut self, base_tick: u64) {
        let n = self.wave_number;
        let count = Self::wave_unit_count(n);

        let mut spawned: u64 = 0;
        let mut placed: u32 = 0;
        while placed < count {
            let slot = match self.free_unit_slot() {
                Some(s) => s,
                None => break, // board full; skip the rest of this wave
            };
            // Enemy type + stats are a pure function of (wave, index-in-wave),
            // so the client reproduces the exact roster and stat block.
            let kind = Self::wave_enemy_kind(n, placed);
            let (hp, speed, reward) = Self::wave_unit_stats(n, kind);
            let spawn_tick =
                base_tick.saturating_add(spawned.saturating_mul(UNIT_SPAWN_STAGGER_TICKS));
            let unit = &mut self.units[slot];
            unit.state = UNIT_STATE_QUEUED;
            unit.enemy_kind = kind;
            unit.speed_subtiles = speed;
            unit.hp = hp;
            unit.max_hp = hp;
            unit.reward = reward;
            unit.spawn_tick = spawn_tick;
            unit.progress_subtiles = 0;
            self.next_unit_id = self.next_unit_id.saturating_add(1);
            spawned += 1;
            placed += 1;
        }

        self.wave_number = self.wave_number.saturating_add(1);
    }

    /// Count of units currently queued or walking (still in play).
    pub fn active_unit_count(&self) -> u32 {
        let mut n = 0u32;
        let mut i = 0usize;
        while i < MAX_UNITS {
            let s = self.units[i].state;
            if s == UNIT_STATE_QUEUED || s == UNIT_STATE_WALKING {
                n += 1;
            }
            i += 1;
        }
        n
    }

    /// Advance the simulation by exactly `ticks` ticks. This is a PURE function
    /// of the board state and tick count - NO Clock, NO randomness - so the TS
    /// client can run the identical loop to predict state bit-for-bit.
    ///
    /// Per tick, in fixed unit-index order:
    ///   1. Queued units whose spawn_tick has arrived start walking.
    ///   2. Walking units advance by `speed_subtiles` along the path.
    ///   3. Units that reach the path end leak (decrement a life) and are
    ///      marked as reached-end.
    ///
    /// Tower shots are resolved by `apply_tick_shots`, called after movement in
    /// a later milestone. Keeping movement isolated keeps each milestone's test
    /// exact.
    pub fn apply_ticks(&mut self, ticks: u64) {
        let path_len_sub = self.path_length_subtiles();
        let mut applied = 0u64;
        while applied < ticks {
            let tick = self.current_tick.saturating_add(1);

            // Early-wave trigger: once at least one wave has spawned, if the
            // board is fully cleared before the cooldown elapses, pull the next
            // wave forward to a short breather from now (never push it later).
            // This is deterministic - `active_unit_count` is a pure function of
            // unit state - so the client predicts the exact same schedule.
            if self.wave_number > 0 && self.active_unit_count() == 0 {
                let early = tick.saturating_add(WAVE_CLEAR_BREATHER_TICKS);
                if early < self.next_wave_tick {
                    self.next_wave_tick = early;
                }
            }

            // Auto-wave: when we reach the scheduled tick, queue the next wave
            // (escalating count + stats) and schedule the following one. Units
            // are queued relative to this tick so they file in after it. This
            // lives in the deterministic loop so waves are on-chain and cannot
            // be forged by the client.
            if tick >= self.next_wave_tick {
                self.spawn_auto_wave(tick);
                self.next_wave_tick = tick.saturating_add(WAVE_INTERVAL_TICKS);
            }

            // Commit any pending tower upgrades that finish building this tick.
            // Until this fires the tower keeps its current (pre-upgrade) stats,
            // so it stays online and shoots at the old power during the build.
            let mut tu = 0usize;
            let tc = self.tower_count as usize;
            while tu < tc {
                let t = &mut self.towers[tu];
                if t.pending_level != 0 && tick >= t.ready_at_tick {
                    t.level = t.pending_level;
                    t.damage = t.pending_damage;
                    t.range_subtiles = t.pending_range_subtiles;
                    t.pending_level = 0;
                    t.pending_damage = 0;
                    t.pending_range_subtiles = 0;
                }
                tu += 1;
            }

            // Precompute each walking unit's sub-tile position ONCE for this
            // tick. Shots are resolved before movement, so every tower sees the
            // same positions; computing them here avoids re-walking the path in
            // the inner tower x unit loop (the CU hot spot). Behaviour is
            // identical to computing per-tower.
            let mut positions = [(0i64, 0i64); MAX_UNITS];
            let mut pi = 0usize;
            while pi < MAX_UNITS {
                if self.units[pi].state == UNIT_STATE_WALKING {
                    positions[pi] = self.position_at(self.units[pi].progress_subtiles);
                }
                pi += 1;
            }

            // Resolve tower shots for this tick BEFORE movement so ready timing
            // is measured against the tick being entered.
            self.apply_tick_shots(tick, &positions);

            let mut i = 0usize;
            while i < MAX_UNITS {
                let state = self.units[i].state;
                if state == UNIT_STATE_QUEUED {
                    if self.units[i].spawn_tick <= tick {
                        self.units[i].state = UNIT_STATE_WALKING;
                    }
                } else if state == UNIT_STATE_WALKING {
                    let speed = self.units[i].speed_subtiles as u64;
                    let new_progress = self.units[i].progress_subtiles.saturating_add(speed);
                    if new_progress >= path_len_sub {
                        self.units[i].progress_subtiles = path_len_sub;
                        self.units[i].state = UNIT_STATE_REACHED_END;
                        self.lives = self.lives.saturating_sub(1);
                    } else {
                        self.units[i].progress_subtiles = new_progress;
                    }
                }
                i += 1;
            }

            self.current_tick = tick;
            applied += 1;
        }
    }

    /// Apply `dmg` to the unit at `idx`, marking it dead and awarding its
    /// reward + a kill if its hp reaches 0. Only touches walking units that are
    /// still alive; a no-op otherwise. Deterministic.
    fn damage_unit(&mut self, idx: usize, dmg: u32) {
        let unit = &mut self.units[idx];
        if unit.state != UNIT_STATE_WALKING {
            return;
        }
        unit.hp = unit.hp.saturating_sub(dmg);
        if unit.hp == 0 {
            unit.state = UNIT_STATE_DEAD;
            let reward = unit.reward;
            self.gold = self.gold.saturating_add(reward);
            self.kills = self.kills.saturating_add(1);
        }
    }

    /// Resolve tower shots for a single tick. Deterministic: towers iterate in
    /// fixed index order and target the walking unit that is FURTHEST along the
    /// path (largest `progress_subtiles`) within range, breaking ties by lowest
    /// unit index. Uses squared Euclidean distance in sub-tiles (no floats, no
    /// sqrt). A unit killed this tick awards its reward as gold and a kill.
    pub fn apply_tick_shots(&mut self, tick: u64, positions: &[(i64, i64); MAX_UNITS]) {
        let tower_count = self.tower_count as usize;
        let mut ti = 0usize;
        while ti < tower_count {
            let tower = self.towers[ti];
            if tower.kind == TOWER_KIND_NONE {
                ti += 1;
                continue;
            }
            // Not yet built. This gate applies only to the INITIAL build
            // (pending_level == 0). While an upgrade is pending the tower is
            // already built and keeps firing at its current stats until the
            // upgrade commits, so we must not silence it here.
            if tower.pending_level == 0 && tick < tower.ready_at_tick {
                ti += 1;
                continue;
            }
            // Still on cooldown. last_shot_tick == 0 means "never fired".
            if tower.last_shot_tick != 0
                && tick.saturating_sub(tower.last_shot_tick) < tower.cooldown_ticks as u64
            {
                ti += 1;
                continue;
            }

            let tx = tower.x as i64 * SUBTILES_PER_TILE as i64;
            let ty = tower.y as i64 * SUBTILES_PER_TILE as i64;
            let range = tower.range_subtiles as i64;
            let range_sq = range.saturating_mul(range);

            // Select target: furthest-along walking unit within range.
            let mut best: Option<usize> = None;
            let mut best_progress: u64 = 0;
            let mut ui = 0usize;
            while ui < MAX_UNITS {
                if self.units[ui].state == UNIT_STATE_WALKING {
                    let (ux, uy) = positions[ui];
                    let dx = ux - tx;
                    let dy = uy - ty;
                    let dist_sq = dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy));
                    if dist_sq <= range_sq {
                        let prog = self.units[ui].progress_subtiles;
                        if best.is_none() || prog > best_progress {
                            best = Some(ui);
                            best_progress = prog;
                        }
                    }
                }
                ui += 1;
            }

            if let Some(target) = best {
                let dmg = tower.damage;

                // Apply `dmg` to a single unit, handling kill bookkeeping.
                // Inlined as a closure-free helper via a small loop below so we
                // can reuse it for the primary hit and every splash victim while
                // keeping deterministic iteration order.
                self.damage_unit(target, dmg);

                // Splash: also damage every OTHER walking unit within
                // splash_radius of the PRIMARY TARGET's position. Deterministic:
                // fixed unit-index order, integer squared-distance, same `dmg`.
                // splash_radius == 0 (basic tower) skips this entirely so its
                // behaviour is byte-for-byte unchanged.
                let splash = tower.splash_radius_subtiles as i64;
                if splash > 0 {
                    let (cx, cy) = positions[target];
                    let splash_sq = splash.saturating_mul(splash);
                    let mut si = 0usize;
                    while si < MAX_UNITS {
                        if si != target && self.units[si].state == UNIT_STATE_WALKING {
                            let (ux, uy) = positions[si];
                            let dx = ux - cx;
                            let dy = uy - cy;
                            let dist_sq =
                                dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy));
                            if dist_sq <= splash_sq {
                                self.damage_unit(si, dmg);
                            }
                        }
                        si += 1;
                    }
                }

                self.towers[ti].last_shot_tick = tick;
            }

            ti += 1;
        }
    }
}
