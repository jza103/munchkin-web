# Handoff: what's left

**State at the original handoff:** all 8 milestones in `SPEC.md` are done. `tsc --noEmit` is clean and 326 tests pass, including 500 seeded bot games across 1 to 5 rivals. The engine, bots, UI with save/resume, GitHub Pages deploy, the optional GM mode and polish all exist. The work now is closing accuracy gaps and proving the game holds up in## Where work stopped (14 Nov 2026)

`tsc --noEmit` is clean and 343 tests pass (500 bot games, a 150-game soak, a `legalActions`/`apply` fuzz, a save/resume round trip).

| Task | State | What is left |
| --- | --- | --- |
| 1. Card accuracy | Done | Three card-text calls need Jason's decision (below) |
| 2. Rulings audit | Partly done | Check the remaining rulings one by one; write the mismatch report |
| 3. Bot gaps | Done | Nothing |
| 4. Hardening | Done | Nothing |
| 5. Phone and iPad | Partly done | Play full games by hand at both sizes |
| 6. Before private | Partly done | Clean-checkout run from `npm ci`; stale-content pass on `README.md` |

**Next step:** resume task 2, then finish 5 and 6.

**Task 1 decisions for Jason.** These follow memory of the printed cards, not `reference/SKILL.md`, which is abridged:
- Divine Intervention stops at Level 9 (the repo's existing ruling). The printed card may allow the winning level. Changing it would break the "Level 10 only by a kill" invariant.
- Hoard! resolves when drawn; its 3 Treasures are face-up if the Hoard! was drawn face-up. "Face-up if dead" is read as: a player back from the dead who finds it in their new hand reveals the 3.
- Chicken on Your Head is removed by any curse or Bad Stuff that takes headgear, even with none worn. The reference only says "stays on you".

**Task 2 so far.** Of the seven rulings named below, four had part of the ruling unpinned and now have tests (the engine already matched each): Warrior helper ties, Malign Mirror played mid-combat, Income Tax refusal, Ghoulfiends class powers. Hippogriff, Net Troll and Platycore have tests but were not compared line by line with the card text. The other 40-odd rulings in `README.md` are unchecked. No mismatch has been found yet.

**Task 5 so far.** At 390px and 820px the opening and combat screens have no sideways scroll, no page errors and no undersized buttons in combat, and a reload mid-combat resumes the same fight. Known issue: on a phone the charity prompt repeats the whole hand above the hand itself, which makes a long scroll.

**Task 6 so far.** A scan found no API keys or personal data (only input placeholders and a dummy test key). `npm run build` succeeds.

**Engine bugs found and fixed on the way** (each has a regression test):
- Lending a Cheat!-ed item with Help Me Out Here! destroyed the Cheat! and returned the item into a full slot.
- Super Munchkin could "replace" Half-Breed, leaving two races without a Half-Breed.

**Also added, outside this list:** card tiles show their key numbers (corner level or bonus, chips for Treasure, gold, levels, run modifiers, Big, Undead), and every player has a ten-pip track to Level 10.

## Task list

 real play.

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
