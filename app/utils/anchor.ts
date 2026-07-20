import { Program, IdlAccounts, BN } from "@anchor-lang/core"
import { Lumberjack, IDL } from "../idl/lumberjack"
import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js"
import { WrappedConnection } from "./wrappedConnection";
import { TOWER_DEFS, TOWER_KIND_BASIC, towerDef } from "./tdDefs"

// Re-export the generated balance table so callers have a single import site.
export {
  TOWER_DEFS,
  TOWER_KIND_NONE,
  TOWER_KIND_BASIC,
  TOWER_KIND_SPLASH,
  TOWER_KIND_SLOW,
  towerDef,
} from "./tdDefs"
export type { TowerDef } from "./tdDefs"

export const CONNECTION = new WrappedConnection(process.env.NEXT_PUBLIC_RPC ? process.env.NEXT_PUBLIC_RPC : 'https://rpc.magicblock.app/devnet',  {
  wsEndpoint: process.env.NEXT_PUBLIC_WSS_RPC ? process.env.NEXT_PUBLIC_WSS_RPC : "wss://rpc.magicblock.app/devnet",
  commitment: 'confirmed' 
});

// Metaplex Read API (DAS) endpoint. Provide your own via NEXT_PUBLIC_READAPI_RPC
// (e.g. a Helius devnet URL with your api-key). Never hardcode a key here.
export const METAPLEX_READAPI =
  process.env.NEXT_PUBLIC_READAPI_RPC ?? "https://api.devnet.solana.com";

// Here you can basically use what ever seed you want. For example one per level or city or whatever.
export const GAME_DATA_SEED = "level_2";

// Create the read-only program interface. In Anchor 1.x the program ID is read
// from the IDL's `address` field, so a Connection is sufficient (no wallet).
export const program = new Program<Lumberjack>(IDL, {
  connection: CONNECTION,
})

export const [gameDataPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from(GAME_DATA_SEED, "utf8")],
  program.programId
)

// Player Data Account Type from Idl
export type PlayerData = IdlAccounts<Lumberjack>["playerData"]
export type GameData = IdlAccounts<Lumberjack>["gameData"]

// Constants for the game
export const TIME_TO_REFILL_ENERGY: BN = new BN(60)
export const MAX_ENERGY = 100
export const ENERGY_PER_TICK: BN = new BN(1)
export const TOTAL_WOOD_AVAILABLE: BN = new BN(100000)

// ---------------------------------------------------------------------------
// Tower Defense
// ---------------------------------------------------------------------------

// The on-chain Board account (zero-copy). Decoded shape from the IDL.
export type Board = IdlAccounts<Lumberjack>["board"]

// Gum session-keys program (must match the on-chain declare_id!).
export const SESSION_PROGRAM_ID = new PublicKey(
  "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5"
)

// Tuning mirrored from the program's constants.rs (kept in sync for the client
// prediction loop and UI math).
export const GRID_SIZE = 8
export const SUBTILES_PER_TILE = 256
export const MS_PER_TICK = 100 // 10 ticks / second
export const MAX_TICKS_PER_SLICE = 256
export const MAX_TOWERS = 16
export const TOWER_BUILD_TICKS = 30 // ticks from placement until a tower arms
export const TOWER_UPGRADE_BUILD_TICKS = 30 // ticks for an upgrade to take effect

// Per-kind stats now live in the generated TOWER_DEFS table. These scalar
// aliases resolve to the BASIC tower (kind 1) only.
//
// WARNING: upgrade cost/damage/range differ PER TOWER KIND (basic vs splash vs
// slow). Do NOT use the *_UPGRADE_* aliases below for an arbitrary tower - read
// `towerDef(tower.kind)` instead, or the client will diverge from what the
// program charges/applies (this exact bug: splash upgrade is 70g, not 50g).
// max_level currently matches across kinds, so TOWER_MAX_LEVEL is safe.
const BASIC = TOWER_DEFS[TOWER_KIND_BASIC - 1]
export const TOWER_BASIC_COST = BASIC.cost
/** @deprecated per-kind - use towerDef(kind).upgradeCost */
export const TOWER_UPGRADE_COST = BASIC.upgradeCost
export const TOWER_MAX_LEVEL = BASIC.maxLevel
/** @deprecated per-kind - use towerDef(kind).upgradeDamageBonus */
export const TOWER_UPGRADE_DAMAGE_BONUS = BASIC.upgradeDamageBonus
/** @deprecated per-kind - use towerDef(kind).upgradeRangeBonus */
export const TOWER_UPGRADE_RANGE_BONUS = BASIC.upgradeRangeBonus

// Board PDA: ["board", authority].
export function boardPda(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("board", "utf8"), authority.toBuffer()],
    program.programId
  )[0]
}

// Gum session-token PDA: ["session_token", target_program, session_signer, authority].
export function sessionTokenPda(
  sessionSigner: PublicKey,
  authority: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("session_token", "utf8"),
      program.programId.toBuffer(),
      sessionSigner.toBuffer(),
      authority.toBuffer(),
    ],
    SESSION_PROGRAM_ID
  )[0]
}
