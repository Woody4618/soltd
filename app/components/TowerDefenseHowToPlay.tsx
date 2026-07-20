import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  List,
  ListItem,
  Text,
} from "@chakra-ui/react"
import {
  TOWER_BASIC_COST,
  TOWER_DEFS,
  TOWER_KIND_SLOW,
} from "@/utils/anchor"

// Collapsible "How to play" reference. Rendered under the board so it spans the
// board width without crowding the side panel.
const TowerDefenseHowToPlay = () => {
  return (
    <Accordion allowToggle>
      <AccordionItem
        border="1px solid #2b2f3a"
        borderRadius="md"
        bg="#151822"
      >
        <AccordionButton px={3} py={2} _hover={{ bg: "transparent" }}>
          <Text flex={1} textAlign="left" fontSize="sm" fontWeight="bold">
            How to play
          </Text>
          <AccordionIcon />
        </AccordionButton>
        <AccordionPanel px={3} pb={3}>
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
  )
}

export default TowerDefenseHowToPlay
