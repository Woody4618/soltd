import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Badge,
  Box,
  Button,
  HStack,
  List,
  ListItem,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Switch,
  Text,
  VStack,
} from "@chakra-ui/react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useSessionWallet } from "@magicblock-labs/gum-react-sdk"
import { useTowerDefense } from "@/contexts/TowerDefenseProvider"
import { TOWER_BASIC_COST, TOWER_UPGRADE_COST } from "@/utils/anchor"

const TowerDefensePanel = () => {
  const { publicKey } = useWallet()
  const sessionWallet = useSessionWallet()
  const {
    predicted,
    confirmed,
    hasBoard,
    boardExists,
    busy,
    autoAdvance,
    setAutoAdvance,
    initBoard,
    resetBoard,
    advance,
  } = useTowerDefense()

  if (!publicKey) return null

  const hasSession = !!(sessionWallet && sessionWallet.sessionToken)
  // Both readouts follow the PREDICTED playback board. Predicted gold is now
  // truly spendable: a build/upgrade bundles an advance_game that settles the
  // chain up to the playback tick first, so pending kills (and their gold) are
  // confirmed before the spend is checked. Falls back to confirmed until the
  // first predicted frame exists.
  const view = predicted ?? confirmed
  const stats = predicted ?? confirmed
  const gameOver = stats != null && stats.lives <= 0

  if (!hasBoard) {
    // The account exists on-chain but our decoder can't read it - almost always
    // an older board layout from a previous program version. Reset migrates it
    // (via realloc) to the current layout instead of failing to re-init.
    if (boardExists) {
      return (
        <VStack spacing={3} maxW="280px">
          <Text textAlign="center" fontSize="sm">
            A board already exists for this wallet but is from an older version.
            Reset it to migrate to the latest layout and start fresh.
          </Text>
          <Button
            colorScheme="orange"
            isLoading={busy}
            onClick={() => resetBoard()}
          >
            Reset board
          </Button>
        </VStack>
      )
    }
    return (
      <VStack spacing={3}>
        <Text>No tower-defense board yet for this wallet.</Text>
        <Button colorScheme="green" isLoading={busy} onClick={() => initBoard()}>
          Create board
        </Button>
      </VStack>
    )
  }

  const nextWaveSecs =
    view && view.currentTick < view.nextWaveTick
      ? Math.max(0, Math.ceil((view.nextWaveTick - view.currentTick) / 10))
      : 0

  return (
    <VStack
      spacing={3}
      align="stretch"
      w="260px"
      p={3}
      bg="#151822"
      border="1px solid #2b2f3a"
      borderRadius="md"
    >
      <SimpleGrid columns={2} spacingX={3} spacingY={1}>
        <Stat size="sm">
          <StatLabel fontSize="xs">Lives</StatLabel>
          <StatNumber
            fontSize="xl"
            color={stats && stats.lives <= 3 ? "red.300" : "white"}
          >
            {stats?.lives ?? "-"}
          </StatNumber>
        </Stat>
        <Stat size="sm">
          <StatLabel fontSize="xs">Gold</StatLabel>
          <StatNumber fontSize="xl" color="yellow.300">
            {stats?.gold ?? "-"}
          </StatNumber>
        </Stat>
        <Stat size="sm">
          <StatLabel fontSize="xs">Kills</StatLabel>
          <StatNumber fontSize="xl">{stats?.kills ?? "-"}</StatNumber>
        </Stat>
        <Stat size="sm">
          <StatLabel fontSize="xs">Tick</StatLabel>
          <StatNumber fontSize="xl">{view?.currentTick ?? "-"}</StatNumber>
        </Stat>
      </SimpleGrid>

      {view && (
        <HStack
          justify="space-between"
          fontSize="xs"
          color="gray.300"
          bg="#1a1d27"
          px={2}
          py={1}
          borderRadius="sm"
        >
          <Text>
            Wave <b>{view.waveNumber}</b>
          </Text>
          <Text>
            {view.currentTick >= view.nextWaveTick
              ? "Wave incoming…"
              : `Next in ${nextWaveSecs}s`}
          </Text>
        </HStack>
      )}

      {gameOver && (
        <Badge colorScheme="red" fontSize="sm" py={1} textAlign="center">
          Game over
        </Badge>
      )}

      <Text fontSize="xs" color="gray.400">
        Click an empty tile to build a tower ({TOWER_BASIC_COST}g). Click one of
        your towers to upgrade it ({TOWER_UPGRADE_COST}g).
      </Text>

      {/* Advance controls */}
      <Box borderTop="1px solid #2b2f3a" pt={2}>
        <HStack justify="space-between">
          <Text fontSize="sm">Auto-run</Text>
          <Switch
            size="sm"
            isChecked={autoAdvance}
            isDisabled={!hasSession || gameOver}
            onChange={(e) => setAutoAdvance(e.target.checked)}
          />
        </HStack>
        {!hasSession && (
          <Text fontSize="xs" color="gray.400" mt={0.5}>
            Create a session above for hands-free play.
          </Text>
        )}
        <Button
          size="sm"
          mt={2}
          width="100%"
          isDisabled={gameOver}
          onClick={() => advance()}
        >
          Advance now
        </Button>
      </Box>

      <Button
        size="sm"
        colorScheme="red"
        variant="outline"
        isLoading={busy}
        onClick={() => resetBoard()}
      >
        Reset game
      </Button>

      <Accordion allowToggle>
        <AccordionItem border="none">
          <AccordionButton px={0} py={1} _hover={{ bg: "transparent" }}>
            <Text flex={1} textAlign="left" fontSize="sm" fontWeight="bold">
              How to play
            </Text>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel px={0} pb={2}>
            <List
              spacing={1}
              fontSize="xs"
              color="gray.300"
              styleType="decimal"
              pl={4}
            >
              <ListItem>
                (Optional) Click <b>Create session</b> up top so the game can
                advance itself without a wallet popup each tick.
              </ListItem>
              <ListItem>
                <b>Build towers:</b> click any empty (dark) tile to place a tower
                for {TOWER_BASIC_COST} gold. You can’t build on the orange{" "}
                <b>path</b> tiles.
              </ListItem>
              <ListItem>
                Towers take ~3s to build before they shoot, then fire at the enemy
                furthest along the path within range.
              </ListItem>
              <ListItem>
                <b>Waves are automatic:</b> escalating waves spawn on a cooldown —
                each stronger and worth more gold. Clear a wave early and the
                next one arrives after a short breather.
              </ListItem>
              <ListItem>
                <b>Advance:</b> flip on <b>Auto-run</b> (needs a session) or tap{" "}
                <b>Advance now</b>. Time only moves when you advance.
              </ListItem>
              <ListItem>
                Kill enemies for <b>gold</b> and <b>kills</b>; spend gold on more
                towers, or <b>click an existing tower to upgrade</b> it for more
                damage and range. Upgrades take ~3s to install (cyan bar) — the
                tower keeps firing at its current power until they land.
              </ListItem>
              <ListItem>
                Every enemy that reaches the red end costs a <b>life</b>. Hit 0 and
                it’s <b>game over</b> — press <b>Reset game</b>.
              </ListItem>
            </List>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </VStack>
  )
}

export default TowerDefensePanel
