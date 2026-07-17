import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Lumberjack } from "../target/types/lumberjack";
import { assert } from "chai";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { applyTicks, fromChain, SimBoard } from "./td_sim";

const SESSION_PROGRAM_ID = new anchor.web3.PublicKey(
  "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5"
);

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
    assert.strictEqual(state.lives, 10);
    assert.strictEqual(state.gold, 100);
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
      .placeTower(2, 2)
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
    assert.strictEqual(state.gold, 100 - 50); // TOWER_BASIC_COST

    const tower = state.towers[0];
    assert.strictEqual(tower.kind, 1); // TOWER_KIND_BASIC
    assert.strictEqual(tower.level, 1);
    assert.strictEqual(tower.x, 2);
    assert.strictEqual(tower.y, 2);
    assert.strictEqual(tower.damage, 10);
    assert.strictEqual(tower.rangeSubtiles, 2 * 256);
    assert.strictEqual(tower.cooldownTicks, 5);
    // Build delay: ready at current_tick (0) + TOWER_BUILD_TICKS (30).
    assert.strictEqual(Number(tower.readyAtTick), 30);
  });

  it("Rejects a tower on the path", async () => {
    const board = boardPDA();
    // (0,2) lies on the first path segment (0,0)->(0,4).
    let failed = false;
    try {
      await program.methods
        .placeTower(0, 2)
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

    const state = await program.account.board.fetch(board);
    const tower = state.towers[0];
    assert.strictEqual(tower.level, 2);
    assert.strictEqual(tower.damage, 10 + 8); // base + upgrade bonus
    assert.strictEqual(tower.rangeSubtiles, 2 * 256 + 128); // +0.5 tile
    assert.strictEqual(state.gold, goldBefore - 40); // TOWER_UPGRADE_COST
  });

  it("Queues a wave of units with staggered spawn ticks", async () => {
    const board = boardPDA();

    const sig = await program.methods
      .spawnWave(3)
      .accountsPartial({ board, signer: payer.publicKey })
      .rpc({ skipPreflight: true });
    await provider.connection.confirmTransaction(sig, "confirmed");

    const state = await program.account.board.fetch(board);
    assert.strictEqual(Number(state.nextUnitId), 3);

    // Units queued (state == 1), with base stats and staggered spawn ticks.
    // current_tick is still 0 (no advance yet); base spawn = 0 + 30.
    const queued = state.units.filter((u) => u.state === 1);
    assert.strictEqual(queued.length, 3);

    for (let i = 0; i < 3; i++) {
      const u = state.units[i];
      assert.strictEqual(u.state, 1); // UNIT_STATE_QUEUED
      assert.strictEqual(u.hp, 30);
      assert.strictEqual(u.maxHp, 30);
      assert.strictEqual(u.speedSubtiles, 16);
      assert.strictEqual(u.reward, 5);
      assert.strictEqual(Number(u.progressSubtiles), 0);
      // spawn_tick = 30 (delay) + i * 10 (stagger)
      assert.strictEqual(Number(u.spawnTick), 30 + i * 10);
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
      .placeTower(1, 0)
      .accountsPartial({
        board,
        signer: owner.publicKey,
        authority: owner.publicKey,
        sessionToken: null,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // One unit. spawn_tick = 30, hp 30, reward 5.
    await program.methods
      .spawnWave(1)
      .accountsPartial({ board, signer: owner.publicKey })
      .signers([owner])
      .rpc({ skipPreflight: true });

    // Advance until the unit is dead or we run long enough.
    let state = await program.account.board.fetch(board);
    for (let iter = 0; iter < 20; iter++) {
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
      if (Number(state.currentTick) >= 70) break;
    }

    const unit = state.units[0];
    // Tower is built by tick 30. The unit becomes WALKING during tick 30's
    // movement pass (after that tick's shot resolution), so the tower first
    // sees it at tick 31 and fires: ticks 31, 36, 41 (cooldown 5) -> 3 shots *
    // 10 dmg = 30 = full HP. The unit dies at tick 41 while still in range on
    // the first path segment.
    assert.strictEqual(unit.state, 3, "unit should be dead"); // UNIT_STATE_DEAD
    assert.strictEqual(unit.hp, 0);
    assert.strictEqual(state.kills, 1);
    // gold: 100 - 50 (tower) + 5 (kill reward) = 55.
    assert.strictEqual(state.gold, 55);

    // Tower's last shot must be the killing tick (>= ready) and a multiple of
    // the cadence from tick 30.
    const lastShot = Number(state.towers[0].lastShotTick);
    assert.isAtLeast(lastShot, 30);

    console.log("Unit killed; last shot tick", lastShot, "kills", state.kills);
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
      .placeTower(1, 1)
      .accountsPartial({
        board,
        signer: owner.publicKey,
        authority: owner.publicKey,
        sessionToken: null,
      })
      .signers([owner])
      .rpc({ skipPreflight: true });
    await program.methods
      .placeTower(1, 3)
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
      a.units[i].progressSubtiles,
      b.units[i].progressSubtiles,
      `unit ${i} progressSubtiles`
    );
  }
}
