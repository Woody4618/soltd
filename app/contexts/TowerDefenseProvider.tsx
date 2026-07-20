import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
  SystemProgram,
} from "@solana/web3.js"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { useSessionWallet } from "@magicblock-labs/gum-react-sdk"
import { useToast } from "@chakra-ui/react"
import {
  program,
  boardPda,
  poolPda,
  highscorePda,
  FEE_WALLET,
  MS_PER_TICK,
  MAX_TICKS_PER_SLICE,
  MAX_TOWERS,
  TOWER_BASIC_COST,
  TOWER_MAX_LEVEL,
  TOWER_BUILD_TICKS,
  TOWER_UPGRADE_BUILD_TICKS,
  TOWER_KIND_BASIC,
  towerDef,
  Highscore,
} from "@/utils/anchor"
import {
  SimBoard,
  applyTicks,
  cloneBoard,
  fromChain,
} from "@/utils/tdSim"

// Extra ticks added to a bundled "settle" advance (before build/upgrade) to
// cover the transaction round-trip. During confirmation local playback keeps
// moving at ~10 ticks/s; ~10 ticks (~1s) makes the confirmed settle tick land
// near where playback will actually be, so it re-anchors as a forward step
// instead of clamping backwards. The program's own real-time budget still caps
// how many ticks actually apply, so this never fast-forwards past real time.
const SETTLE_LOOKAHEAD_TICKS = 10

interface TowerDefenseContextValue {
  boardPDA: PublicKey | null
  // Latest confirmed on-chain board.
  confirmed: SimBoard | null
  // Board to render: the confirmed state, smoothly caught up from the previous
  // confirmed tick. Never advanced past the latest confirmed on-chain tick.
  predicted: SimBoard | null
  hasBoard: boolean
  // The board account exists on-chain (may or may not decode into the current
  // layout). Used to offer a Reset for stale/old-layout accounts.
  boardExists: boolean
  autoAdvance: boolean
  setAutoAdvance: (v: boolean) => void
  // Tower kind selected in the build menu; used for click-to-place.
  selectedKind: number
  setSelectedKind: (kind: number) => void
  busy: boolean
  // True while an advance (manual or auto) drain loop is running.
  advancing: boolean
  initBoard: () => Promise<void>
  resetBoard: () => Promise<void>
  placeTower: (x: number, y: number, kind?: number) => Promise<void>
  upgradeTower: (towerIndex: number) => Promise<void>
  advance: () => Promise<void>
  refresh: () => Promise<void>
  // Highscore + jackpot.
  highscore: Highscore | null
  jackpotSol: number
  refreshHighscore: () => Promise<void>
  payoutHighscore: () => Promise<void>
}

const TowerDefenseContext = createContext<TowerDefenseContextValue>({
  boardPDA: null,
  confirmed: null,
  predicted: null,
  hasBoard: false,
  boardExists: false,
  autoAdvance: false,
  setAutoAdvance: () => {},
  selectedKind: TOWER_KIND_BASIC,
  setSelectedKind: () => {},
  busy: false,
  advancing: false,
  initBoard: async () => {},
  resetBoard: async () => {},
  placeTower: async () => {},
  upgradeTower: async () => {},
  advance: async () => {},
  refresh: async () => {},
  highscore: null,
  jackpotSol: 0,
  refreshHighscore: async () => {},
  payoutHighscore: async () => {},
})

export const useTowerDefense = () => useContext(TowerDefenseContext)

