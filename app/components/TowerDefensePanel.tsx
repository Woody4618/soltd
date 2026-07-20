import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  HStack,
  List,
  ListItem,
  SimpleGrid,
  Switch,
  Text,
  VStack,
} from "@chakra-ui/react"
import { useWallet } from "@solana/wallet-adapter-react"
import { useSessionWallet } from "@magicblock-labs/gum-react-sdk"
import { useTowerDefense } from "@/contexts/TowerDefenseProvider"
import {
  TOWER_BASIC_COST,
  TOWER_DEFS,
  TOWER_KIND_BASIC,
  TOWER_KIND_SPLASH,
  TOWER_KIND_SLOW,
} from "@/utils/anchor"

// Build-menu entries. Costs come from the generated TOWER_DEFS table so they
// can't drift from the program. `accent` matches the on-board tower colour.
const TOWER_MENU = [
  {
    kind: TOWER_KIND_BASIC,
    name: "Basic",
    desc: "Single target, long range",
    accent: "#4dabf7",
  },
  {
    kind: TOWER_KIND_SPLASH,
    name: "Splash",
    desc: "AoE — hits nearby enemies",
    accent: "#ff922b",
  },
  {
    kind: TOWER_KIND_SLOW,
    name: "Slow",
    desc: "Chills enemies in range — they crawl",
    accent: "#4dd4c0",
  },
]

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
  } = useTowerDefense()

  if (!publicKey) return null

  const hasSession = !!(sessionWallet && sessionWallet.sessionToken)
  // Game-over gates the auto-run switch. Follows the predicted playback board,
  // falling back to confirmed until the first predicted frame exists.
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

  return (
    <VStack
      spacing={3}
      align="stretch"
      w="240px"
      p={3}
      bg="#151822"
      border="1px solid #2b2f3a"
      borderRadius="md"
    >
      {/* How to build/upgrade now that the buttons are gone. */}
      <Box>
        <Text fontSize="sm" fontWeight="bold" mb={1}>
          Build &amp; upgrade
        </Text>
        <Text fontSize="xs" color="gray.400">
          <b>Click an empty tile</b> to open the build ring, then pick a tower.
          <b> Click a placed tower</b> to upgrade it (cost depends on type).
        </Text>
        <SimpleGrid columns={1} spacing={1} mt={2}>
          {TOWER_MENU.map((m) => {
            const cost = TOWER_DEFS[m.kind - 1]?.cost ?? 0
            return (
              <HStack key={m.kind} spacing={2} fontSize="xs">
                <Box
                  w="10px"
                  h="10px"
                  borderRadius="sm"
                  bg={m.accent}
                  flexShrink={0}
                />
                <Text fontWeight="bold" color={m.accent} minW="42px">
                  {m.name}
                </Text>
                <Text color="gray.400" flex={1}>
                  {m.desc}
                </Text>
                <Text color="gray.300">{cost}g</Text>
              </HStack>
            )
          })}
        </SimpleGrid>
      </Box>

      {/* Advance / auto-run controls */}
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
        <Text fontSize="xs" color="gray.400" mt={0.5}>
          {hasSession
            ? "Hands-free play — the game advances itself."
            : "Create a session above for hands-free play, or use the green Advance button in the stats bar to advance manually."}
        </Text>
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
                <b>Build towers:</b> click any empty (dark) tile to open the{" "}
                <b>build ring</b>, then pick a tower. <b>Basic</b> (
                {TOWER_BASIC_COST}g) is a long-range single-target shooter;{" "}
                <b>Splash</b> hits every enemy near its target — great for
                clustered waves;{" "}
                <b style={{ color: "#4dd4c0" }}>Slow</b> (
                {TOWER_DEFS[TOWER_KIND_SLOW - 1]?.cost}g) sprays a chilling mist
                that makes every enemy in range crawl — deals little damage
                itself, so pair it with a shooter at a chokepoint. You can’t
                build on the orange <b>path</b> tiles.
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
                <b>Enemy types:</b> <b style={{ color: "#ff8787" }}>Normal</b>{" "}
                (balanced), <b style={{ color: "#ffd43b" }}>Fast</b> (small,
                quick — hard to hit), <b style={{ color: "#9775fa" }}>Strong</b>{" "}
                (tanky, slow, pays more), and a{" "}
                <b style={{ color: "#f03e3e" }}>Boss</b> (gold ring) every 5th
                wave — huge HP and a big bounty.
              </ListItem>
              <ListItem>
                <b>Advance:</b> flip on <b>Auto-run</b> (needs a session), or
                use the green <b>Advance</b> button in the stats bar to push the
                game forward (it pulses when time has stalled). Time only moves
                when you advance.
              </ListItem>
              <ListItem>
                Kill enemies for <b>gold</b> and <b>kills</b>; spend gold on more
                towers, or <b>click an existing tower to upgrade</b> it for more
                damage and range. Upgrades take ~3s to install (cyan bar) — the
                tower keeps firing at its current power until they land.
              </ListItem>
              <ListItem>
                Every enemy that reaches the red end costs a <b>life</b>. Hit 0
                and it’s <b>game over</b> — a summary pops up with a{" "}
                <b>Start New Game</b> button (you can also <b>Reset game</b> any
                time).
              </ListItem>
            </List>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </VStack>
  )
}

export default TowerDefensePanel
