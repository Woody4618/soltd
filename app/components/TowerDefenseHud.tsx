import { useEffect, useRef, useState } from "react"
import {
  Badge,
  Box,
  Button,
  HStack,
  Image,
  Spinner,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react"
import { useTowerDefense } from "@/contexts/TowerDefenseProvider"

// A single stat cell: pixel icon + label on top, big value below.
const StatCell = ({
  icon,
  label,
  value,
  color,
}: {
  icon: string
  label: string
  value: React.ReactNode
  color?: string
}) => (
  <VStack spacing={0} minW="52px">
    <HStack spacing={1} opacity={0.75}>
      <Image
        src={icon}
        alt={label}
        boxSize="14px"
        sx={{ imageRendering: "pixelated" }}
      />
      <Text fontSize="10px" textTransform="uppercase" letterSpacing="0.5px">
        {label}
      </Text>
    </HStack>
    <Text fontSize="xl" fontWeight="bold" lineHeight={1.1} color={color}>
      {value}
    </Text>
  </VStack>
)

// Compact heads-up display shown directly ABOVE the board: lives / gold / kills
// / wave, plus the tick counter with an inline green "advance" arrow that only
// appears when the simulation has stopped progressing (so the player can nudge
// the chain forward). Replaces the old stat grid + "Advance now" button.
const TowerDefenseHud = () => {
  const {
    predicted,
    confirmed,
    hasBoard,
    advance,
    advancing,
    autoAdvance,
    setGameOverDismissed,
  } = useTowerDefense()

  const view = predicted ?? confirmed
  const stats = predicted ?? confirmed
  const gameOver = stats != null && stats.lives <= 0

  // "Ticks no longer progressing": watch the rendered tick and flip `stalled`
  // true once it hasn't advanced for a short window. Auto-run drives it forward
  // on its own, so we don't show the manual arrow while auto-run is on.
  const [stalled, setStalled] = useState(false)
  const lastTickRef = useRef<number | null>(null)
  const lastChangeRef = useRef<number>(performance.now())
  useEffect(() => {
    let raf: number
    const STALL_MS = 500
    const tick = () => {
      const t = view?.currentTick ?? null
      const now = performance.now()
      if (t !== lastTickRef.current) {
        lastTickRef.current = t
        lastChangeRef.current = now
        if (stalled) setStalled(false)
      } else if (!stalled && now - lastChangeRef.current >= STALL_MS) {
        setStalled(true)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [view, stalled])

  if (!hasBoard || !view) return null

  const nextWaveSecs =
    view.currentTick < view.nextWaveTick
      ? Math.max(0, Math.ceil((view.nextWaveTick - view.currentTick) / 10))
      : 0

  // There's a backlog when the client's playback (predicted) has run AHEAD of
  // the confirmed on-chain tick - a transaction would push the chain forward.
  const backlog =
    predicted != null &&
    confirmed != null &&
    predicted.currentTick > confirmed.currentTick

  // The button is only USEFUL when playback has STALLED with a backlog: during
  // smooth playback the free-running clock keeps rendering ahead on its own, so
  // there's nothing the player needs to do. It's the moment playback hits its
  // real-time ceiling and can't proceed without a chain push that we surface it
  // (plus while an advance is already in flight, so the spinner stays put).
  // Suppressed on game over and while auto-run drives the chain itself.
  const needsPush = backlog && stalled
  const showAdvance = (needsPush || advancing) && !gameOver && !autoAdvance
  const needsAttention = needsPush && !advancing

  return (
    <HStack
      w="100%"
      justify="space-between"
      align="center"
      bg="#151822"
      border="1px solid #2b2f3a"
      borderRadius="md"
      px={3}
      py={2}
      spacing={3}
    >
      <StatCell
        icon="/assets/sprites/icon-heart.png"
        label="Lives"
        value={stats?.lives ?? "-"}
        color={stats && stats.lives <= 3 ? "#ff8787" : "white"}
      />
      <StatCell
        icon="/assets/sprites/icon-coin.png"
        label="Gold"
        value={stats?.gold ?? "-"}
        color="#ffd43b"
      />
      <StatCell
        icon="/assets/sprites/icon-trophy.png"
        label="Kills"
        value={stats?.kills ?? "-"}
      />

      {/* Tick counter */}
      <VStack spacing={0} minW="56px">
        <Text fontSize="10px" textTransform="uppercase" letterSpacing="0.5px" opacity={0.75}>
          Tick
        </Text>
        <Text fontSize="xl" fontWeight="bold" lineHeight={1.1}>
          {view.currentTick}
        </Text>
      </VStack>

      {/* Wave / next-wave */}
      <VStack spacing={0} minW="64px" align="flex-start">
        <Text fontSize="10px" textTransform="uppercase" letterSpacing="0.5px" opacity={0.75}>
          Wave {view.waveNumber}
        </Text>
        {gameOver ? (
          <Tooltip label="View run summary" hasArrow openDelay={300}>
            <Badge
              as="button"
              type="button"
              colorScheme="red"
              fontSize="sm"
              cursor="pointer"
              onClick={() => setGameOverDismissed(false)}
              _hover={{ opacity: 0.85 }}
            >
              Game over
            </Badge>
          </Tooltip>
        ) : (
          <Text fontSize="sm" color="gray.300">
            {view.currentTick >= view.nextWaveTick
              ? "incoming…"
              : `next ${nextWaveSecs}s`}
          </Text>
        )}
      </VStack>

      {/* Prominent Advance button with spinner-while-working. */}
      {showAdvance && (
        <Tooltip
          label={needsAttention ? "Time is stalled — advance the game" : "Advance the game"}
          hasArrow
          openDelay={300}
        >
          <Button
            onClick={() => advance()}
            isLoading={advancing}
            loadingText="Advancing"
            spinner={<Spinner size="sm" />}
            size="sm"
            colorScheme="green"
            leftIcon={advancing ? undefined : <ArrowGlyph />}
            fontWeight="bold"
            px={3}
            boxShadow={needsAttention ? "0 0 0 0 rgba(81,207,102,0.7)" : undefined}
            sx={
              needsAttention
                ? { animation: "tdAdvancePulse 1.2s ease-in-out infinite" }
                : undefined
            }
          >
            Advance
          </Button>
        </Tooltip>
      )}

      {/* Keyframes for the attention-pulse (scoped, injected once). */}
      <style jsx global>{`
        @keyframes tdAdvancePulse {
          0% {
            box-shadow: 0 0 0 0 rgba(81, 207, 102, 0.6);
          }
          70% {
            box-shadow: 0 0 0 10px rgba(81, 207, 102, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(81, 207, 102, 0);
          }
        }
      `}</style>
    </HStack>
  )
}

// A right-pointing play/advance triangle drawn as inline SVG so it scales with
// the surrounding text colour.
const ArrowGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path d="M5 3.5 L16 10 L5 16.5 Z" />
  </svg>
)

export default TowerDefenseHud