export const TowerDefenseProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const { publicKey, sendTransaction } = useWallet()
  const { connection } = useConnection()
  const sessionWallet = useSessionWallet()
  const toast = useToast()

  // Surface an on-chain failure to the user with the real program logs, and
  // log the full detail to the console for debugging.
  const reportError = useCallback(
    (label: string, e: any) => {
      const msg = e?.message ?? String(e)
      console.error(`${label}:`, e)
      toast({
        title: label,
        description: msg,
        status: "error",
        duration: 12000,
        isClosable: true,
      })
    },
    [toast]
  )

  // A lightweight, non-error notice (e.g. a client-side rule caught before we
  // bother the chain with a doomed transaction).
  const notify = useCallback(
    (msg: string) => {
      toast({
        description: msg,
        status: "warning",
        duration: 4000,
        isClosable: true,
      })
    },
    [toast]
  )

  // The on-chain SessionToken stores `valid_until` (unix seconds) at byte
  // offset 8 + 32*3 = 104. Reading it raw lets us reject a session action
  // BEFORE sending a doomed transaction (expired or already-closed token).
  const SESSION_VALID_UNTIL_OFFSET = 8 + 32 * 3
  const sessionTokenValid = useCallback(
    async (tokenStr: string): Promise<boolean> => {
      try {
        const info = await connection.getAccountInfo(new PublicKey(tokenStr))
        if (!info || info.data.length < SESSION_VALID_UNTIL_OFFSET + 8) {
          return false // account gone => expired/revoked
        }
        const view = new DataView(
          info.data.buffer,
          info.data.byteOffset,
          info.data.byteLength
        )
        const validUntil = Number(
          view.getBigInt64(SESSION_VALID_UNTIL_OFFSET, true)
        )
        return validUntil > Math.floor(Date.now() / 1000)
      } catch {
        // On an RPC hiccup, don't block the action - let the chain decide.
        return true
      }
    },
    [connection]
  )

  // Called when a session-signed action can't proceed because the session is
  // invalid. Stops the auto-run loop (so we don't spam failures) and tells the
  // player to renew it via the button up top.
  const handleSessionInvalid = useCallback(() => {
    setAutoAdvance(false)
    notify(
      "Your session expired. Click Renew session at the top to keep playing without wallet popups."
    )
  }, [notify])

  // Heuristic: does this error look like a session-key rejection (expired /
  // revoked token, or authority mismatch from the session gate)?
  const isSessionError = useCallback((e: any): boolean => {
    const msg = (e?.message ?? String(e ?? "")).toLowerCase()
    return (
      msg.includes("session") ||
      msg.includes("wrongauthority") ||
      msg.includes("account does not exist") ||
      msg.includes("could not find") ||
      msg.includes("invalidtoken") ||
      msg.includes("notoken")
    )
  }, [])

  const [boardPDA, setBoardPDA] = useState<PublicKey | null>(null)
  const [confirmed, setConfirmed] = useState<SimBoard | null>(null)
  // Global highscore list + jackpot (in SOL). Refreshed on load, after a
  // game-over submit, and after a payout.
  const [highscore, setHighscore] = useState<Highscore | null>(null)
  const [jackpotSol, setJackpotSol] = useState<number>(0)
  const [predicted, setPredicted] = useState<SimBoard | null>(null)
  const [hasBoard, setHasBoard] = useState(false)
  const [boardExists, setBoardExists] = useState(false)
  const [autoAdvance, setAutoAdvance] = useState(false)
  const [selectedKind, setSelectedKind] = useState<number>(TOWER_KIND_BASIC)
  const [busy, setBusy] = useState(false)
  // True while a manual/auto advance drain loop is in flight - drives the HUD
  // advance-arrow spinner so the player sees something is happening.
  const [advancing, setAdvancing] = useState(false)

  // Smooth playback model.
  //
  // The naive "reset the animation timer on every account update" approach
  // snaps: confirmations arrive in bursts and each one jumps the target forward
  // and restarts the clock, so the units teleport to the end of the latest
  // slice. Instead we run a FREE-RUNNING local playback clock (`playbackTick`)
  // that advances at real time and only ever eases UP toward the latest
  // confirmed tick (a moving ceiling) - it never resets or jumps backward.
  //
  // We keep a small buffer of recent confirmed boards (sorted by tick). Each
  // frame we pick the newest confirmed board whose tick <= playbackTick as the
  // deterministic simulation anchor and run the exact on-chain tick loop from
  // there up to floor(playbackTick). Because we periodically re-anchor on a
  // real confirmed board, any float drift self-corrects and we never render a
  // tick the chain hasn't actually computed.
  const confirmedBufRef = useRef<SimBoard[]>([]) // sorted ascending by tick
  const latestRef = useRef<SimBoard | null>(null) // most recent confirmed board
  const ceilingTickRef = useRef<number>(0) // latest CONFIRMED tick (chain truth)
  const playbackTickRef = useRef<number>(0) // free-running local position
  const lastFrameRef = useRef<number>(0) // wall-clock of previous frame
  // Wall-clock (performance.now) when the latest forward-confirmed board arrived.
  // Playback may LEAD the confirmed tick, but only by as much real time as has
  // actually elapsed since that confirm - because the program grants at most
  // `elapsed_seconds * 10` ticks (its anti-cheat budget). Predicting further
  // than that would show ticks the chain will refuse, causing a snap-back. So
  // the render loop clamps playback to `confirmedTick + min(SLICE, elapsed*10)`.
  const confirmedAtRef = useRef<number>(0)
  const advancingRef = useRef(false)
  // Monotonic nonce fed to advance_game (its `counter` arg) so back-to-back
  // advances/settles produce distinct tx signatures.
  const advanceCounterRef = useRef(0)
  // Tower indices with an in-flight (optimistic) UPGRADE. Applied onto the
  // predicted board each frame so the cyan upgrade bar APPEARS the instant you
  // click - but pinned at 0% (readyAtTick kept a full build-time ahead every
  // frame) until the program responds with the real start tick on the confirmed
  // board, at which point the bar begins filling. Cleared once the confirmed
  // board reflects the pending upgrade (predicted derives it) or the action ends.
  const pendingUpgradesRef = useRef<Set<number>>(new Set())
  // Optimistic tower PLACEMENTS not yet reflected on-chain. Each is injected as
  // a greyed-out "building" tower into the rendered board the instant you pick
  // it in the build ring, so the tower appears immediately (like the -gold
  // blip) instead of after the confirmation round-trip. Keyed by tile so a
  // placement is dropped once the confirmed board carries a tower on that tile.
  const pendingPlacementsRef = useRef<
    { x: number; y: number; kind: number }[]
  >([])
  // Reset guard. reset_board rewinds the on-chain tick to 0, but a lagging
  // RPC/subscription can still deliver the PRE-reset board (high tick, old
  // units) a moment later - even AFTER we've applied the fresh tick-0 board.
  // Treated as a forward step that would re-introduce the old game. We defend in
  // two phases:
  //   1. `awaitingResetRef`: until we've seen the fresh tick-0 board, drop every
  //      non-tick-0 update.
  //   2. `resetGuardUntilRef`: for a short window after that, keep dropping any
  //      update whose tick is implausibly far ahead of a freshly-reset game
  //      (a genuine new game only advances ~10 ticks/s), catching late laggards.
  const awaitingResetRef = useRef(false)
  const resetGuardUntilRef = useRef(0)
  const resetGuardAtRef = useRef(0)

  // confirmedRef is the source of truth for game logic (lives/gameover checks).
  const confirmedRef = latestRef

  // Mirrors the latest predicted playback board so imperative callbacks (build /
  // upgrade guards, settle) can read it synchronously without waiting on state.
  const predictedRef = useRef<SimBoard | null>(null)
  const pushPredicted = useCallback((sim: SimBoard | null) => {
    predictedRef.current = sim
    setPredicted(sim)
  }, [])

  const applyConfirmed = useCallback((sim: SimBoard) => {
    // While a reset is pending, drop any stale pre-reset board (high tick / old
    // units) that a lagging RPC may still push. Accept only the fresh tick-0
    // board, which clears the guard.
    let forceSnap = false
    if (awaitingResetRef.current) {
      if (sim.currentTick !== 0) return
      awaitingResetRef.current = false
      // Enter the second-phase window: laggard pre-reset updates can still land
      // for a moment; keep dropping implausibly-high ticks below.
      resetGuardAtRef.current = performance.now()
      resetGuardUntilRef.current = performance.now() + 4000
      // Force a full snap below even if the previous confirmed tick was already
      // 0 (e.g. reset right after init, or a double reset). Without this the
      // tick-comparison would take the "same tick" MERGE branch and old
      // towers/units in the buffer could survive the reset.
      forceSnap = true
    } else if (performance.now() < resetGuardUntilRef.current) {
      // Post-reset window: a genuine new game advances at ~10 ticks/s, so its
      // tick can't be more than elapsed*10 (+slack). Anything far above that is
      // a stale pre-reset laggard - drop it.
      const elapsedSec = (performance.now() - resetGuardAtRef.current) / 1000
      const plausibleTick = Math.ceil(elapsedSec * 10) + MAX_TICKS_PER_SLICE
      if (sim.currentTick > plausibleTick) return
    }

    const prevLatest = latestRef.current

    if (forceSnap || !prevLatest || sim.currentTick < prevLatest.currentTick) {
      // First load or a rewind (e.g. reset to tick 0): snap the whole playback
      // model to this state and start the real-time budget window now.
      confirmedBufRef.current = [sim]
      playbackTickRef.current = sim.currentTick
      ceilingTickRef.current = sim.currentTick
      confirmedAtRef.current = performance.now()
    } else if (sim.currentTick === prevLatest.currentTick) {
      // SAME tick, new content (e.g. a tower was placed/upgraded - those
      // instructions mutate state without advancing time). Merge the new board
      // WITHOUT touching the free-running playback clock, so we don't snap the
      // animation forward. Any confirmed board still ahead of playback keeps
      // its future ticks; we just refresh the entries at/after this tick.
      const buf = confirmedBufRef.current
      const merged = buf.filter((b) => b.currentTick < sim.currentTick)
      merged.push(sim)
      confirmedBufRef.current = merged
      // Ceiling unchanged (same tick). Playback keeps flowing.
    } else {
      // Forward step: just raise the ceiling and remember the board. Playback
      // keeps flowing at real time toward the new ceiling - no reset, no jump.
      const buf = confirmedBufRef.current
      buf.push(sim)
      // Drop confirmed boards we've already animated past (keep the last one
      // <= playbackTick as the anchor, plus everything ahead of playback).
      const pt = playbackTickRef.current
      let keepFrom = 0
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].currentTick <= pt) keepFrom = i
      }
      confirmedBufRef.current = buf.slice(keepFrom)
      ceilingTickRef.current = sim.currentTick
      // Restart the real-time lead budget so playback keeps flowing from this
      // fresh confirmed tick. BUT: a settle advance (bundled before a build /
      // upgrade) usually confirms a tick that is still BEHIND our free-running
      // playback, because the network round-trip let playback move on. If we
      // naively reset the budget window to `now`, the lead ceiling would snap
      // down to this (behind) confirmed tick and the render loop would clamp
      // playback BACKWARDS - the tiny "stuck" hitch. So we back-date the budget
      // window just enough that the ceiling still covers the current playback
      // position, i.e. we never yank playback below where it already is.
      const nowMs = performance.now()
      const leadTicks = Math.max(0, pt - sim.currentTick)
      const leadMs = leadTicks * MS_PER_TICK
      confirmedAtRef.current = nowMs - leadMs
    }

    latestRef.current = sim
    setConfirmed(sim)
  }, [])

  // Derive the board PDA and load/subscribe when the wallet changes.
  useEffect(() => {
    setConfirmed(null)
    pushPredicted(null)
    setHasBoard(false)
    setBoardExists(false)
    latestRef.current = null
    confirmedBufRef.current = []
    playbackTickRef.current = 0
    ceilingTickRef.current = 0
    lastFrameRef.current = 0
    confirmedAtRef.current = 0
    pendingUpgradesRef.current.clear()
    pendingPlacementsRef.current = []
    awaitingResetRef.current = false
    resetGuardUntilRef.current = 0
    resetGuardAtRef.current = 0
    if (!publicKey) {
      setBoardPDA(null)
      return
    }
    const pda = boardPda(publicKey)
    setBoardPDA(pda)

    let sub: number | null = null
    let cancelled = false

    program.account.board
      .fetch(pda)
      .then((data) => {
        if (cancelled) return
        setBoardExists(true)
        setHasBoard(true)
        applyConfirmed(fromChain(data))
      })
      .catch(async () => {
        if (cancelled) return
        setHasBoard(false)
        // Distinguish "no account at all" from "account exists but our decoder
        // can't read it" (e.g. an older on-chain layout). In the latter case we
        // can still Reset it (realloc migrates it to the new layout).
        try {
          const info = await connection.getAccountInfo(pda)
          if (!cancelled) setBoardExists(info != null)
        } catch {
          if (!cancelled) setBoardExists(false)
        }
      })

    sub = connection.onAccountChange(pda, (account) => {
      const decoded = program.coder.accounts.decode("board", account.data)
      setHasBoard(true)
      applyConfirmed(fromChain(decoded))
    })

    return () => {
      cancelled = true
      if (sub !== null) connection.removeAccountChangeListener(sub)
    }
  }, [publicKey, connection, applyConfirmed])

  // Render loop: advance the free-running playback clock at real time, then
  // deterministically simulate from the newest confirmed board at or before
  // playback up to floor(playback).
  //
  // Playback is allowed to LEAD the confirmed chain tick so that build bars,
  // enemy movement and waves animate live the moment you act - without waiting
  // for the next advance_game. The lead is bounded by the SAME budget the
  // program enforces on-chain: `elapsed_seconds * 10` ticks since the last
  // confirm (MS_PER_TICK = 100 => 10 ticks/s), capped at one slice. We floor
  // the seconds so we never predict a tick the chain would refuse - guaranteeing
  // that when we finally flush, the chain reproduces exactly what we showed (no
  // snap-back). Re-anchoring on real confirmed boards keeps it exact.
  useEffect(() => {
    let raf: number
    const frame = (now: number) => {
      const buf = confirmedBufRef.current
      if (buf.length > 0) {
        // Game over: the chain rejects any further advance once lives hit 0, so
        // the confirmed state is frozen. Freeze the client too - snap playback
        // to the confirmed game-over board and stop predicting ahead (otherwise
        // the local sim would keep marching enemies/waves past the real end).
        const latest = latestRef.current
        if (latest && latest.lives <= 0) {
          playbackTickRef.current = latest.currentTick
          lastFrameRef.current = now
          pushPredicted(latest)
          raf = requestAnimationFrame(frame)
          return
        }

        const last = lastFrameRef.current
        lastFrameRef.current = now
        const dtMs = last === 0 ? 0 : now - last

        // Real-time lead ceiling: how far past the confirmed tick we may show.
        // Budget accrues CONTINUOUSLY in milliseconds (not floored to whole
        // seconds). The old whole-second floor caused a ~1s freeze on re-anchor:
        // after a settle confirmed a tick just BEHIND playback, back-dating the
        // budget window left <1s of lead, which floored to 0 budget ticks, so the
        // ceiling dropped below playback and clamped it until a full second
        // accrued. Continuous ms keeps the ceiling smooth. We still floor the
        // rendered tick (Math.floor(pt) below), and the settle's look-ahead
        // reconciles with the chain's own whole-second budget, so we never render
        // a tick the chain will refuse.
        const confirmedTick = ceilingTickRef.current
        const elapsedMs = Math.max(0, now - confirmedAtRef.current)
        const budgetTicks = elapsedMs / MS_PER_TICK
        const leadCeiling =
          confirmedTick + Math.min(MAX_TICKS_PER_SLICE, budgetTicks)

        // Advance playback at real time, but never past the lead ceiling.
        let pt = playbackTickRef.current + dtMs / MS_PER_TICK
        if (pt > leadCeiling) pt = leadCeiling
        // Guard against float drift below the anchor.
        if (pt < buf[0].currentTick) pt = buf[0].currentTick
        playbackTickRef.current = pt

        const playTick = Math.floor(pt)

        // Pick the newest confirmed board whose tick <= playTick as the anchor.
        let anchor = buf[0]
        for (let i = 0; i < buf.length; i++) {
          if (buf[i].currentTick <= playTick) anchor = buf[i]
          else break
        }

        // Garbage-collect optimistic upgrade overlays. Critical: only drop an
        // overlay once the board we're actually about to RENDER (the `anchor`,
        // i.e. the newest confirmed board <= playTick) already carries the real
        // pending upgrade - NOT merely when the latest confirmed board does. The
        // latest confirmed board can be AHEAD of playback (the settle looks
        // ahead), so if we dropped the overlay based on it while the render
        // anchor is still an older pre-upgrade board, the bar would vanish until
        // playback caught up. This is what made a 2nd rapid upgrade's bar
        // disappear. We also drop overlays whose tower slot is gone/empty.
        if (pendingUpgradesRef.current.size > 0) {
          pendingUpgradesRef.current.forEach((idx) => {
            const at = anchor.towers[idx]
            if (!at || at.kind === 0 || at.pendingLevel !== 0) {
              pendingUpgradesRef.current.delete(idx)
            }
          })
        }

        // Garbage-collect optimistic placements once the render anchor already
        // has a real tower on that tile (same slot/index the program uses), so
        // we don't draw the greyed-out ghost on top of the confirmed tower.
        if (pendingPlacementsRef.current.length > 0) {
          pendingPlacementsRef.current = pendingPlacementsRef.current.filter(
            (p) =>
              !anchor.towers.some(
                (t) => t.kind !== 0 && t.x === p.x && t.y === p.y
              )
          )
        }

        // Apply the optimistic upgrade overlay onto whatever board we're about
        // to render: show the cyan upgrade bar the instant you click.
        const upgrades = pendingUpgradesRef.current
        const placements = pendingPlacementsRef.current
        const applyOverlays = (b: SimBoard) => {
          // Optimistic placements: inject each as a greyed-out "building" tower
          // into the next free slot so it appears the instant you click, pinned
          // as still-building (readyAtTick a full build-time ahead) until the
          // confirmed board carries the real tower. Skip if the tile is already
          // occupied on this board (confirmed caught up between GC and here).
          if (placements.length > 0) {
            placements.forEach((p) => {
              const occupied = b.towers.some(
                (t) => t.kind !== 0 && t.x === p.x && t.y === p.y
              )
              if (occupied) return
              const slot = b.towerCount
              if (slot >= b.towers.length) return
              const def = towerDef(p.kind)
              const t = b.towers[slot]
              t.kind = p.kind
              t.level = 1
              t.x = p.x
              t.y = p.y
              t.rangeSubtiles = def?.rangeSubtiles ?? 0
              t.damage = def?.damage ?? 0
              t.cooldownTicks = def?.cooldownTicks ?? 0
              t.splashRadiusSubtiles = def?.splashRadiusSubtiles ?? 0
              t.pendingLevel = 0
              t.pendingDamage = 0
              t.pendingRangeSubtiles = 0
              t.lastShotTick = 0
              // Pin as building: readyAtTick a full build-time ahead every frame
              // so the grey "building" state + 0% bar shows until the real tower
              // (with its true readyAtTick) arrives on the confirmed board.
              t.readyAtTick = b.currentTick + TOWER_BUILD_TICKS
              b.towerCount = slot + 1
            })
          }
          if (upgrades.size > 0) {
            upgrades.forEach((idx) => {
              const t = b.towers[idx]
              // Only overlay while the chain hasn't reflected the upgrade yet
              // (pendingLevel still 0). Once the confirmed board carries the real
              // pending upgrade, the predicted board derives it and we defer to
              // that (its real readyAtTick drives the filling bar).
              if (t && t.kind !== 0 && t.pendingLevel === 0) {
                // Show the pending upgrade (so the cyan bar APPEARS immediately)
                // but pin it at 0% by keeping readyAtTick a full build-time
                // ahead of the current tick every frame. The bar only starts
                // FILLING once the program responds with the real start tick
                // (carried on the confirmed board), which anchors readyAtTick.
                // Upgrade bonuses are per tower KIND, so read them from that
                // tower's balance row (basic/splash/slow differ). This is only a
                // transient preview - the confirmed board overrides it - but it
                // keeps the preview honest.
                const def = towerDef(t.kind)
                t.pendingLevel = t.level + 1
                t.pendingDamage = t.damage + (def?.upgradeDamageBonus ?? 0)
                t.pendingRangeSubtiles =
                  t.rangeSubtiles + (def?.upgradeRangeBonus ?? 0)
                t.readyAtTick = b.currentTick + TOWER_UPGRADE_BUILD_TICKS
              }
            })
          }
        }

        const hasOverlay = upgrades.size > 0 || placements.length > 0
        if (playTick <= anchor.currentTick) {
          if (hasOverlay) {
            const adj = cloneBoard(anchor)
            applyOverlays(adj)
            pushPredicted(adj)
          } else {
            pushPredicted(anchor)
          }
        } else {
          const sim = cloneBoard(anchor)
          applyTicks(sim, playTick - anchor.currentTick)
          applyOverlays(sim)
          pushPredicted(sim)
          // If the prediction reaches game over, stop the playback clock here so
          // enemies/waves don't keep marching past the (predicted) end while we
          // wait for the chain to confirm it.
          if (sim.lives <= 0) {
            playbackTickRef.current = sim.currentTick
          }
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const refresh = useCallback(async () => {
    if (!boardPDA) return
    try {
      const data = await program.account.board.fetch(boardPDA)
      setHasBoard(true)
      applyConfirmed(fromChain(data))
    } catch {
      setHasBoard(false)
    }
  }, [boardPDA, applyConfirmed])

  // Send a transaction with the main wallet. On any failure we dig out the full
  // on-chain program logs (from the SendTransactionError or the confirmation
  // result) so the real Anchor error is visible in the console instead of an
  // opaque "unknown action"/"failed to send" message.
  const sendMain = useCallback(
    async (tx: any) => {
      try {
        // Simulate ourselves FIRST. The wallet adapter's sendTransaction wraps
        // any RPC failure in an opaque "WalletSendTransactionError: Unexpected
        // error" that hides the program logs, so we run the simulation directly
        // against the RPC to capture the real Anchor error + logs.
        if (publicKey) {
          tx.feePayer = tx.feePayer ?? publicKey
          if (
            !tx.recentBlockhash ||
            tx.recentBlockhash === "11111111111111111111111111111111"
          ) {
            tx.recentBlockhash = (
              await connection.getLatestBlockhash("confirmed")
            ).blockhash
          }
          const sim = await connection.simulateTransaction(tx)
          if (sim.value.err) {
            const logs = sim.value.logs ?? []
            console.error(
              "Transaction simulation failed:",
              JSON.stringify(sim.value.err),
              "\nProgram logs:\n" + logs.join("\n")
            )
            throw new Error(
              `Simulation failed: ${JSON.stringify(
                sim.value.err
              )}\n${logs.join("\n")}`
            )
          }
        }

        const sig = await sendTransaction(tx, connection)
        const conf = await connection.confirmTransaction(sig, "confirmed")
        if (conf.value.err) {
          // Landed but failed: fetch the confirmed tx to read its logs.
          const detail = await connection.getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          })
          const logs = detail?.meta?.logMessages ?? []
          console.error(
            "Transaction failed on-chain:",
            JSON.stringify(conf.value.err),
            "\nProgram logs:\n" + logs.join("\n")
          )
          throw new Error(
            `Transaction failed: ${JSON.stringify(conf.value.err)}\n${logs.join(
              "\n"
            )}`
          )
        }
        return sig
      } catch (e: any) {
        if (e instanceof SendTransactionError) {
          // getLogs() pulls the simulation logs from the RPC for this failure.
          let logs: string[] | null = null
          try {
            logs = await e.getLogs(connection)
          } catch {
            logs = e.logs ?? null
          }
          console.error(
            "Transaction simulation failed:",
            e.message,
            "\nProgram logs:\n" + (logs ? logs.join("\n") : "(no logs)")
          )
          throw new Error(
            `${e.message}\n${logs ? logs.join("\n") : "(no logs)"}`
          )
        }
        console.error("Transaction send failed:", e?.message ?? e)
        throw e
      }
    },
    [sendTransaction, connection, publicKey]
  )

  // Fetch the global highscore list + jackpot pool balance for the UI.
  const refreshHighscore = useCallback(async () => {
    try {
      const hs = await program.account.highscore.fetch(highscorePda)
      setHighscore(hs as Highscore)
    } catch {
      setHighscore(null) // not created yet
    }
    try {
      const bal = await connection.getBalance(poolPda)
      // Show the spendable jackpot (balance minus the tiny rent reserve). The
      // pool is a zero-data account so its rent reserve is ~0.00089 SOL.
      const reserve = await connection.getMinimumBalanceForRentExemption(0)
      setJackpotSol(Math.max(0, (bal - reserve) / 1e9))
    } catch {
      // leave previous value
    }
  }, [connection])

  // Create the highscore singleton if it doesn't exist yet. It's a one-time
  // bootstrap; safe to call before every game (a redundant creation just fails
  // harmlessly and is swallowed).
  //
  // The jackpot pool is NOT created here anymore: init_board/reset_board declare
  // it `init_if_needed`, so the pool PDA is created on demand by the very first
  // game and simply loaded thereafter.
  const ensureHighscore = useCallback(async () => {
    if (!publicKey) return
    const hsInfo = await connection.getAccountInfo(highscorePda)
    if (!hsInfo) {
      try {
        const tx = await program.methods
          .initHighscore()
          .accountsPartial({
            highscore: highscorePda,
            signer: publicKey,
            systemProgram: SystemProgram.programId,
          })
          .transaction()
        await sendMain(tx)
      } catch (e) {
        console.warn("ensureHighscore (highscore):", (e as any)?.message ?? e)
      }
    }
  }, [publicKey, connection, sendMain])

  // Trigger the daily payout: split the jackpot 60/30/10 across the top 3
  // players and clear the list. Callable by anyone (the program enforces the
  // 24h cooldown). The winner accounts must match the leaderboard order.
  const payoutHighscore = useCallback(async () => {
    if (!publicKey) return
    const hs = await program.account.highscore.fetch(highscorePda).catch(() => null)
    if (!hs || hs.count === 0) {
      notify("The highscore list is empty - nothing to pay out yet.")
      return
    }
    const entries = (hs as Highscore).entries
    const count = (hs as Highscore).count
    // Winners are the top-N (max 3), in leaderboard order. Passed as remaining
    // accounts (writable, non-signer) so the program can verify + pay each.
    const places = Math.min(count, 3)
    const winnerMetas = entries.slice(0, places).map((e) => ({
      pubkey: e.player,
      isWritable: true,
      isSigner: false,
    }))
    setBusy(true)
    try {
      const tx = await program.methods
        .resetHighscore()
        .accountsPartial({
          highscore: highscorePda,
          pool: poolPda,
          signer: publicKey,
        })
        .remainingAccounts(winnerMetas)
        .transaction()
      await sendMain(tx)
      await refreshHighscore()
      notify("Jackpot paid out to the top 3 players and the board was reset!")
    } catch (e) {
      reportError("Payout failed", e)
    } finally {
      setBusy(false)
    }
  }, [publicKey, sendMain, refreshHighscore, notify, reportError])

  const initBoard = useCallback(async () => {
    if (!publicKey || !boardPDA) return
    setBusy(true)
    try {
      // Make sure the highscore singleton exists before the first game (it's a
      // one-time bootstrap; harmless if someone else already created it).
      await ensureHighscore()
      const tx = await program.methods
        .initBoard()
        .accountsPartial({
          board: boardPDA,
          pool: poolPda,
          feeWallet: FEE_WALLET,
          signer: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction()
      await sendMain(tx)
      await refresh()
    } catch (e) {
      reportError("Create board failed", e)
    } finally {
      setBusy(false)
    }
  }, [publicKey, boardPDA, sendMain, refresh, reportError])

  const resetBoard = useCallback(async () => {
    if (!publicKey || !boardPDA) return
    setBusy(true)
    setAutoAdvance(false)
    // Arm the reset guard so any lagging pre-reset account update (old tick/units)
    // is ignored until we see the fresh tick-0 board.
    awaitingResetRef.current = true
    // Drop any optimistic overlays - the board is about to be wiped.
    pendingUpgradesRef.current.clear()
    pendingPlacementsRef.current = []
    try {
      await ensureHighscore()
      const tx = await program.methods
        .resetBoard()
        .accountsPartial({
          board: boardPDA,
          pool: poolPda,
          feeWallet: FEE_WALLET,
          signer: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction()
      await sendMain(tx)
      // Fetch the freshly-reset account directly and snap the whole local model
      // to it. We DON'T rely solely on the subscription/refresh + tick-compare:
      // if the previous confirmed tick was already 0, that path would merge
      // instead of snap and old entities could linger. Clearing the buffer +
      // playback refs here and applying the fetched tick-0 board guarantees a
      // clean slate. The awaitingReset guard stays armed until applyConfirmed
      // sees this tick-0 board (forceSnap), so any lagging pre-reset update is
      // still dropped.
      const fresh = await program.account.board.fetch(boardPDA)
      confirmedBufRef.current = []
      latestRef.current = null
      playbackTickRef.current = 0
      ceilingTickRef.current = 0
      lastFrameRef.current = 0
      confirmedAtRef.current = performance.now()
      setHasBoard(true)
      applyConfirmed(fromChain(fresh))
    } catch (e) {
      // Reset never landed: disarm the guard so we don't ignore real updates.
      awaitingResetRef.current = false
      reportError("Reset game failed", e)
    } finally {
      setBusy(false)
    }
  }, [publicKey, boardPDA, sendMain, applyConfirmed, reportError])

  // Build the compute-budget + advance_game instructions used to SETTLE the
  // chain up to the client's playback tick before a spend. The client predicts
  // ahead of confirmation (kills -> gold), but the program only knows gold from
  // ticks it has actually simulated. So a build/upgrade bundles an advance_game
  // FIRST (same tx) to confirm those pending kills, then spends against the
  // now-correct gold. Returns [] when there's nothing to settle (predicted is
  // not ahead of confirmed) so we don't waste CU. `settleSigner` is whoever
  // signs the tx (session key or main wallet).
  const buildSettleIxs = useCallback(
    async (settleSigner: PublicKey, sessionToken: PublicKey | null) => {
      const conf = latestRef.current
      const play = Math.floor(playbackTickRef.current)
      if (!conf || play <= conf.currentTick) return []
      // Request enough ticks to reach the current playback tick PLUS a small
      // look-ahead buffer. Without the buffer the settle confirms at exactly the
      // tick we were on when clicking, but the network round-trip lets local
      // playback move on, so the confirmed board arrives BEHIND playback and the
      // render loop would clamp backwards (a tiny "stuck" hitch). The buffer
      // makes the confirmed tick land at ~where playback will be by the time the
      // tx confirms, so it's a clean forward step. The program still caps actual
      // applied ticks by its own real-time budget, so this can't fast-forward
      // past real time. Capped at MAX slice.
      const needed = Math.min(
        play - conf.currentTick + SETTLE_LOOKAHEAD_TICKS,
        MAX_TICKS_PER_SLICE
      )
      const counter = advanceCounterRef.current++ % 65535
      const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
      })
      const advanceIx = await program.methods
        .advanceGame(needed, counter)
        .accountsPartial({
          sessionToken,
          board: boardPDA!,
          highscore: highscorePda,
          authority: publicKey!,
          signer: settleSigner,
        })
        .instruction()
      return [computeIx, advanceIx]
    },
    [boardPDA, publicKey]
  )

  const placeTower = useCallback(
    async (x: number, y: number, kind: number = selectedKind) => {
      if (!publicKey || !boardPDA) return
      const def = towerDef(kind)
      if (!def) {
        notify("Unknown tower type.")
        return
      }
      // Guards mirror the program but against the PREDICTED board, since the
      // bundled advance_game will settle the chain up to that state first, so
      // the predicted gold is what the build will actually be able to spend.
      const board = predictedRef.current ?? confirmedRef.current
      if (board) {
        if (board.towerCount >= MAX_TOWERS) {
          notify("Tower limit reached — you can't build any more towers.")
          return
        }
        if (board.gold < def.cost) {
          notify(
            `Not enough gold to build (need ${def.cost}, have ${board.gold}). Kill enemies to earn more.`
          )
          return
        }
      }
      // Optimistic: show the greyed-out "building" tower immediately (removed in
      // `finally` if the send fails; GC'd once the confirmed board carries it).
      pendingPlacementsRef.current = [
        ...pendingPlacementsRef.current.filter((p) => p.x !== x || p.y !== y),
        { x, y, kind },
      ]
      let placed = false
      setBusy(true)
      try {
        const hasSession =
          sessionWallet && sessionWallet.sessionToken && sessionWallet.publicKey
        if (hasSession) {
          // Session path: the ephemeral key signs for the board authority, so
          // no wallet popup. Verify it's still valid first.
          if (!(await sessionTokenValid(sessionWallet.sessionToken as string))) {
            handleSessionInvalid()
            return
          }
          const settleIxs = await buildSettleIxs(
            sessionWallet.publicKey!,
            sessionWallet.sessionToken as unknown as PublicKey
          )
          const tx = await program.methods
            .placeTower(x, y, kind)
            .accountsPartial({
              sessionToken: sessionWallet.sessionToken,
              board: boardPDA,
              authority: publicKey,
              signer: sessionWallet.publicKey!,
            })
            .preInstructions(settleIxs)
            .transaction()
          await sessionWallet.signAndSendTransaction!(tx)
        } else {
          const settleIxs = await buildSettleIxs(publicKey, null)
          const tx = await program.methods
            .placeTower(x, y, kind)
            .accountsPartial({
              sessionToken: null,
              board: boardPDA,
              authority: publicKey,
              signer: publicKey,
            })
            .preInstructions(settleIxs)
            .transaction()
          await sendMain(tx)
        }
        await refresh()
        placed = true
      } catch (e) {
        if (isSessionError(e)) {
          handleSessionInvalid()
        } else {
          reportError("Place tower failed", e)
        }
      } finally {
        setBusy(false)
        // If the send failed, drop the optimistic ghost so it doesn't linger.
        // On success we keep it: it's GC'd automatically once the confirmed
        // board carries the real tower (avoids a flicker in between).
        if (!placed) {
          pendingPlacementsRef.current = pendingPlacementsRef.current.filter(
            (p) => p.x !== x || p.y !== y
          )
        }
      }
    },
    [
      publicKey,
      boardPDA,
      selectedKind,
      sessionWallet,
      sendMain,
      refresh,
      reportError,
      notify,
      confirmedRef,
      buildSettleIxs,
      sessionTokenValid,
      handleSessionInvalid,
      isSessionError,
    ]
  )

  const upgradeTower = useCallback(
    async (towerIndex: number) => {
      if (!publicKey || !boardPDA) return
      // The upgrade targets a tower SLOT INDEX on-chain, so the index must exist
      // on the CONFIRMED board (chain truth). A stale confirmed board (e.g. after
      // a reset/redeploy the account had fewer towers than what we last rendered)
      // would otherwise send an index the program rejects with InvalidTower. If
      // it looks out of range, re-fetch and bail rather than send a doomed tx.
      const chain = confirmedRef.current
      if (
        !chain ||
        towerIndex < 0 ||
        towerIndex >= chain.towerCount ||
        chain.towers[towerIndex]?.kind === 0
      ) {
        notify("That tower isn't on-chain yet — try again in a moment.")
        await refresh()
        return
      }
      // Guards mirror the program but against the PREDICTED board (see
      // placeTower) since the bundled advance_game settles the chain first.
      const board = predictedRef.current ?? confirmedRef.current
      if (board) {
        const tower = board.towers[towerIndex]
        // Still finishing its INITIAL build (not yet armed) - can't upgrade a
        // tower that isn't even active. pendingLevel === 0 distinguishes this
        // from an in-progress upgrade (handled below).
        if (
          tower &&
          tower.pendingLevel === 0 &&
          board.currentTick < tower.readyAtTick
        ) {
          notify("This tower is still building — wait until it's active.")
          return
        }
        if (tower && tower.pendingLevel !== 0) {
          notify("This tower is already being upgraded.")
          return
        }
        if (tower && tower.level >= TOWER_MAX_LEVEL) {
          notify(`This tower is already at max level (${TOWER_MAX_LEVEL}).`)
          return
        }
        // Upgrade cost is per tower KIND (basic/splash/slow differ) - read it
        // from that tower's balance row so the client check matches what the
        // program actually charges (tower_def(kind).upgrade_cost).
        const upgradeCost = tower ? towerDef(tower.kind)?.upgradeCost ?? 0 : 0
        if (board.gold < upgradeCost) {
          notify(
            `Not enough gold to upgrade (need ${upgradeCost}, have ${board.gold}). Kill enemies to earn more.`
          )
          return
        }
      }
      // Mark this tower as having an in-flight upgrade so the cyan bar APPEARS
      // immediately (pinned at 0%). It only starts FILLING once the program
      // responds with the real start tick. Cleared in `finally`.
      pendingUpgradesRef.current.add(towerIndex)
      setBusy(true)
      try {
        const hasSession =
          sessionWallet && sessionWallet.sessionToken && sessionWallet.publicKey
        if (hasSession) {
          if (!(await sessionTokenValid(sessionWallet.sessionToken as string))) {
            handleSessionInvalid()
            return
          }
          const settleIxs = await buildSettleIxs(
            sessionWallet.publicKey!,
            sessionWallet.sessionToken as unknown as PublicKey
          )
          const tx = await program.methods
            .upgradeTower(towerIndex)
            .accountsPartial({
              sessionToken: sessionWallet.sessionToken,
              board: boardPDA,
              authority: publicKey,
              signer: sessionWallet.publicKey!,
            })
            .preInstructions(settleIxs)
            .transaction()
          await sessionWallet.signAndSendTransaction!(tx)
        } else {
          const settleIxs = await buildSettleIxs(publicKey, null)
          const tx = await program.methods
            .upgradeTower(towerIndex)
            .accountsPartial({
              sessionToken: null,
              board: boardPDA,
              authority: publicKey,
              signer: publicKey,
            })
            .preInstructions(settleIxs)
            .transaction()
          await sendMain(tx)
        }
        await refresh()
        // NOTE: do NOT clear the overlay here. The confirmed board's upgrade
        // tick can be AHEAD of current playback (the settle looks ahead), so the
        // render anchor may still be a pre-upgrade board for a moment. If we drop
        // the overlay now the cyan bar vanishes until playback catches up. The
        // overlay is a no-op once a board actually carries the pending upgrade
        // (its guard checks pendingLevel === 0), and the render loop garbage-
        // collects the entry once the CONFIRMED tower shows the upgrade - so the
        // bar hands off seamlessly from optimistic to real.
      } catch (e) {
        if (isSessionError(e)) {
          handleSessionInvalid()
        } else {
          reportError("Upgrade tower failed", e)
        }
        // Failed: nothing landed on-chain, so remove the optimistic bar now.
        pendingUpgradesRef.current.delete(towerIndex)
      } finally {
        setBusy(false)
      }
    },
    [
      publicKey,
      boardPDA,
      sessionWallet,
      sendMain,
      refresh,
      reportError,
      notify,
      confirmedRef,
      buildSettleIxs,
      sessionTokenValid,
      handleSessionInvalid,
      isSessionError,
    ]
  )

  // Send ONE advance_game slice and refresh. Returns the confirmed tick after
  // the refresh, or null on failure. On a dense board the program applies FEWER
  // than the requested ticks (it stops before it would exceed the CU budget),
  // so one call may not fully catch up - see the drain loop in `advance`.
  const advanceOnce = useCallback(async (): Promise<number | null> => {
    if (!publicKey || !boardPDA) return null
    const counter = advanceCounterRef.current++ % 65535
    // The tick loop (up to MAX_TICKS_PER_SLICE ticks over towers x units) can
    // exceed the default 200k CU budget, so request the max (1.4M). The program
    // also self-limits ticks to stay under this ceiling.
    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    })
    const hasSession =
      sessionWallet && sessionWallet.sessionToken && sessionWallet.publicKey
    if (hasSession) {
      // Bail out before sending if the session already lapsed - avoids a
      // guaranteed on-chain failure and lets the player renew.
      if (!(await sessionTokenValid(sessionWallet.sessionToken as string))) {
        handleSessionInvalid()
        return null
      }
      const tx = await program.methods
        .advanceGame(MAX_TICKS_PER_SLICE, counter)
        .accountsPartial({
          sessionToken: sessionWallet.sessionToken,
          board: boardPDA,
          highscore: highscorePda,
          authority: publicKey,
          signer: sessionWallet.publicKey!,
        })
        .preInstructions([computeIx])
        .transaction()
      await sessionWallet.signAndSendTransaction!(tx)
    } else {
      const tx = await program.methods
        .advanceGame(MAX_TICKS_PER_SLICE, counter)
        .accountsPartial({
          sessionToken: null,
          board: boardPDA,
          highscore: highscorePda,
          authority: publicKey,
          signer: publicKey,
        })
        .preInstructions([computeIx])
        .transaction()
      const sig = await sendMain(tx)
      console.log("advance_game tx", sig)
    }
    await refresh()
    return confirmedRef.current?.currentTick ?? null
  }, [
    publicKey,
    boardPDA,
    sessionWallet,
    sendMain,
    refresh,
    sessionTokenValid,
    handleSessionInvalid,
  ])

  // Advance the sim. Prefers the session key (so it can run in a background loop
  // without wallet popups); falls back to the main wallet.
  //
  // A single advance_game may apply fewer ticks than requested when the board is
  // dense (the program stops short of the CU cap). To keep the chain caught up
  // with the (real-time-bounded) client playback, we DRAIN: keep sending slices
  // until either the chain reaches the client's target tick, a slice makes no
  // forward progress, or we hit a safety cap on iterations. Each slice is still
  // individually bounded by the program's real-time budget, so this never
  // fast-forwards past real time.
  const advance = useCallback(async () => {
    if (!publicKey || !boardPDA) return
    if (advancingRef.current) return
    // The chain rejects advance_game once lives hit 0 (GameOver). Stop here so
    // we don't spam failing transactions; also switch off any auto-run loop.
    if (confirmedRef.current && confirmedRef.current.lives <= 0) {
      setAutoAdvance(false)
      return
    }
    advancingRef.current = true
    setAdvancing(true)
    // Target: where the client would like the chain to be (floor of playback).
    // The chain caps itself to real time regardless, so this is just an upper
    // bound on how hard we try to drain in one invocation.
    const target = Math.floor(playbackTickRef.current)
    // Safety cap: at most this many slices per invocation so a pathological
    // board can't wedge the loop. One slice = up to MAX_TICKS_PER_SLICE ticks.
    const MAX_DRAIN_SLICES = 6
    try {
      let iterations = 0
      while (iterations < MAX_DRAIN_SLICES) {
        iterations++
        const before = confirmedRef.current?.currentTick ?? 0
        const after = await advanceOnce()
        if (after == null) break // failure / session bail - stop draining
        // Stop if we're game over, caught up to the client target, or the slice
        // made no forward progress (nothing left to apply / no time budget).
        if ((confirmedRef.current?.lives ?? 1) <= 0) break
        if (after >= target) break
        if (after <= before) break
      }
    } catch (e: any) {
      if (isSessionError(e)) {
        handleSessionInvalid()
      } else if (!autoAdvance) {
        // Only surface a toast for a manual advance; the auto-run loop spams.
        reportError("Advance failed", e)
      } else {
        console.warn("advance_game failed:", e?.message ?? e)
      }
    } finally {
      advancingRef.current = false
      setAdvancing(false)
    }
  }, [
    publicKey,
    boardPDA,
    advanceOnce,
    autoAdvance,
    reportError,
    handleSessionInvalid,
    isSessionError,
  ])

  // Stop auto-run as soon as the confirmed board is game over.
  useEffect(() => {
    if (confirmed && confirmed.lives <= 0 && autoAdvance) {
      setAutoAdvance(false)
    }
  }, [confirmed, autoAdvance])

  // Commit game-over on-chain. The losing leak first shows up in the local
  // prediction; the chain only reflects it once an advance_game carries the sim
  // past that tick. When the client predicts game over but the confirmed board
  // still has lives, keep firing advance (retrying if a single drain stops
  // short of the losing tick) until the chain reflects the loss - so the
  // on-chain state, and anything reading it, matches what the player sees. A
  // short throttle avoids spamming while an advance is in flight.
  const lastGameOverPushRef = useRef(0)
  useEffect(() => {
    const predictedOver = predicted != null && predicted.lives <= 0
    const confirmedOver = confirmed != null && confirmed.lives <= 0
    // Once the chain reflects the loss (or there's no loss at all) there's
    // nothing to push.
    if (confirmedOver || !predictedOver) return
    const now = Date.now()
    // Throttle retries: advance() no-ops while one is already draining, and a
    // dense end-game may need several slices, so retry at a modest cadence.
    if (now - lastGameOverPushRef.current < 1500) return
    lastGameOverPushRef.current = now
    advance()
  }, [predicted, confirmed, advance])

  // Load the highscore + jackpot once a wallet is connected (and refresh it
  // periodically so the leaderboard/jackpot stay live while others play).
  useEffect(() => {
    refreshHighscore()
    const id = setInterval(refreshHighscore, 30_000)
    return () => clearInterval(id)
  }, [refreshHighscore])

  // Live jackpot via websocket: subscribe to the pool PDA and update the
  // displayed jackpot the instant its lamports change (anyone paying an entry
  // fee, or a payout draining it), instead of waiting for the 30s poll. The
  // subscription hands us the account's lamports directly, so we derive the
  // spendable amount (balance minus the zero-data rent reserve) without an
  // extra RPC round-trip.
  useEffect(() => {
    let cancelled = false
    let sub: number | null = null
    let reserve = 0

    const applyBalance = (lamports: number) => {
      setJackpotSol(Math.max(0, (lamports - reserve) / 1e9))
    }

    connection
      .getMinimumBalanceForRentExemption(0)
      .then((r) => {
        if (cancelled) return
        reserve = r
        // Subscribe for live updates. onAccountChange fires on the next block
        // that touches the account, giving near-instant jackpot updates.
        sub = connection.onAccountChange(poolPda, (account) => {
          applyBalance(account.lamports)
        })
        // Seed the value immediately from the current on-chain balance so we
        // don't wait for the first change event.
        connection
          .getBalance(poolPda)
          .then((bal) => {
            if (!cancelled) applyBalance(bal)
          })
          .catch(() => {})
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (sub !== null) connection.removeAccountChangeListener(sub)
    }
  }, [connection])

  // The final score is recorded ON-CHAIN automatically inside advance_game the
  // tick lives hit 0 (no separate submit tx). Once the CONFIRMED board shows
  // game over we just refresh the leaderboard to reflect the new entry. Guarded
  // so we only refresh once per game (re-armed when a fresh game starts).
  const scoredGameOverRef = useRef(false)
  useEffect(() => {
    if (!confirmed) return
    if (confirmed.lives > 0) {
      scoredGameOverRef.current = false // fresh/ongoing game
      return
    }
    if (scoredGameOverRef.current) return
    scoredGameOverRef.current = true
    refreshHighscore()
  }, [confirmed, refreshHighscore])

  // Auto-advance loop: while enabled and a session exists, push the sim forward
  // on an interval so the game runs itself. The on-chain time cap keeps it from
  // fast-forwarding faster than real time.
  useEffect(() => {
    if (!autoAdvance) return
    const id = setInterval(() => {
      advance()
    }, 1000)
    return () => clearInterval(id)
  }, [autoAdvance, advance])

  const value = useMemo<TowerDefenseContextValue>(
    () => ({
      boardPDA,
      confirmed,
      predicted,
      hasBoard,
      boardExists,
      autoAdvance,
      setAutoAdvance,
      selectedKind,
      setSelectedKind,
      busy,
      advancing,
      initBoard,
      resetBoard,
      placeTower,
      upgradeTower,
      advance,
      refresh,
      highscore,
      jackpotSol,
      refreshHighscore,
      payoutHighscore,
    }),
    [
      boardPDA,
      confirmed,
      predicted,
      hasBoard,
      boardExists,
      autoAdvance,
      selectedKind,
      busy,
      advancing,
      initBoard,
      resetBoard,
      placeTower,
      upgradeTower,
      advance,
      refresh,
      highscore,
      jackpotSol,
      refreshHighscore,
      payoutHighscore,
    ]
  )

  return (
    <TowerDefenseContext.Provider value={value}>
      {children}
    </TowerDefenseContext.Provider>
  )
}

export default TowerDefenseProvider
