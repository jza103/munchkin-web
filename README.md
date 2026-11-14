# munchkin-web

A static, single-player Munchkin web app. You play against 1 to 5 rule-based rival bots. It runs offline in the browser and needs no API key. See `SPEC.md` for the plan and `reference/SKILL.md` for the source rules and cards.

## Run it

### With Docker

```bash
docker compose up
```

Then open http://localhost:5173/munchkin-web/. Compose uses the `node:22` image, runs `npm ci && npm run dev -- --host`, and mounts the source, so edits hot-reload.

### Without Docker

1. Install Node 22 LTS.
2. `npm ci` installs Vite, TypeScript, Preact and Vitest from the lockfile.
3. `npm run dev` starts Vite's dev server with hot reload on port 5173 (open `/munchkin-web/`).
4. `npm test` runs the engine and bot tests, including 500 seeded all-bot games.
5. `npm run build` type-checks and writes static files to `dist/`. This is exactly what GitHub Pages serves (`npm run preview` serves it locally).

Extra scripts:

- `npx vite-node scripts/sim.ts 500 1` plays N seeded all-bot games and checks every state.
- `npx vite-node scripts/debug-seed.ts SEED [RIVALS]` replays one game and dumps the state at the first illegal state.
- `node scripts/convert-cards.mjs` regenerates `data/cards.json` from Appendix A of `reference/SKILL.md`.

## Deploy

`.github/workflows/deploy.yml` builds on every push to `main`. It runs the tests, builds, and publishes `dist/` to `https://jza103.github.io/munchkin-web/`. Vite's `base` is `/munchkin-web/`. One-time setup: in the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.

## Layout

```
data/cards.json        structured card data (141 cards, 163 instances), text kept verbatim
src/engine/            pure TypeScript, no DOM: apply(state, action), rules, decks, seeded RNG
  types.ts             state, actions, effect ops
  state.ts             newGame, zones, draw/reshuffle, levels, fast clone
  rules.ts             races/classes, item legality, slots, Big items, strength
  combat.ts            combat totals, monster strength/treasure
  flow.ts              task queue: running, Bad Stuff ops, curses, death/looting, treasure
  actions.ts           check()/apply() for every action and every card handler
  legal.ts             legalActions(state, player)
  view.ts              a player's view (other hands as Door/Treasure counts)
  invariants.ts        illegal-state detector used by the bot-game tests
src/bots/              personalities (Alex, Sam, Morgan, Riley, Quinn), heuristics, driver
src/gm/                optional Claude GM: prompts built from the skill, bring-your-own-key client
src/ui/                Preact UI, save/resume (localStorage)
tests/                 Vitest: cards schema, engine core, turn, combat, running, Bad Stuff/curses, bots, 500 games, GM
```

## Engine model

- **State** keeps the skill's `state.json` shape: `deck_door`, `deck_treasure`, both discard piles, `play`, `turn`, `log`, and per player `level`, `dead`, `equipped`, `carried`, `curses` and `hand`. It adds `phase`, `combat`, `pending` (whose decision it is), a task `queue`, and `rngState`. Every shuffle and die roll comes from that seeded mulberry32 state, so a game replays exactly.
- **Actions.** Every change goes through `apply(state, action)`, which returns either `{ok, state}` or a rule error. It never mutates its input. The skill's commands (`draw`, `move`, `level`, `die`, `revive`, `roll`, `check`, `log`) are GM-level actions. The game actions are `equip`, `carry`, `playRaceClass`, `sell`, `trade`, `kickDoor`, `lookForTrouble`, `lootRoom`, `askHelp`, `playCard`, `power`, `fight`, `runAway`, `pass`, `charity` and `endTurn`, plus responses to pending decisions.
- **The 2.6-second rule.** When a fighter who is winning calls `fight`, every other player who holds a legal response gets asked in turn. Any card played gives control back to the fighter. Rolls work the same way: Loaded Die, Flask of Glue, Invisibility and the Halfling reroll open a window. So does a curse, which can be answered with a Wishing Ring. A player with no legal response is never asked.

## Rulings and interpretations

