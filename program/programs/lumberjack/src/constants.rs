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

// Fixed-point movement. A unit's position along the path is measured in
// sub-tiles. One full tile = SUBTILES_PER_TILE sub-tiles. Integer only.
pub const SUBTILES_PER_TILE: u32 = 256;

// Build / spawn timing, expressed in ticks. 3s @ 10 ticks/s = 30 ticks.
pub const TOWER_BUILD_TICKS: u64 = 30;
pub const TOWER_UPGRADE_BUILD_TICKS: u64 = 30; // upgrade build delay (same as build)
pub const UNIT_SPAWN_DELAY_TICKS: u64 = 30;

// Basic tower base stats (level 1). Range is in sub-tiles (2 tiles here).
// Hard mode: towers are pricier and hit a bit softer, so raw firepower alone
// won't carry you - placement and upgrade timing matter.
pub const TOWER_BASIC_COST: u32 = 60;
pub const TOWER_BASIC_RANGE_SUBTILES: u32 = 3 * SUBTILES_PER_TILE; // 3-tile radius
pub const TOWER_BASIC_DAMAGE: u32 = 8;
pub const TOWER_BASIC_COOLDOWN_TICKS: u32 = 6;

// Upgrade scaling per level and its cost.
pub const TOWER_UPGRADE_COST: u32 = 50;
pub const TOWER_MAX_LEVEL: u8 = 3;
pub const TOWER_UPGRADE_DAMAGE_BONUS: u32 = 7; // added damage per level above 1
pub const TOWER_UPGRADE_RANGE_BONUS: u32 = SUBTILES_PER_TILE; // +1 tile / level

// Enemy unit base stats. Hard mode: faster (less time in range) and tankier.
pub const UNIT_BASE_HP: u32 = 36;
pub const UNIT_BASE_SPEED_SUBTILES: u32 = 22; // sub-tiles per tick (~12 ticks/tile)
pub const UNIT_BASE_REWARD: u32 = 7;
// Ticks between consecutive units in the same wave (so they file in one by one).
pub const UNIT_SPAWN_STAGGER_TICKS: u64 = 10;

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
