pub const TIME_TO_REFILL_ENERGY: i64 = 60;
pub const MAX_ENERGY: u64 = 100;
pub const MAX_WOOD_PER_TREE: u64 = 100000;

// ---------------------------------------------------------------------------
// Tower Defense
// ---------------------------------------------------------------------------
// Board / capacity limits. Kept small for v1 so the whole board fits well under
// the 10 KiB single-transaction init limit (leaves room to grow toward 10 MiB
// later via resize if needed).
pub const GRID_SIZE: u8 = 8; // 8x8 grid
pub const MAX_TOWERS: usize = 16;
pub const MAX_UNITS: usize = 16;
pub const MAX_PATH_LEN: usize = 64;

// Starting resources. Shared by init_board and reset_board so they can't drift.
// Hard mode: a lean start - roughly one tower and a small buffer.
// (Temporarily raised for easier testing.)
pub const STARTING_LIVES: u32 = 8;
pub const STARTING_GOLD: u32 = 200;

// Deterministic clock. The board advances by discrete ticks. Wall-clock time is
// only ever used to bound how many ticks a single `advance_game` slice may
// apply, never as the game clock itself.
pub const MS_PER_TICK: i64 = 100; // 10 ticks / second
pub const MAX_TICKS_PER_SLICE: u64 = 256; // hard cap per advance_game call

// Compute-budget guard for the tick loop (STATIC density cap - see
// Board::max_safe_ticks). We can't use the runtime sol_remaining_compute_units
// syscall (SIMD-0049 was withdrawn / never activated, so a program referencing
// it fails to deploy). Instead we cap ticks-per-call at SAFE_TICK_BUDGET /
// tower_count, since the dominant per-tick cost is O(tower_count * MAX_UNITS).
// Empirically ~11 towers x 256 ticks (~2800 tick-tower units) exceeded 1.4M CU,
// so we keep the product well below that: 1500 tick-tower units => e.g. 16
// towers -> 93 ticks, 8 towers -> 187 ticks, 1 tower -> capped at
// MAX_TICKS_PER_SLICE. Any shortfall is drained by the client calling
// advance_game again.
pub const SAFE_TICK_BUDGET: u64 = 1500;

// Fixed-point movement. A unit's position along the path is measured in
// sub-tiles. One full tile = SUBTILES_PER_TILE sub-tiles. Integer only.
pub const SUBTILES_PER_TILE: u32 = 256;

// Build / spawn timing, expressed in ticks. 3s @ 10 ticks/s = 30 ticks.
pub const TOWER_BUILD_TICKS: u64 = 30;
pub const TOWER_UPGRADE_BUILD_TICKS: u64 = 30; // upgrade build delay (same as build)
pub const UNIT_SPAWN_DELAY_TICKS: u64 = 30;

// ---------------------------------------------------------------------------
// Tower definitions (data-driven balance table)
// ---------------------------------------------------------------------------
// Each tower KIND has one row in TOWER_DEFS, indexed by its `TOWER_KIND_*` id
// (minus 1, since kind 0 = NONE). All tower placement/upgrade logic reads its
// numbers from this table instead of hardcoding a single "basic" tower, so
// adding a new tower type = add a `TOWER_KIND_*` id + one row here (and a row in
// the generated TS mirror via `pnpm gen:defs`). Balance is intentionally kept
// as plain compile-time data; the program is the single source of truth and the
// TS client is generated from it, so the two can never drift.
//
// IMPORTANT: a placed tower stores its RESOLVED stats on the Tower struct, so
// changing this table + redeploying only affects NEWLY placed towers - in-flight
// games keep the stats they were built with and never desync.
#[derive(Clone, Copy)]
pub struct TowerDef {
    pub cost: u32,
    pub range_subtiles: u32,
    pub damage: u32,
    pub cooldown_ticks: u32,
    // AoE splash radius in sub-tiles around the primary target. 0 = single
    // target. Fixed per kind (upgrades do not grow it).
    pub splash_radius_subtiles: u32,
    pub upgrade_cost: u32,
    pub upgrade_damage_bonus: u32,
    pub upgrade_range_bonus: u32,
    pub max_level: u8,
}

// Number of real tower kinds (excludes TOWER_KIND_NONE). Adding a tower means
// bumping this and appending to TOWER_DEFS.
pub const TOWER_KIND_COUNT: usize = 3;