The card text in `cards.py` is abridged. Where it was ambiguous, the engine does this:

- **Warrior ties:** ties go to the munchkins if the fighter or the helper is a Warrior.
- **"+N vs" bonuses:** they apply if the fighter or the helper matches.
- **Baby:** a monster's level never drops below 1.
- **Treasure:** treasure counts never go below 0.
- **Ghoulfiends:** equipped items and Treasure one-shots don't count for the munchkins. Class powers still do.
- **Malign Mirror:** only the cursed player's level counts in their next combat, with no gear and no class powers. Played during a combat they're in, it applies to that combat.
- **Insurance Salesman:** player-side fire bonuses don't count.
- **Large Angry Chicken:** you get the extra level if any fire bonus counted on the munchkins' side.
- **Lawyers:** a Thief may let them go (no Treasure), and Thieves never take their Bad Stuff.
- **Lawyers' Bad Stuff:** the victim picks 2 cards and who receives each one.
- **Amazon:** a female fighter skips the fight and takes 1 Treasure automatically.
- **Optional skips:** Stoned Golem (non-Halflings) and Wannabe Vampire (Clerics) are optional skips, using the "Let it go" action.
- **Leperchaun:** the players to the left and right take the item, as the text says, rather than discarding it. With 1 rival, that player picks twice.
- **Hippogriff and Net Troll:** takers go in order from highest level, and they choose from the victim's items on the table.
- **Platycore:** the victim chooses between their hand and 2 levels.
- **Drooling Slime and Amazon "or":** the second option applies only when the first is impossible.
- **Snails on Speed, Insurance Salesman and Income Tax:** these use items on the table (equipped or carried). For gold payments no change is given, and players must not overpay with cards they don't need.
- **Income Tax:** each other living player pays items worth at least the discarded item's value, or loses a level. Choosing to pay nothing also means losing a level.
- **Unspeakably Awful Indescribable Horror:** a Wizard loses only the Wizard class card.
- **Lose Your Race / Class and Shrieking Geek:** all race (or class) cards go. Half-Breed and Super Munchkin stay.
- **Change Race / Class:** with no race (or class), nothing happens. Otherwise you take the top race (or class) card from the Door discards.
- **Losing qualifications:** items you can no longer use move from equipped to carried. If you lose Dwarf with more than one Big item, you keep one and discard the rest.
- **Tuba of Charm:** while equipped, a run succeeds on a die of 3+, after Chicken but ignoring other run modifiers.
- **Rat on a Stick:** you can use it from the table. Discarding it escapes every monster of Level 8 or lower in that combat, for that runner.
- **Crabs:** there's no run roll, so only Instant Wall or Rat on a Stick avoids its Bad Stuff.
- **Running:** the helper runs too and takes their own Bad Stuff. Each monster (and each Mate) needs its own roll.
- **Chicken on Your Head:** it applies to every roll the cursed player makes (running, Bad Stuff rolls, Theft). It stays until a Wishing Ring removes it, or until a curse or Bad Stuff that takes headgear hits the player (Lose Your Headgear and the "lose headgear" Bad Stuff). The chicken goes even if no headgear is worn.
- **Divine Intervention:** it resolves the moment it is drawn, by any route: kicked open, looted face-down, dealt, taken with Resurrection or drawn after a reshuffle. Every Cleric goes up a level (never to 10) and the card is discarded. It uses up that draw and is never held in a hand.
- **Hoard!:** it resolves the moment it is drawn and is replaced by 3 more Treasures. They are face-up if the Hoard! itself was drawn face-up (a shared combat reward, where they join the pool to split), otherwise face-down. A player coming back from the dead who finds it in their new hand reveals the 3 Treasures to the table (the "face-up if dead" case).
- **Loaded Die:** it sets the face; modifiers still apply.
- **Help Me Out Here!:** you must qualify for the borrowed item, but slot limits are ignored. The item goes back after the combat, or is discarded if its owner died.
- **Transferral Potion:** the player who plays it chooses any living non-fighter. The old fighter escapes, and any helper leaves.
- **Pollymorph Potion:** whoever plays it takes the treasure.
- **Magic Lamp:** only the turn player, in their own combat.
- **Out to Lunch:** the fighter takes 2 Treasure.
- **Charm:** the Wizard fighter takes the treasure, face-down.
- **Help deals are enforced:** the helper picks the agreed number of face-up Treasures.
- **Kneepads of Allure:** a lower-level player must help, for 0 Treasure.
- **Elf help:** an Elf helper's level per kill can reach Level 10 (it's a kill).
- **Never to Level 10:** selling, Go Up a Level, Divine Intervention and Pukachu's escape level all stop at 9.
- **Theft:** allowed any time outside combat. It targets a small item on another player's table (equipped or carried).
- **Death:** looters go from highest level, taking one card each from the dead player's hand and table. Race, class, Half-Breed, Super Munchkin and curses stay. Cheat! is discarded. Dead players don't receive charity.
- **Charity:** ties for lowest level share the cards round-robin. If you are the lowest, or tied for it, you discard.
- **Gender:** each player picks a gender at the start. There is no sex-change curse in this card set.

