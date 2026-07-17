import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Lumberjack } from "../target/types/lumberjack";
import { assert } from "chai";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import {
  applyTicks,
  fromChain,
  SimBoard,
  waveEnemyKind,
  isBossWave,
  ENEMY_KIND_BOSS,
  ENEMY_KIND_NORMAL,
  UNIT_STATE_QUEUED,
  UNIT_STATE_WALKING,
} from "./td_sim";

const SESSION_PROGRAM_ID = new anchor.web3.PublicKey(
  "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5"
);

// Expected balance, mirrored from program/programs/lumberjack/src/constants.rs
// (STARTING_*, TOWER_DEFS row 0 = basic, UNIT_BASE_*) and .../state/td_board.rs
// (TOWER_BUILD_TICKS etc). Keep in sync with the Rust source of truth so these
// assertions verify the on-chain numbers rather than baking in stale copies.
const STARTING_LIVES = 8;
const STARTING_GOLD = 200;
const TOWER_BUILD_TICKS = 30;
// Basic tower (TOWER_DEFS[0]).
const BASIC_COST = 60;
const BASIC_DAMAGE = 8;
const BASIC_RANGE_SUBTILES = 3 * 256;
const BASIC_COOLDOWN_TICKS = 6;
const BASIC_UPGRADE_COST = 50;
const BASIC_UPGRADE_DAMAGE_BONUS = 7;
const BASIC_UPGRADE_RANGE_BONUS = 256;
// Enemy base stats (UNIT_BASE_*).
const UNIT_BASE_HP = 36;
const UNIT_BASE_SPEED_SUBTILES = 22;
const UNIT_BASE_REWARD = 7;
const UNIT_SPAWN_DELAY_TICKS = 30;
const UNIT_SPAWN_STAGGER_TICKS = 10;

// The Gum session-token PDA: ["session_token", target_program, session_signer, authority].
function sessionTokenPDA(
  targetProgram: anchor.web3.PublicKey,
  sessionSigner: anchor.web3.PublicKey,
  authority: anchor.web3.PublicKey
): anchor.web3.PublicKey {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("session_token"),
      targetProgram.toBuffer(),
      sessionSigner.toBuffer(),
      authority.toBuffer(),
    ],
    SESSION_PROGRAM_ID
  )[0];
}