// Slow tower tuning. When a slow tower fires, every walking enemy within its
// splash radius has its effective speed reduced by SLOW_PERCENT for
// SLOW_DURATION_TICKS ticks. The debuff does NOT stack - each fresh hit just
// refreshes the "slowed until" tick (the later of the current one and now +
// duration). All integer math, so the TS client reproduces it bit-for-bit.
pub const SLOW_PERCENT: u32 = 40; // 40% slower while debuffed
pub const SLOW_DURATION_TICKS: u64 = 20; // ~2s at 10 ticks/s

// Balance table. Row order MUST match the `TOWER_KIND_*` ids (row = kind - 1).
// Hard mode: towers are pricier and hit a bit softer, so raw firepower alone
// won't carry you - placement and upgrade timing matter.
pub const TOWER_DEFS: [TowerDef; TOWER_KIND_COUNT] = [
    // kind 1: BASIC. Single-target, long range, cheap, fast. Range in sub-tiles.
    TowerDef {
        cost: 60,
        range_subtiles: 3 * SUBTILES_PER_TILE,
        damage: 8,
        cooldown_ticks: 6,
        splash_radius_subtiles: 0, // single target
        upgrade_cost: 50,
        upgrade_damage_bonus: 7,           // added damage per level above 1
        upgrade_range_bonus: SUBTILES_PER_TILE, // +1 tile / level
        max_level: 3,
    },
    // kind 2: SPLASH. Hits every enemy within splash_radius of its target - great
    // against clustered waves - but pricier, shorter range and slower firing, so
    // it trades single-target DPS for area coverage.
    TowerDef {
        cost: 100,
        range_subtiles: 2 * SUBTILES_PER_TILE, // shorter targeting range
        damage: 6,                             // per-hit; applies to all in splash
        cooldown_ticks: 9,                     // slower cadence
        splash_radius_subtiles: SUBTILES_PER_TILE, // 1-tile blast radius
        upgrade_cost: 70,
        upgrade_damage_bonus: 5,           // added damage per level above 1
        upgrade_range_bonus: SUBTILES_PER_TILE, // +1 tile targeting / level
        max_level: 3,
    },
    // kind 3: SLOW. Support tower. Chills every enemy within its blast radius,
    // cutting their speed by SLOW_PERCENT for SLOW_DURATION_TICKS (refreshed on
    // each hit, no stacking). Deals only light damage - its value is keeping the
    // lane crawling so your damage/splash towers get far more shots in. Best at a
    // chokepoint where the path bunches up; pairs strongly with the splash tower.
    TowerDef {
        cost: 90,
        range_subtiles: 2 * SUBTILES_PER_TILE,
        damage: 2,                             // light chip damage (applied AoE)
        cooldown_ticks: 8,
        splash_radius_subtiles: SUBTILES_PER_TILE, // 1-tile slow field
        upgrade_cost: 60,
        upgrade_damage_bonus: 1,           // barely scales damage; it's a slower
        upgrade_range_bonus: SUBTILES_PER_TILE, // +1 tile targeting / level
        max_level: 3,
    },
];

/// Look up a tower's balance row by its `TOWER_KIND_*` id. Returns None for
/// TOWER_KIND_NONE or any unknown kind.
pub const fn tower_def(kind: u8) -> Option<&'static TowerDef> {
    let idx = (kind as usize).wrapping_sub(1);
    if kind == 0 || idx >= TOWER_KIND_COUNT {
        None
    } else {
        Some(&TOWER_DEFS[idx])
    }
}

// Ticks between consecutive units in the same wave (so they file in one by one).
pub const UNIT_SPAWN_STAGGER_TICKS: u64 = 10;

// ---------------------------------------------------------------------------
// Enemy definitions (data-driven balance table)
// ---------------------------------------------------------------------------
// Like TOWER_DEFS, each enemy KIND has one row here indexed by its
// `ENEMY_KIND_*` id (defined in state/td_board.rs). These are the wave-0 base
// stats for that type; the per-wave compounding growth below (WAVE_*_GROWTH)
// is applied ON TOP so late waves stay hard. Adding a new enemy = add a
// `ENEMY_KIND_*` id + one row here (+ re-run `pnpm gen:defs` for the TS mirror).
//
// `radius_px` is a RENDER-ONLY hint (unit marker radius in the client canvas);
// it is not used by any on-chain logic but lives here so the type is a single
// source of truth and the client can't drift from the roster.
#[derive(Clone, Copy)]
pub struct EnemyDef {
    pub hp: u32,
    pub speed_subtiles: u32, // sub-tiles per tick (before per-wave growth)
    pub reward: u32,
    pub radius_px: u32, // render-only marker radius
}

