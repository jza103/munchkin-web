# Munchkin Web App Spec

## Decisions

- **Repo:** new `jza103/munchkin-web` repo, deployed to its own GitHub Pages site.
- **Visibility:** public for now, with the original card names and descriptions. It will go private after testing.
- **Players:** only Jason. GM mode uses bring-your-own-key; no proxy needed.
- **Rivals:** selectable from 1 to 5.
- **Card accuracy:** every card must be implemented accurately. Do not simplify the hard ones (Income Tax, Hippogriff, Cleric Resurrection, etc.).

## Goal and scope

V1 is a static, single-player Munchkin web app on GitHub Pages: you against 1 to 5 bot rivals, fully playable offline with no API key. A Claude GM layer (narration, rulings, teaching notes) is an optional add-on, switched off by default.

**In v1**

- Port of the skill's engine: shuffled Door and Treasure decks, dice, zones, levels, death and revive, hand limits, game log
- Full turn flow: setup, kick the door, fight or run, Look for Trouble or Loot the Room, charity
- Rules enforcement for every card and every rule in the skill's cheat sheet
- Rule-based rival bots that follow the skill's "play to win" heuristics
- Save and resume in the browser
- Mobile-friendly layout (phone and iPad)

**Not in v1**

- Multiplayer between humans
- Expansions beyond the base-set list in `cards.py`
- Accounts or a backend

**Source material:** `reference/SKILL.md` (the `munchkin-game-master` skill, with `cards.py` in Appendix A and `munchkin.py` in Appendix B). Its rules cheat sheet, rival personalities and narration style carry over.

## Architecture

Everything runs in the browser from static files. The engine is the only thing that changes game state; the UI and bots send it actions, and the optional GM client only reads its events.

```
Browser (static files from GitHub Pages)
  UI          <-> actions / state  <-> Game engine: apply(state, action), rules, decks, dice
  Rival bots  <-> actions / state  <-> Game engine
  Game engine  -> events           ->  GM client (optional, never changes state) <-> Claude API (your key)
  Game engine <-> save / resume    <-> Saved game (localStorage)
```

With GM mode off, nothing leaves the browser.

## Card data model

The biggest job is turning card text into data. In the skill, each card is `(name, copies, text)` and Claude reads the text to apply it. With no LLM in the loop, the engine needs every effect as structured fields.

One JSON file, `data/cards.json`. Each card has an `id`, `name`, `deck` (door or treasure), `kind`, `copies` and `text` (kept for display), plus fields by kind:

| Kind | Structured fields |
| --- | --- |
| Monster | `level`, `treasures`, `levelsGained`, `undead`, `bonusVs` (race/class/gender → +N), `runMod`, `noPursueAtOrBelow`, `badStuff` (list of effect ops) |
| Enhancer | `monsterBonus`, `treasureDelta` |
| Curse | `effect` (effect op), `persistent` (e.g. Chicken on Your Head) |
| Race / Class | `powers` (hooks: `runBonus`, `handLimit`, `bigItemsUnlimited`, `onHelpKill`, `sellDouble`, …) |
| Item | `slot` (head, armor, foot, hands, none), `hands`, `big`, `bonus`, `gold`, `requires`, `forbids`, `fire` |
| One-shot | `bonus`, `usable` (combat, any time), `effect` |
| Other (Go Up a Level, Wandering Monster, etc.) | `effect` |

**Effect ops** are a small shared vocabulary: `loseLevels(n)`, `loseSlot(slot)`, `loseRace`, `loseClass`, `loseBigItems`, `discardHand`, `die`, `othersTakeItem(who)`, `rollThen(table)`. Cards that don't fit (Income Tax, Hippogriff, Cleric Resurrection and similar) get a named custom handler that implements the full card, with its own tests.

Conversion plan: convert `cards.py` to JSON in one pass, then a unit test checks every card has the fields its kind needs and every card has an implemented effect.

## Game engine

The engine is pure TypeScript with no DOM access, so it can be unit-tested and reused by the bots and the GM layer.

**State.** Keep the skill's `state.json` shape: `deck_door`, `deck_treasure`, both discard piles, `play`, `turn`, `log`, and per player `level`, `dead`, `equipped`, `carried`, `curses`, `hand`. Add `phase`, `combat` (monsters, enhancers, helper, deal, modifiers) and a seeded `rngState` so dice and shuffles are replayable.

**Actions.** Every change is an action object run through one `apply(state, action)` function, which returns the new state or a rule error. The skill's commands map directly: `draw`, `move`, `level`, `die`, `revive`, `roll`, `check`, `log`. The new ones are `equip`, `sell`, `kickDoor`, `fight`, `askHelp`, `playOneShot`, `runAway`, `lootRoom`, `lookForTrouble`, `charity` and `endTurn`.

**Turn phases.**

1. Setup: equip, swap race/class, sell, trade (own turn only, never in combat)
2. Kick the door: monster → combat; curse → apply to kicker; else to hand
3. If no fight: Look for Trouble or Loot the Room
4. Combat window: anyone may add cards; the engine gives each player a chance to respond before resolving (the "2.6 second" rule)
5. Resolve: win (levels + treasure) or run (a 5+ after modifiers per monster) or Bad Stuff
6. Charity: hand limit 5 (Dwarf 6); extras to the lowest-level player

