import { useEffect, useState } from "react"
import {
  Button,
  HStack,
  Image,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  VStack,
} from "@chakra-ui/react"
import { useTowerDefense } from "@/contexts/TowerDefenseProvider"
import { ENTRY_FEE_SOL } from "@/utils/anchor"

// A summary stat row inside the modal (icon + label + value).
const SummaryRow = ({
  icon,
  label,
  value,
}: {
  icon?: string
  label: string
  value: React.ReactNode
}) => (
  <HStack w="100%" justify="space-between">
    <HStack spacing={2} color="gray.300">
      {icon && (
        <Image
          src={icon}
          alt=""
          boxSize="18px"
          sx={{ imageRendering: "pixelated" }}
        />
      )}
      <Text fontSize="sm">{label}</Text>
    </HStack>
    <Text fontSize="lg" fontWeight="bold">
      {value}
    </Text>
  </HStack>
)

// Game-over overlay. Deliberately translucent (low-opacity backdrop + slightly
// see-through card) so the final board state stays visible behind it. Shows a
// run summary and a Start New Game button that resets the board.
const TowerDefenseGameOverModal = () => {
  const { confirmed, predicted, hasBoard, busy, resetBoard } = useTowerDefense()

  // Trigger the popup as soon as EITHER the confirmed OR the predicted
  // (played-ahead) board hits 0 lives. The killing leak may only be reflected
  // in the local prediction until the player advances the chain, so keying
  // purely off `confirmed` could hide the popup indefinitely.
  const confirmedOver = confirmed != null && confirmed.lives <= 0
  const predictedOver = predicted != null && predicted.lives <= 0
  const isGameOver = hasBoard && (confirmedOver || predictedOver)

  // For the summary numbers, use whichever board actually reached game over
  // (prefer confirmed once it has committed the loss).
  const board = confirmedOver ? confirmed : predictedOver ? predicted : confirmed

  // Let the player dismiss the popup to inspect the final board. We reopen it
  // automatically on each NEW game-over (edge-triggered): dismiss is cleared
  // whenever the game is no longer over, so the next loss shows it again.
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (!isGameOver) setDismissed(false)
  }, [isGameOver])

  // Seconds of game time survived (10 ticks = 1s).
  const seconds = board ? Math.floor(board.currentTick / 10) : 0
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0")
  const ss = String(seconds % 60).padStart(2, "0")

  // Small floating chip to reopen the summary after it's been dismissed.
  if (isGameOver && dismissed) {
    return (
      <Button
        position="fixed"
        bottom={4}
        right={4}
        zIndex={20}
        size="sm"
        colorScheme="red"
        variant="solid"
        boxShadow="0 4px 16px rgba(0,0,0,0.5)"
        onClick={() => setDismissed(false)}
      >
        Game over — view summary
      </Button>
    )
  }

  return (
    <Modal
      isOpen={isGameOver && !dismissed}
      onClose={() => setDismissed(true)}
      isCentered
      closeOnOverlayClick
      closeOnEsc
    >
      {/* Light backdrop so the board is still readable behind the popup. */}
      <ModalOverlay bg="blackAlpha.400" backdropFilter="blur(1px)" />
      <ModalContent
        bg="rgba(21, 24, 34, 0.92)"
        border="1px solid #2b2f3a"
        color="gray.100"
        boxShadow="0 12px 40px rgba(0,0,0,0.6)"
      >
        <ModalHeader
          textAlign="center"
          fontSize="2xl"
          color="#ff6b6b"
          pb={1}
        >
          Game Over
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Text textAlign="center" fontSize="sm" color="gray.400" mb={4}>
            Your garden was overrun. Here’s how the run went:
          </Text>
          <VStack
            spacing={2}
            align="stretch"
            bg="rgba(15, 17, 23, 0.6)"
            borderRadius="md"
            p={3}
          >
            <SummaryRow
              label="Waves survived"
              value={board ? board.waveNumber : 0}
            />
            <SummaryRow
              icon="/assets/sprites/icon-trophy.png"
              label="Enemies slain"
              value={board?.kills ?? 0}
            />
            <SummaryRow
              icon="/assets/sprites/icon-coin.png"
              label="Gold banked"
              value={board?.gold ?? 0}
            />
            <SummaryRow label="Time survived" value={`${mm}:${ss}`} />
          </VStack>
        </ModalBody>
        <ModalFooter justifyContent="center">
          <Button
            colorScheme="green"
            size="lg"
            fontWeight="bold"
            isLoading={busy}
            loadingText="Starting…"
            onClick={() => resetBoard()}
          >
            Start New Game ({ENTRY_FEE_SOL} SOL)
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default TowerDefenseGameOverModal