// Number of enemy kinds. Row order MUST match the `ENEMY_KIND_*` ids (row = id).
pub const ENEMY_KIND_COUNT: usize = 4;

pub const ENEMY_DEFS: [EnemyDef; ENEMY_KIND_COUNT] = [
    // id 0: NORMAL. Balanced baseline (the old single unit type).
    EnemyDef {
        hp: 36,
        speed_subtiles: 22, // ~12 ticks/tile
        reward: 7,
        radius_px: 10,
    },
    // id 1: FAST. Low HP, high speed - little time in a tower's range, so it
    // punishes thin coverage. Pays slightly less.
    EnemyDef {
        hp: 22,
        speed_subtiles: 40,
        reward: 6,
        radius_px: 8,
    },
    // id 2: STRONG. Tanky and slow - soaks damage and clogs the lane. Pays more
    // to reward the extra firepower needed to drop it.
    EnemyDef {
        hp: 90,
        speed_subtiles: 14,
        reward: 14,
        radius_px: 12,
    },
    // id 3: BOSS. Very tanky, slow, and pays a big bounty. Spawns rarely (every
    // BOSS_WAVE_INTERVAL waves) and takes a wave slot from the normals.
    EnemyDef {
        hp: 400,
        speed_subtiles: 12,
        reward: 80,
        radius_px: 16,
    },
];

/// Look up an enemy's balance row by its `ENEMY_KIND_*` id. Unknown ids fall
/// back to NORMAL (index 0) so a bad value can never panic on-chain.
pub const fn enemy_def(kind: u8) -> &'static EnemyDef {
    let idx = kind as usize;
    if idx >= ENEMY_KIND_COUNT {
        &ENEMY_DEFS[0]
    } else {
        &ENEMY_DEFS[idx]
    }
}

// A boss enemy is added on every Nth wave (0-indexed): waves 4, 9, 14, ...
// (i.e. the 5th, 10th, ...). On a boss wave the boss takes one unit slot and
// the normal fill count is reduced by one (the "replace" model).
pub const BOSS_WAVE_INTERVAL: u32 = 5;

// Speed cap is applied to the FINAL (post-growth) speed; keep it near a tile so
// even fast enemies at high waves stay well-behaved for movement/targeting.
// (UNIT_MAX_SPEED_SUBTILES defined below.)

// ---------------------------------------------------------------------------
// Automatic waves
// ---------------------------------------------------------------------------
// Waves spawn automatically inside the deterministic tick loop as the game is
// advanced. Everything below is a plain tunable constant - tweak freely.
//
// Timing (in ticks; recall 10 ticks = 1 second):
pub const WAVE_FIRST_DELAY_TICKS: u64 = 40; // grace period before wave 1 (~4s)
pub const WAVE_INTERVAL_TICKS: u64 = 120; // max cooldown between waves (~12s)

// Early-wave trigger: if the board is fully cleared (no queued/walking units)
// before the cooldown elapses, the next wave starts after only this short
// breather instead of waiting out WAVE_INTERVAL_TICKS. This keeps a skilled
// player who clears fast from standing around idle. Deterministic: the "board
// is clear" test is a pure function of unit state, so the client predicts it
// identically.
pub const WAVE_CLEAR_BREATHER_TICKS: u64 = 20; // ~2s pause after a clean sweep

// Count scaling: units in wave N (0-indexed) = BASE + N * GROWTH, capped so a
// single wave never tries to exceed the unit-slot capacity.
pub const WAVE_BASE_COUNT: u32 = 4;
pub const WAVE_COUNT_GROWTH: u32 = 1; // +1 unit per wave

// Difficulty scaling per wave. These are COMPOUNDING percentages: each wave
// multiplies the previous wave's stat by (100 + growth)/100, applied
// iteratively with integer math so it never plateaus and stays bit-identical
// between the program and the TS client. Crucially HP compounds FASTER than the
// reward, so your income can't keep pace with enemy toughness forever - that
// gap is what eventually ends every run (hard mode).
pub const WAVE_HP_GROWTH_PERCENT: u32 = 18; // x1.18 HP per wave (compounding)
pub const WAVE_SPEED_GROWTH_PERCENT: u32 = 3; // x1.03 speed per wave (capped)
pub const WAVE_REWARD_GROWTH_PERCENT: u32 = 10; // x1.10 reward per wave (compounding)

// Safety cap so speed can never exceed one tile per tick (keeps movement /
// targeting well-behaved).
pub const UNIT_MAX_SPEED_SUBTILES: u32 = SUBTILES_PER_TILE;
