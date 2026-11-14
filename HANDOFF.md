# Handoff: what's left

**State at handoff:** all 8 milestones in `SPEC.md` are done. `tsc --noEmit` is clean and 326 tests pass, including 500 seeded bot games across 1 to 5 rivals. The engine, bots, UI with save/resume, GitHub Pages deploy, the optional GM mode and polish all exist. The work now is closing accuracy gaps and proving the game holds up in real play.

Do these in order. Each task ends with tests passing and a commit.

## 1. Close the card-accuracy gaps (highest priority)
`SPEC.md` says every card must be accurate with no simplifying. `README.md` lists three cards that still deviate:

- **Divine Intervention:** implemented as playable from hand at any time. The printed card resolves when drawn. Fix it, and handle the draw-time trigger in every place a card can be drawn (door, treasure, reshuffle, loot, charity receipt).
- **Hoard!:** always draws face-down. Model the "face-up if dead" case. A dead player has no hand to play from, so work out the draw and loot flow where this can happen.
- **Curse! Chicken on Your Head:** only a Wishing Ring removes it. Check the full card text in `reference/SKILL.md` for other removal conditions and implement them.

For each: re-read the full card text, write failing tests for the printed behavior, implement, then delete the entry from "Cards not fully implemented" in `README.md`.

## 2. Audit the rulings list against the card text
`README.md` has about 50 "Rulings and interpretations". Go through them one by one against `data/cards.json` text and `reference/SKILL.md`. Where a ruling is a real interpretation call (Warrior ties, Ghoulfiends, Malign Mirror, Income Tax, Hippogriff, Net Troll, Platycore), confirm it matches the printed card and has a test pinning it. Report any that do not as a list, with a proposed fix, before changing them.

## 3. Bot gaps
- Bots never **propose trades**. Add trade proposals that follow the skill's "Playing the rivals" heuristics, and keep accept/decline working.
- Bots never use **Cheat!** or **Illusion** offensively. Add both, gated by each personality's `aggression`, `greed` and `spite` weights.
- Add a regression test per new behavior, and keep the 500-game test green.

## 4. Real-play hardening
- Extend the soak test: more seeds, mixed rival counts, and a check that every game terminates within a turn cap (no stalls or infinite response windows).
- Add invariant checks to `src/engine/invariants.ts` for card conservation (every card is in exactly one zone), level bounds (1 to 10, level 10 only by a kill), and hand limits at end of turn.
- Fuzz `legalActions` against `apply`: every legal action must apply without a rule error, and a sample of illegal actions must be rejected.

## 5. UI check on phone and iPad
Run the app and play full games on a phone-width and iPad-width viewport. Fix anything that is cramped, hidden or hard to tap: the rivals strip, response windows during rival fights, card tiles and the action bar. Confirm save/resume survives a reload mid-combat.

## 6. Before making the repo private
- Confirm no API keys or personal data are committed.
- Confirm GitHub Pages deploy still works from a clean checkout (`npm ci`, `npm test`, `npm run build`).
- Update `README.md` Status and remove anything stale.