## Known limitations

Every card has an effect handler, and a test checks that. No card is known to deviate from its text.

**Bot limitations (not rule gaps):**

- Bots never propose trades. They do accept or decline yours.
- Bots never use Cheat! or Illusion offensively. They do play other cards that deny a win.

## Claude GM mode (optional)

GM mode is off by default, and the game is fully playable offline without it. Turn it on from the new-game screen or the 🎙️ button, then pick who answers:

| Option | Where it works | What it needs |
| --- | --- | --- |
| **Claude on claude.ai** | Only when the app runs as a claude.ai artifact (`npm run build:artifact`) | Nothing. It uses the viewer's own Claude plan; the first narration asks permission |
| **OpenRouter** | Anywhere, including GitHub Pages | An OpenRouter API key. The default model is `anthropic/claude-haiku-5.5`; others come from OpenRouter's live model list |
| **Anthropic** | Anywhere | An Anthropic API key. The default model is `claude-haiku-5-5`; Sonnet 5.5 and Opus 5.5 are selectable |

"Auto" picks built-in Claude when it is available, otherwise whichever key is set.

- **Keys:** they are stored only in this browser's localStorage and go straight from the browser to the service you picked. There is no proxy.
- **Claude never changes the game.** The engine decides everything. When the game is waiting on you, the app sends the new engine events plus your view of the table: rival hands appear only as Door/Treasure counts, and the draw piles are hidden. A test checks that rival hand contents never reach a prompt.
- **What you get:** GM-voice narration of each turn and the rivals' play-by-play, ⚖️ rulings on moves the engine rejected, occasional 🎓 teaching notes, a line of rival table talk, an end-of-game recap, and an "Ask the GM" box for rules questions.
- **The prompt** is built from the skill's Narration style, Rules cheat sheet, Playing the rivals and Game end sections.
- **Cost control:**
  - Narration uses a fast tier at low effort.
  - Prompts are short (new events, not the full state).
  - A "Narrate only my turns" toggle skips rival turns.
  - After any error, narration pauses until your next move; it never retries by itself.

### Publishing as a claude.ai artifact

`npm run build:artifact` writes `dist-artifact/`: `page.html` (the page fragment the Artifact tool wraps) and `assets/`. Publish `page.html` with the assets as supporting files and the `sample` capability. That copy saves games in its own browser storage, separate from the GitHub Pages copy.

## Polish

- **Card art:** placeholder art for each card (a colour band by card type, plus its emoji).
- **Sound:** synthesized sound effects for doors, rolls, curses, level changes, deaths, wins and the game's end. Toggle them with 🔊/🔇.
- **Rival speed:** slow, normal, fast or instant. You can also pause the rivals.
- **End-of-game recap:** the 3 to 4 moments that decided the game, each with a 🎓 lesson. It works without Claude; with GM mode on, Claude narrates its own recap too.

## Status

All eight milestones are done: data, engine core, full rules, bots, UI with save/resume, deploy, Claude GM mode, and polish.
