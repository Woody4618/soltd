#!/usr/bin/env node
/*
 * Codegen: emit app/utils/tdDefs.ts from the Rust balance tables.
 *
 * The Anchor program is the single source of truth for tower balance. Anchor's
 * IDL only carries scalar `#[constant]`s (array-of-struct constants aren't
 * reliably consumable client-side yet), so instead of hand-mirroring the
 * numbers we parse them straight out of the Rust and generate a typed TS table.
 * Run `pnpm gen:defs` (from program/) whenever the Rust tables change.
 *
 * Kept dependency-free (plain Node + regex) on purpose: the parsed surface is a
 * small, well-shaped table we control, and re-running it is verified by the
 * client compile + on-chain parity, so a full Rust parser would be overkill.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONSTANTS = path.join(ROOT, "programs/lumberjack/src/constants.rs");
const TD_BOARD = path.join(ROOT, "programs/lumberjack/src/state/td_board.rs");
const OUT = path.resolve(ROOT, "..", "app/utils/tdDefs.ts");

const constantsSrc = fs.readFileSync(CONSTANTS, "utf8");
const boardSrc = fs.readFileSync(TD_BOARD, "utf8");

// --- scalar consts we may need to resolve expressions like `3 * SUBTILES_PER_TILE`
function readScalar(name) {
  const m = constantsSrc.match(
    new RegExp(`pub const ${name}\\s*:\\s*[\\w<>]+\\s*=\\s*([^;]+);`)
  );
  if (!m) throw new Error(`could not find const ${name} in constants.rs`);
  return m[1];
}

const SCALARS = {
  SUBTILES_PER_TILE: Number(readScalar("SUBTILES_PER_TILE").trim()),
};

// Evaluate a trivial integer expression: a literal, a known scalar name, or
// `A * B` / `A + B` of those. Rejects anything else so we fail loudly rather
// than silently mis-generating balance.
function evalExpr(raw) {
  const expr = raw.replace(/\/\/.*$/, "").trim();
  const resolveTerm = (t) => {
    t = t.trim();
    if (/^\d+$/.test(t)) return Number(t);
    if (t in SCALARS) return SCALARS[t];
    throw new Error(`unsupported term in balance expr: "${t}"`);
  };
  if (expr.includes("*"))
    return expr.split("*").map(resolveTerm).reduce((a, b) => a * b, 1);
  if (expr.includes("+"))
    return expr.split("+").map(resolveTerm).reduce((a, b) => a + b, 0);
  return resolveTerm(expr);
}

// --- TOWER_KIND_* ids (from td_board.rs)
const kinds = {};
for (const m of boardSrc.matchAll(
  /pub const (TOWER_KIND_\w+)\s*:\s*u8\s*=\s*(\d+);/g
)) {
  kinds[m[1]] = Number(m[2]);
}
if (kinds.TOWER_KIND_NONE === undefined)
  throw new Error("TOWER_KIND_NONE not found");

// --- ENEMY_KIND_* ids (from td_board.rs)
const enemyKinds = {};
for (const m of boardSrc.matchAll(
  /pub const (ENEMY_KIND_\w+)\s*:\s*u8\s*=\s*(\d+);/g
)) {
  enemyKinds[m[1]] = Number(m[2]);
}
if (enemyKinds.ENEMY_KIND_NORMAL === undefined)
  throw new Error("ENEMY_KIND_NORMAL not found");

// --- BOSS_WAVE_INTERVAL (from constants.rs)
const bossWaveInterval = evalExpr(readScalar("BOSS_WAVE_INTERVAL"));

// --- TOWER_DEFS rows (from constants.rs). Field order is fixed by the struct.
const DEF_FIELDS = [
  "cost",
  "rangeSubtiles",
  "damage",
  "cooldownTicks",
  "splashRadiusSubtiles",
  "upgradeCost",
  "upgradeDamageBonus",
  "upgradeRangeBonus",
  "maxLevel",
];
const RUST_FIELDS = [
  "cost",
  "range_subtiles",
  "damage",
  "cooldown_ticks",
  "splash_radius_subtiles",
  "upgrade_cost",
  "upgrade_damage_bonus",
  "upgrade_range_bonus",
  "max_level",
];

const tableMatch = constantsSrc.match(
  /pub const TOWER_DEFS\s*:\s*\[TowerDef;[^\]]*\]\s*=\s*\[([\s\S]*?)\n\];/
);
if (!tableMatch) throw new Error("could not find TOWER_DEFS table");

const rows = [];
for (const rowMatch of tableMatch[1].matchAll(/TowerDef\s*\{([\s\S]*?)\}/g)) {
  const body = rowMatch[1];
  const row = {};
  RUST_FIELDS.forEach((rf, i) => {
    const fm = body.match(new RegExp(`${rf}\\s*:\\s*([^,]+),`));
    if (!fm) throw new Error(`TOWER_DEFS row missing field ${rf}`);
    row[DEF_FIELDS[i]] = evalExpr(fm[1]);
  });
  rows.push(row);
}
if (rows.length === 0) throw new Error("no TOWER_DEFS rows parsed");

// --- ENEMY_DEFS rows (from constants.rs). Field order fixed by the struct.
const ENEMY_DEF_FIELDS = ["hp", "speedSubtiles", "reward", "radiusPx"];
const ENEMY_RUST_FIELDS = ["hp", "speed_subtiles", "reward", "radius_px"];

const enemyTableMatch = constantsSrc.match(
  /pub const ENEMY_DEFS\s*:\s*\[EnemyDef;[^\]]*\]\s*=\s*\[([\s\S]*?)\n\];/
);
if (!enemyTableMatch) throw new Error("could not find ENEMY_DEFS table");

const enemyRows = [];
for (const rowMatch of enemyTableMatch[1].matchAll(/EnemyDef\s*\{([\s\S]*?)\}/g)) {
  const body = rowMatch[1];
  const row = {};
  ENEMY_RUST_FIELDS.forEach((rf, i) => {
    const fm = body.match(new RegExp(`${rf}\\s*:\\s*([^,]+),`));
    if (!fm) throw new Error(`ENEMY_DEFS row missing field ${rf}`);
    row[ENEMY_DEF_FIELDS[i]] = evalExpr(fm[1]);
  });
  enemyRows.push(row);
}
if (enemyRows.length === 0) throw new Error("no ENEMY_DEFS rows parsed");

// --- emit
const kindLines = Object.entries(kinds)
  .sort((a, b) => a[1] - b[1])
  .map(([name, val]) => `export const ${name} = ${val}`)
  .join("\n");

const rowLines = rows
  .map(
    (r) =>
      "  {\n" +
      DEF_FIELDS.map((f) => `    ${f}: ${r[f]},`).join("\n") +
      "\n  },"
  )
  .join("\n");

const enemyKindLines = Object.entries(enemyKinds)
  .sort((a, b) => a[1] - b[1])
  .map(([name, val]) => `export const ${name} = ${val}`)
  .join("\n");

const enemyRowLines = enemyRows
  .map(
    (r) =>
      "  {\n" +
      ENEMY_DEF_FIELDS.map((f) => `    ${f}: ${r[f]},`).join("\n") +
      "\n  },"
  )
  .join("\n");

const out = `// AUTO-GENERATED by program/scripts/gen-defs.js - DO NOT EDIT BY HAND.
// Source of truth: program/programs/lumberjack/src/constants.rs (TOWER_DEFS,
// ENEMY_DEFS, BOSS_WAVE_INTERVAL) and .../state/td_board.rs (TOWER_KIND_*,
// ENEMY_KIND_*). Re-run \`pnpm gen:defs\` in program/ after changing the Rust
// balance tables.

export interface TowerDef {
  cost: number
  rangeSubtiles: number
  damage: number
  cooldownTicks: number
  splashRadiusSubtiles: number
  upgradeCost: number
  upgradeDamageBonus: number
  upgradeRangeBonus: number
  maxLevel: number
}

// Tower kind ids (kind 0 = NONE / empty slot).
${kindLines}

// Balance rows indexed by (kind - 1), mirroring the Rust TOWER_DEFS order.
export const TOWER_DEFS: readonly TowerDef[] = [
${rowLines}
]

// Look up a tower kind's balance row. Returns undefined for NONE / unknown kinds.
export function towerDef(kind: number): TowerDef | undefined {
  return TOWER_DEFS[kind - 1]
}

// --- Enemies -------------------------------------------------------------

export interface EnemyDef {
  hp: number
  speedSubtiles: number
  reward: number
  radiusPx: number
}

// Enemy kind ids (row index into ENEMY_DEFS; NORMAL == 0).
${enemyKindLines}

// A boss is added on every Nth wave (0-indexed): waves 4, 9, 14, ...
export const BOSS_WAVE_INTERVAL = ${bossWaveInterval}

// Base (wave-0) stats per enemy kind, indexed by kind id. Per-wave growth is
// applied on top by the sim (see tdSim.ts).
export const ENEMY_DEFS: readonly EnemyDef[] = [
${enemyRowLines}
]

// Look up an enemy kind's balance row. Unknown ids fall back to NORMAL (0).
export function enemyDef(kind: number): EnemyDef {
  return ENEMY_DEFS[kind] ?? ENEMY_DEFS[0]
}
`;

fs.writeFileSync(OUT, out);
console.log(
  `wrote ${path.relative(process.cwd(), OUT)} (${rows.length} tower def(s), ${
    enemyRows.length
  } enemy def(s), ${Object.keys(kinds).length + Object.keys(enemyKinds).length} kind id(s))`
);