**Rules to enforce** come straight from the skill's cheat sheet: slot limits, one Big item unless Dwarf, race/class restrictions, monster wins ties except Warriors, Elf level on helped kills, selling can't reach Level 10, Sandals only block door curses when worn, and dead players keep level, race, class and curses.

**Tests.** Vitest unit tests per rule and per custom card handler, plus a seeded "bots play 500 full games" test (with 1 to 5 rivals) that must finish with no illegal states.

## Rival bots

Bots are rule-based and only see their own hand plus public info, as in the skill. Each bot exposes `chooseAction(view, decisionPoint)`, where `view` is the state with other hands reduced to Door/Treasure counts.

Decision points and default heuristics, taken from the skill's "Playing the rivals" section:

- **Own turn setup:** equip the best legal gear; sell when it gains a level (never to Level 10); Halflings double-sell
- **Fight or run:** fight if strength plus playable one-shots beats the monster; otherwise ask for help, then run
- **Interfering:** target the leader; prefer cheap denials (Friendship Potion, Pollymorph, Backstab) over raw bonuses; hold cards until the fighter commits; always try to stop a Level 10 win
- **Helping:** demand more treasure from the leader; never help anyone reach Level 10
- **Curses:** play on the leader at the worst moment for them
- **Charity:** dump the least useful cards

The player picks 1 to 5 rivals at game start. Personalities are parameters, not code, each with `aggression`, `greed` and `spite` weights. Defaults are Alex (scheming Dwarf, hoards Big items) and Sam (sly Halfling, sells aggressively); add 3 more named personalities for the extra seats.

## Optional Claude GM mode

Claude never changes game state. The engine decides what happened; Claude only describes it and teaches. This keeps the skill's rule ("never narrate a card that wasn't drawn or moved by the engine") true by design.

**What Claude adds**

- GM-voice narration of each turn and rival play-by-play
- ⚖️ Valid / Not valid / Valid but… explanations when you try a move
- 🎓 Teaching notes on missed lines and risky plays
- End-of-game recap of the 3–4 moments that decided it
- Optional: rival table talk and negotiation lines

**How it works.** After each resolved action, the app sends Claude the event log since the last call plus the human's view of the state (never rival hands). The system prompt is the skill's narration, teaching and personality sections. Responses stream into the log panel.

**Key handling:** bring your own key. The key is stored in localStorage on that device, and the browser calls the API directly with the `anthropic-dangerous-direct-browser-access: true` header. No proxy.

**Cost control:** a cheap, fast model by default, short prompts (events, not full state), and a toggle to narrate only your turns.

## UI

The UI is one screen, phone-first, that also works on iPad and desktop. The skill's "Rivals at a glance" table becomes a permanent strip, since losing track of rival hands was a past pain point.

- **New game screen:** your name, rival count (1 to 5), GM mode on/off
- **Top strip:** rivals at a glance (level, race/class, strength, hand as Door/Treasure counts, notable gear, curses)
- **Center:** the current door or combat (monsters, enhancers, both sides' totals, helper)
- **Your table:** equipped by slot, carried, curses, race/class, strength
- **Your hand:** card tiles with name, kind and one-line text, plus `[n/limit]`; tap for full text
- **Action bar:** only the legal actions for the current phase (Kick the door, Fight, Ask for help, Run, Play card, End turn)
- **Log panel:** engine log, plus Claude narration when GM mode is on

The app pauses for you at every real decision, including chances to interfere in rival fights. It doesn't pause when you have no legal response. Rival turns play out step by step, with a speed setting.

## Repo, hosting, dev setup

**Stack:** Vite + TypeScript, with a light UI layer (Preact or plain TS components). There's no server, and the output is static files.

**Layout**

```
munchkin-web/
  SPEC.md
  reference/SKILL.md     # source skill (read-only reference)
  data/cards.json        # structured card data
  src/engine/            # state, actions, rules, rng (no DOM)
  src/bots/              # rival heuristics
  src/gm/                # optional Claude narration client
  src/ui/                # screens and components
  tests/                 # Vitest
  Dockerfile, compose.yaml
  .github/workflows/deploy.yml
```

**Hosting:** a GitHub Action builds on push to `main` and deploys to `https://jza103.github.io/munchkin-web/`. Set Vite's `base` to `/munchkin-web/`.

**Run it with Docker**

```
docker compose up        # node:22 image, runs `npm ci && npm run dev -- --host`
# open http://localhost:5173
```

**Run it without Docker**

1. Install Node 22 LTS
2. `npm ci` installs Vite, TypeScript and Vitest from the lockfile
3. `npm run dev` starts Vite's dev server with hot reload on port 5173
4. `npm test` runs the engine and bot tests
5. `npm run build` writes static files to `dist/`, which is exactly what Pages serves

## Milestones

Each milestone ends with something playable or testable, so a session can stop at any of them.

1. **Data:** `cards.json` converted from `cards.py`, with a schema test passing
2. **Engine core:** state, decks, dice, zones and levels, matching the Python engine's commands, with tests
3. **Turn and combat rules:** full turn flow, combat, running, Bad Stuff, death, charity, every card's effect
4. **Bots:** 1 to 5 rivals that complete 500 seeded games with no illegal states
5. **UI:** a playable game in the browser, with save and resume
6. **Deploy:** the GitHub Action publishes to Pages
7. **GM mode:** bring-your-own-key narration and teaching notes behind a toggle
8. **Polish:** card art placeholders, sound, rival speed setting, end-of-game recap