describe("towerdefense", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Lumberjack as Program<Lumberjack>;
  const payer = provider.wallet as anchor.Wallet;

  const boardPDA = () =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("board"), payer.publicKey.toBuffer()],
      program.programId
    )[0];

  before(async () => {
    const balance = await provider.connection.getBalance(payer.publicKey);
    if (balance < 1e8) {
      const res = await provider.connection.requestAirdrop(payer.publicKey, 1e9);
      await provider.connection.confirmTransaction(res, "confirmed");
    }
  });

  it("Initializes a board", async () => {
    const board = boardPDA();

    const sig = await program.methods
      .initBoard()
      .accountsPartial({
        board,
        signer: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: true });
    await provider.connection.confirmTransaction(sig, "confirmed");
    console.log("initBoard tx", sig);

    const state = await program.account.board.fetch(board);

    assert.strictEqual(state.authority.toBase58(), payer.publicKey.toBase58());
    assert.strictEqual(Number(state.currentTick), 0);
    assert.strictEqual(state.gridSize, 8);
    assert.strictEqual(state.towerCount, 0);
    assert.strictEqual(state.lives, STARTING_LIVES);
    assert.strictEqual(state.gold, STARTING_GOLD);
    assert.strictEqual(state.kills, 0);

    // Path: (0,0) -> (0,4) -> (7,4) -> (7,7)
    assert.strictEqual(state.pathLen, 4);
    assert.strictEqual(state.path[0].x, 0);
    assert.strictEqual(state.path[0].y, 0);
    assert.strictEqual(state.path[1].x, 0);
    assert.strictEqual(state.path[1].y, 4);
    assert.strictEqual(state.path[2].x, 7);
    assert.strictEqual(state.path[2].y, 4);
    assert.strictEqual(state.path[3].x, 7);
    assert.strictEqual(state.path[3].y, 7);

    console.log("Board initialized:", board.toBase58());
  });

  it("Places a tower with a build delay", async () => {
    const board = boardPDA();

    // Tile (2,2) is off the L-shaped path.
    const sig = await program.methods
      .placeTower(2, 2, 1)
      .accountsPartial({
        board,
        signer: payer.publicKey,
        authority: payer.publicKey,
        sessionToken: null,
      })
      .rpc({ skipPreflight: true });
    await provider.connection.confirmTransaction(sig, "confirmed");

    const state = await program.account.board.fetch(board);
    assert.strictEqual(state.towerCount, 1);
    assert.strictEqual(state.gold, STARTING_GOLD - BASIC_COST);

    const tower = state.towers[0];
    assert.strictEqual(tower.kind, 1); // TOWER_KIND_BASIC
    assert.strictEqual(tower.level, 1);
    assert.strictEqual(tower.x, 2);
    assert.strictEqual(tower.y, 2);
    assert.strictEqual(tower.damage, BASIC_DAMAGE);
    assert.strictEqual(tower.rangeSubtiles, BASIC_RANGE_SUBTILES);
    assert.strictEqual(tower.cooldownTicks, BASIC_COOLDOWN_TICKS);
    // Build delay: ready at current_tick (0) + TOWER_BUILD_TICKS.
    assert.strictEqual(Number(tower.readyAtTick), TOWER_BUILD_TICKS);
  });

  it("Rejects a tower on the path", async () => {
    const board = boardPDA();
    // (0,2) lies on the first path segment (0,0)->(0,4).
    let failed = false;
    try {
      await program.methods
        .placeTower(0, 2, 1)
        .accountsPartial({
          board,
          signer: payer.publicKey,
          authority: payer.publicKey,
          sessionToken: null,
        })
        .rpc({ skipPreflight: true });
    } catch (e) {
      failed = true;
    }
    assert.isTrue(failed, "placing a tower on the path should fail");

    const state = await program.account.board.fetch(board);
    assert.strictEqual(state.towerCount, 1); // unchanged
  });

  it("Upgrades a tower", async () => {
    const board = boardPDA();

    // A tower can only be upgraded once its INITIAL build has finished
    // (current_tick >= ready_at_tick == TOWER_BUILD_TICKS). Advance the sim
    // past the build delay first, letting real time accrue for the tick budget.
    let advanced = await program.account.board.fetch(board);
    for (let iter = 100; iter < 116; iter++) {
      if (Number(advanced.currentTick) >= TOWER_BUILD_TICKS) break;
      await new Promise((r) => setTimeout(r, 1200));
      const asig = await program.methods
        .advanceGame(50, iter)
        .accountsPartial({
          sessionToken: null,
          board,
          authority: payer.publicKey,
          signer: payer.publicKey,
        })
        .rpc({ skipPreflight: true });
      await provider.connection.confirmTransaction(asig, "confirmed");
      advanced = await program.account.board.fetch(board);
    }
    assert.isAtLeast(
      Number(advanced.currentTick),
      TOWER_BUILD_TICKS,
      "sim should have advanced past the tower build delay"
    );

    const before = await program.account.board.fetch(board);
    const goldBefore = before.gold;

    const sig = await program.methods
      .upgradeTower(0)
      .accountsPartial({
        board,
        signer: payer.publicKey,
        authority: payer.publicKey,
        sessionToken: null,
      })
      .rpc({ skipPreflight: true });
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Upgrades are DEFERRED: on submit the boosted stats land in pending_* and
    // ready_at_tick moves forward; current stats stay until the build commits.
    const state = await program.account.board.fetch(board);
    const tower = state.towers[0];
    assert.strictEqual(tower.level, 1, "level stays until upgrade commits");
    assert.strictEqual(tower.pendingLevel, 2);
    assert.strictEqual(tower.pendingDamage, BASIC_DAMAGE + BASIC_UPGRADE_DAMAGE_BONUS);
    assert.strictEqual(
      tower.pendingRangeSubtiles,
      BASIC_RANGE_SUBTILES + BASIC_UPGRADE_RANGE_BONUS
    );
    assert.strictEqual(state.gold, goldBefore - BASIC_UPGRADE_COST);
  });

  it("Queues a wave of units with staggered spawn ticks", async () => {
    // Fresh, isolated board so spawn ticks are relative to a known tick (0) and
    // aren't affected by advances/auto-waves from earlier tests on the shared
    // board.
    const owner = anchor.web3.Keypair.generate();
    const air = await provider.connection.requestAirdrop(owner.publicKey, 1e9);
    await provider.connection.confirmTransaction(air, "confirmed");

    const [board] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("board"), owner.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initBoard()
      .accountsPartial({
        board,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    const sig = await program.methods
      .spawnWave(3)
      .accountsPartial({ board, signer: owner.publicKey })
      .signers([owner])
      .rpc({ skipPreflight: true });
    await provider.connection.confirmTransaction(sig, "confirmed");

    const state = await program.account.board.fetch(board);
    assert.strictEqual(Number(state.nextUnitId), 3);
    assert.strictEqual(Number(state.currentTick), 0);

    // Units queued (state == 1), with base stats and staggered spawn ticks.
    // current_tick is 0 (fresh board); base spawn = 0 + UNIT_SPAWN_DELAY_TICKS.
    const queued = state.units.filter((u) => u.state === 1);
    assert.strictEqual(queued.length, 3);

    for (let i = 0; i < 3; i++) {
      const u = state.units[i];
      assert.strictEqual(u.state, 1); // UNIT_STATE_QUEUED
      assert.strictEqual(u.hp, UNIT_BASE_HP);
      assert.strictEqual(u.maxHp, UNIT_BASE_HP);
      assert.strictEqual(u.speedSubtiles, UNIT_BASE_SPEED_SUBTILES);
      assert.strictEqual(u.reward, UNIT_BASE_REWARD);
      assert.strictEqual(Number(u.progressSubtiles), 0);
      // spawn_tick = UNIT_SPAWN_DELAY_TICKS + i * UNIT_SPAWN_STAGGER_TICKS
      assert.strictEqual(
        Number(u.spawnTick),
        UNIT_SPAWN_DELAY_TICKS + i * UNIT_SPAWN_STAGGER_TICKS
      );
    }
  });

  it("Advances the sim with exact deterministic movement", async () => {
    // Fresh, tower-free board so movement is isolated from tower shots.
    const owner = anchor.web3.Keypair.generate();
    const air = await provider.connection.requestAirdrop(owner.publicKey, 1e9);
    await provider.connection.confirmTransaction(air, "confirmed");

    const [board] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("board"), owner.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initBoard()
      .accountsPartial({
        board,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    await program.methods
      .spawnWave(3)
      .accountsPartial({ board, signer: owner.publicKey })
      .signers([owner])
      .rpc({ skipPreflight: true });

    const SUBTILES_PER_TILE = 256;
    // Path (0,0)->(0,4)->(7,4)->(7,7): 4 + 7 + 3 = 14 tiles.
    const PATH_LEN_SUB = 14 * SUBTILES_PER_TILE;

    // Snapshot each unit's immutable spawn params before advancing.
    const pre = await program.account.board.fetch(board);
    const unitParams = pre.units.map((u) => ({
      spawnTick: Number(u.spawnTick),
      speed: u.speedSubtiles,
      wasActive: u.state === 1 || u.state === 2,
    }));

    // Advance in slices, letting real time accrue so the clock budget allows
    // ticks. We don't assume how many ticks each call applies; we read the
    // resulting current_tick and assert positions are the exact pure function
    // of (current_tick, spawn_tick, speed).
    let state = pre;
    for (let iter = 0; iter < 16; iter++) {
      await new Promise((r) => setTimeout(r, 1200)); // > 1s => budget >= 10 ticks
      const sig = await program.methods
        .advanceGame(50, iter)
        .accountsPartial({
          sessionToken: null,
          board,
          authority: owner.publicKey,
          signer: owner.publicKey,
        })
        .signers([owner])
        .rpc({ skipPreflight: true });
      await provider.connection.confirmTransaction(sig, "confirmed");
      state = await program.account.board.fetch(board);
      if (Number(state.currentTick) >= 45) break;
    }

    const tick = Number(state.currentTick);
    assert.isAtLeast(tick, 45, "expected the sim to have advanced enough ticks");

    // Verify each unit that has begun walking is at the exact expected offset.
    for (let i = 0; i < unitParams.length; i++) {
      const p = unitParams[i];
      if (!p.wasActive) continue;

      const ticksWalked = Math.max(0, tick - p.spawnTick);
      const expected = Math.min(ticksWalked * p.speed, PATH_LEN_SUB);
      const u = state.units[i];
      assert.strictEqual(
        Number(u.progressSubtiles),
        expected,
        `unit ${i} progress mismatch at tick ${tick}`
      );
    }

    console.log("Advanced to tick", tick);
  });

  it("Towers deterministically damage and kill units", async () => {
    // Fresh, isolated board owned by a new keypair for exact assertions.
    const owner = anchor.web3.Keypair.generate();
    const air = await provider.connection.requestAirdrop(owner.publicKey, 1e9);
    await provider.connection.confirmTransaction(air, "confirmed");

    const [board] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("board"), owner.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initBoard()
      .accountsPartial({
        board,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // Tower at (1,0): adjacent to path start (0,0), range 2 tiles covers the
    // first path segment. Cost 50, gold 100 -> 50 left.
    await program.methods
      .placeTower(1, 0, 1)
      .accountsPartial({
        board,
        signer: owner.publicKey,
        authority: owner.publicKey,
        sessionToken: null,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    const goldAfterBuild = STARTING_GOLD - BASIC_COST;

    // One unit of base stats.
    await program.methods
      .spawnWave(1)
      .accountsPartial({ board, signer: owner.publicKey })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // Advance until the unit is dead or we run long enough. The tower arms at
    // TOWER_BUILD_TICKS and then fires every BASIC_COOLDOWN_TICKS for
    // BASIC_DAMAGE; with the unit inside a 3-tile range on the first segment it
    // gets killed well before leaking. We assert the deterministic OUTCOME
    // (dead + reward bookkeeping) rather than a brittle exact kill tick.
    let state = await program.account.board.fetch(board);
    for (let iter = 0; iter < 24; iter++) {
      await new Promise((r) => setTimeout(r, 1200));
      const sig = await program.methods
        .advanceGame(50, iter)
        .accountsPartial({
          sessionToken: null,
          board,
          authority: owner.publicKey,
          signer: owner.publicKey,
        })
        .signers([owner])
        .rpc({ skipPreflight: true });
      await provider.connection.confirmTransaction(sig, "confirmed");
      state = await program.account.board.fetch(board);
      if (state.units[0].state === 3 /* DEAD */) break;
      if (Number(state.currentTick) >= 120) break;
    }

    const unit = state.units[0];
    assert.strictEqual(unit.state, 3, "unit should be dead"); // UNIT_STATE_DEAD
    assert.strictEqual(unit.hp, 0);
    assert.strictEqual(state.kills, 1);
    // No lives lost (killed before reaching the end).
    assert.strictEqual(state.lives, STARTING_LIVES);
    // gold: after building the tower, +BASIC reward for the one kill.
    assert.strictEqual(state.gold, goldAfterBuild + UNIT_BASE_REWARD);

    // Tower's last shot must be at/after it armed.
    const lastShot = Number(state.towers[0].lastShotTick);
    assert.isAtLeast(lastShot, TOWER_BUILD_TICKS);

    console.log("Unit killed; last shot tick", lastShot, "kills", state.kills);
  });

  it("Splash tower damages multiple enemies and matches the client sim", async () => {
    // Fresh, isolated board.
    const owner = anchor.web3.Keypair.generate();
    const air = await provider.connection.requestAirdrop(owner.publicKey, 1e9);
    await provider.connection.confirmTransaction(air, "confirmed");

    const [board] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("board"), owner.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initBoard()
      .accountsPartial({
        board,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // Place a SPLASH tower (kind 2) at (1,0), next to the path start so the
    // first path segment sits inside both its range and its blast radius.
    await program.methods
      .placeTower(1, 0, 2)
      .accountsPartial({
        board,
        signer: owner.publicKey,
        authority: owner.publicKey,
        sessionToken: null,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    const placed = await program.account.board.fetch(board);
    const splashTower = placed.towers[0];
    assert.strictEqual(splashTower.kind, 2, "kind should be splash");
    // Splash radius must be set on-chain (repurposed from the old pad field).
    assert.isAbove(
      Number(splashTower.splashRadiusSubtiles),
      0,
      "splash tower must have a splash radius"
    );

    await program.methods
      .spawnWave(4)
      .accountsPartial({ board, signer: owner.publicKey })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // Snapshot into the client sim, then advance on-chain in slices and require
    // the sim to reproduce the board bit-for-bit (this exercises the splash math
    // in both places). Also track the max number of enemies damaged by a single
    // shot to prove the AoE actually hit multiple units.
    const start = await program.account.board.fetch(board);
    const predicted: SimBoard = fromChain(start);
    let tickBefore = Number(start.currentTick);
    let sawMultiHit = false;
    let prevHps = start.units.map((u) => u.hp);

    let acc = start;
    for (let iter = 200; iter < 216; iter++) {
      await new Promise((r) => setTimeout(r, 1200));
      const sig = await program.methods
        .advanceGame(50, iter)
        .accountsPartial({
          sessionToken: null,
          board,
          authority: owner.publicKey,
          signer: owner.publicKey,
        })
        .signers([owner])
        .rpc({ skipPreflight: true });
      await provider.connection.confirmTransaction(sig, "confirmed");
      acc = await program.account.board.fetch(board);

      // How many units lost HP since the last snapshot? A splash shot hitting a
      // cluster drops several at once.
      let damagedThisSlice = 0;
      for (let i = 0; i < acc.units.length; i++) {
        if (acc.units[i].hp < prevHps[i]) damagedThisSlice += 1;
      }
      if (damagedThisSlice >= 2) sawMultiHit = true;
      prevHps = acc.units.map((u) => u.hp);

      const applied = Number(acc.currentTick) - tickBefore;
      tickBefore = Number(acc.currentTick);
      if (applied > 0) applyTicks(predicted, applied);

      // Parity: splash damage must be identical client-side and on-chain.
      const chain = fromChain(acc);
      assert.strictEqual(predicted.kills, chain.kills, "kills parity");
      assert.strictEqual(predicted.gold, chain.gold, "gold parity");
      for (let i = 0; i < predicted.units.length; i++) {
        assert.strictEqual(
          predicted.units[i].hp,
          chain.units[i].hp,
          `unit ${i} hp parity`
        );
      }

      if (Number(acc.currentTick) >= 80) break;
    }

    assert.isTrue(
      sawMultiHit,
      "splash tower should damage 2+ enemies in a single slice"
    );
    console.log("Splash parity held; kills", acc.kills);
  });

  it("Advances via a session key and rejects a wrong authority", async () => {
    const owner = anchor.web3.Keypair.generate();
    const sessionSigner = anchor.web3.Keypair.generate();
    const air = await provider.connection.requestAirdrop(owner.publicKey, 2e9);
    await provider.connection.confirmTransaction(air, "confirmed");

    const [board] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("board"), owner.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initBoard()
      .accountsPartial({
        board,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    await program.methods
      .spawnWave(2)
      .accountsPartial({ board, signer: owner.publicKey })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // Create a session token via the Gum SDK's session program client (no
    // hand-built instruction). authority = owner, session_signer = ephemeral.
    const sessionToken = sessionTokenPDA(
      program.programId,
      sessionSigner.publicKey,
      owner.publicKey
    );
    const now = Math.floor(Date.now() / 1000);
    const sessionManager = new SessionTokenManager(
      { publicKey: owner.publicKey } as any,
      provider.connection
    );
    const createIx = await sessionManager.program.methods
      .createSession(true, new anchor.BN(now + 60 * 60), new anchor.BN(0.05 * anchor.web3.LAMPORTS_PER_SOL))
      .accounts({
        sessionToken,
        sessionSigner: sessionSigner.publicKey,
        authority: owner.publicKey,
        targetProgram: program.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();
    const createTx = new anchor.web3.Transaction().add(createIx);
    await provider.sendAndConfirm(createTx, [owner, sessionSigner]);
    console.log("Session token created:", sessionToken.toBase58());

    // Advance using ONLY the ephemeral session signer (owner does not sign).
    let state = await program.account.board.fetch(board);
    for (let iter = 0; iter < 8; iter++) {
      await new Promise((r) => setTimeout(r, 1200));
      const sig = await program.methods
        .advanceGame(30, iter)
        .accountsPartial({
          sessionToken,
          board,
          authority: owner.publicKey,
          signer: sessionSigner.publicKey,
        })
        .signers([sessionSigner])
        .rpc({ skipPreflight: true });
      await provider.connection.confirmTransaction(sig, "confirmed");
      state = await program.account.board.fetch(board);
      if (Number(state.currentTick) >= 40) break;
    }
    assert.isAtLeast(
      Number(state.currentTick),
      40,
      "session-signed advance should progress the sim"
    );
    console.log("Session-signed advance reached tick", Number(state.currentTick));

    // Wrong authority (no session token, signer is a random key that is not the
    // board authority) must be rejected by the #[session_auth_or] gate.
    const stranger = anchor.web3.Keypair.generate();
    const air2 = await provider.connection.requestAirdrop(stranger.publicKey, 1e9);
    await provider.connection.confirmTransaction(air2, "confirmed");

    let rejected = false;
    try {
      await program.methods
        .advanceGame(10, 999)
        .accountsPartial({
          sessionToken: null,
          board,
          authority: owner.publicKey,
          signer: stranger.publicKey,
        })
        .signers([stranger])
        .rpc({ skipPreflight: true });
    } catch (e) {
      rejected = true;
    }
    assert.isTrue(rejected, "a non-authority signer without a session must fail");
  });

  it("Client prediction matches the on-chain board bit-for-bit", async () => {
    const owner = anchor.web3.Keypair.generate();
    const air = await provider.connection.requestAirdrop(owner.publicKey, 1e9);
    await provider.connection.confirmTransaction(air, "confirmed");

    const [board] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("board"), owner.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initBoard()
      .accountsPartial({
        board,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // Two towers covering the first path segment so shots factor into parity.
    await program.methods
      .placeTower(1, 1, 1)
      .accountsPartial({
        board,
        signer: owner.publicKey,
        authority: owner.publicKey,
        sessionToken: null,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });
    await program.methods
      .placeTower(1, 3, 1)
      .accountsPartial({
        board,
        signer: owner.publicKey,
        authority: owner.publicKey,
        sessionToken: null,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    await program.methods
      .spawnWave(4)
      .accountsPartial({ board, signer: owner.publicKey })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // Snapshot the starting state and mirror it into the client simulator.
    const startAcc = await program.account.board.fetch(board);
    const predicted: SimBoard = fromChain(startAcc);
    let onchainTickBefore = Number(startAcc.currentTick);

    // Advance on-chain in slices; after each slice run the client sim forward
    // by the SAME number of ticks and require exact equality.
    let acc = startAcc;
    for (let iter = 0; iter < 12; iter++) {
      await new Promise((r) => setTimeout(r, 1200));
      const sig = await program.methods
        .advanceGame(20, iter)
        .accountsPartial({
          sessionToken: null,
          board,
          authority: owner.publicKey,
          signer: owner.publicKey,
        })
        .signers([owner])
        .rpc({ skipPreflight: true });
      await provider.connection.confirmTransaction(sig, "confirmed");
      acc = await program.account.board.fetch(board);

      const applied = Number(acc.currentTick) - onchainTickBefore;
      onchainTickBefore = Number(acc.currentTick);
      if (applied > 0) applyTicks(predicted, applied);

      // Compare the client prediction to the on-chain truth after this slice.
      assertBoardsEqual(predicted, fromChain(acc));

      if (Number(acc.currentTick) >= 60) break;
    }

    assert.isAtLeast(Number(acc.currentTick), 60);
    console.log(
      "Client/on-chain parity held through tick",
      Number(acc.currentTick),
      "| kills",
      predicted.kills,
      "| gold",
      predicted.gold
    );
  });

  it("Auto-waves spawn mixed enemy types matching the client roster", async () => {
    // Fresh, tower-free board so units survive long enough to inspect their
    // types (no shots), and so the auto-wave lands on a known schedule.
    const owner = anchor.web3.Keypair.generate();
    const air = await provider.connection.requestAirdrop(owner.publicKey, 1e9);
    await provider.connection.confirmTransaction(air, "confirmed");

    const [board] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("board"), owner.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initBoard()
      .accountsPartial({
        board,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // Advance past WAVE_FIRST_DELAY_TICKS (40) so wave 0 spawns.
    let acc = await program.account.board.fetch(board);
    for (let iter = 0; iter < 8 && Number(acc.waveNumber) < 1; iter++) {
      await new Promise((r) => setTimeout(r, 1200));
      const sig = await program.methods
        .advanceGame(30, iter)
        .accountsPartial({
          sessionToken: null,
          board,
          authority: owner.publicKey,
          signer: owner.publicKey,
        })
        .signers([owner])
        .rpc({ skipPreflight: true });
      await provider.connection.confirmTransaction(sig, "confirmed");
      acc = await program.account.board.fetch(board);
    }
    assert.isAtLeast(Number(acc.waveNumber), 1, "wave 0 should have spawned");

    // The first wave (n = 0) enemy kinds must match the deterministic roster
    // from wave_enemy_kind(0, i). Units are placed in slot order = spawn order.
    const onchainKinds = acc.units
      .filter(
        (u) => u.state === UNIT_STATE_QUEUED || u.state === UNIT_STATE_WALKING
      )
      .map((u) => u.enemyKind);
    assert.isAtLeast(onchainKinds.length, 1, "expected queued/walking units");
    onchainKinds.forEach((k, i) => {
      assert.strictEqual(
        k,
        waveEnemyKind(0, i),
        `wave-0 unit ${i} kind should match client roster`
      );
    });
    // Wave 0 is not a boss wave, so no boss should be present yet.
    assert.isFalse(isBossWave(0));
    assert.isFalse(
      onchainKinds.includes(ENEMY_KIND_BOSS),
      "wave 0 must not contain a boss"
    );
    // A varied roster: not every unit is NORMAL (fast/strong are mixed in).
    assert.isTrue(
      onchainKinds.some((k) => k !== ENEMY_KIND_NORMAL),
      "wave 0 should contain at least one non-normal enemy"
    );

    // Client parity: mirror and step forward one slice; kinds + stats match.
    const predicted: SimBoard = fromChain(acc);
    let before = Number(acc.currentTick);
    await new Promise((r) => setTimeout(r, 1200));
    const sig = await program.methods
      .advanceGame(20, 100)
      .accountsPartial({
        sessionToken: null,
        board,
        authority: owner.publicKey,
        signer: owner.publicKey,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });
    await provider.connection.confirmTransaction(sig, "confirmed");
    acc = await program.account.board.fetch(board);
    const applied = Number(acc.currentTick) - before;
    if (applied > 0) applyTicks(predicted, applied);
    assertBoardsEqual(predicted, fromChain(acc));

    console.log(
      "Wave-0 enemy roster:",
      onchainKinds.join(","),
      "| client parity held through tick",
      Number(acc.currentTick)
    );
  });

  it("Boss wave produces a boss with scaled HP (client sim)", () => {
    // Reaching the 5th wave on-chain would require a long real-time run (the
    // tick budget is wall-clock gated), so verify the boss roster + stats via
    // the client sim - which is proven bit-identical to the program by the
    // parity tests above. Boss waves are n = 4, 9, ... (every 5th).
    assert.isTrue(isBossWave(4), "wave index 4 (5th wave) is a boss wave");
    assert.strictEqual(
      waveEnemyKind(4, 0),
      ENEMY_KIND_BOSS,
      "first unit of a boss wave is the boss"
    );
    // A boss's HP compounds with the wave like any enemy but off a much larger
    // base (400), so it should dwarf a normal unit in the same wave.
    const bossBoard: SimBoard = {
      currentTick: 0,
      lives: 8,
      gold: 200,
      kills: 0,
      // Jump straight to the boss wave so spawnAutoWave uses n = 4.
      waveNumber: 4,
      nextWaveTick: 1,
      pathLen: 4,
      path: [
        { x: 0, y: 0 },
        { x: 0, y: 4 },
        { x: 7, y: 4 },
        { x: 7, y: 7 },
      ],
      towerCount: 0,
      towers: [],
      units: Array.from({ length: 16 }, () => ({
        state: 0,
        enemyKind: 0,
        speedSubtiles: 0,
        hp: 0,
        maxHp: 0,
        reward: 0,
        spawnTick: 0,
        progressSubtiles: 0,
      })),
    };
    // One tick reaches nextWaveTick (1) and spawns the wave.
    applyTicks(bossBoard, 1);
    const boss = bossBoard.units.find((u) => u.enemyKind === ENEMY_KIND_BOSS);
    assert.isDefined(boss, "boss should have spawned");
    const normal = bossBoard.units.find(
      (u) => u.enemyKind === ENEMY_KIND_NORMAL && u.state !== 0
    );
    assert.isDefined(normal, "a normal should also be in the boss wave");
    assert.isAbove(
      boss!.hp,
      normal!.hp * 3,
      "boss HP should dwarf a normal in the same wave"
    );
    assert.isAbove(boss!.reward, 80, "boss reward should be a big bounty");
    console.log(
      "Boss-wave boss hp",
      boss!.hp,
      "reward",
      boss!.reward,
      "vs normal hp",
      normal!.hp
    );
  });
});

function assertBoardsEqual(a: SimBoard, b: SimBoard) {
  assert.strictEqual(a.currentTick, b.currentTick, "currentTick");
  assert.strictEqual(a.lives, b.lives, "lives");
  assert.strictEqual(a.gold, b.gold, "gold");
  assert.strictEqual(a.kills, b.kills, "kills");
  assert.strictEqual(a.towerCount, b.towerCount, "towerCount");
  for (let i = 0; i < a.towerCount; i++) {
    assert.strictEqual(a.towers[i].lastShotTick, b.towers[i].lastShotTick, `tower ${i} lastShotTick`);
    assert.strictEqual(a.towers[i].damage, b.towers[i].damage, `tower ${i} damage`);
  }
  for (let i = 0; i < a.units.length; i++) {
    assert.strictEqual(a.units[i].state, b.units[i].state, `unit ${i} state`);
    assert.strictEqual(a.units[i].hp, b.units[i].hp, `unit ${i} hp`);
    assert.strictEqual(
      a.units[i].enemyKind,
      b.units[i].enemyKind,
      `unit ${i} enemyKind`
    );
    assert.strictEqual(a.units[i].reward, b.units[i].reward, `unit ${i} reward`);
    assert.strictEqual(
      a.units[i].progressSubtiles,
      b.units[i].progressSubtiles,
      `unit ${i} progressSubtiles`
    );
  }
}
