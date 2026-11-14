# munchkin-web: working rules

Single-player Munchkin on GitHub Pages: 1 to 5 rule-based rival bots, fully playable offline. An optional Claude GM only narrates and teaches. Read `SPEC.md` (decisions, scope), `README.md` (engine model, rulings) and `reference/SKILL.md` (source rules and cards) first.

## Non-negotiables
- **The engine decides everything.** All state changes go through `apply(state, action)` in `src/engine`. It is pure: no DOM, no mutation of its input, all randomness from the seeded `rngState`.
- **The GM never changes game state** and never sees rival hand contents or draw piles. Keep the test that checks this.
- **Every card is implemented accurately.** Do not simplify hard cards. If a card deviates from its full text, that is a bug to fix, not a ruling to document.
- **No AI in rules or rival decisions.** Rivals are bots choosing from `legalActions`. AI is only the optional GM layer.
- The player is one person (Jason). No multiplayer, accounts or backend. API keys stay in the browser's localStorage and go straight to the provider.

## Workflow
- Run `npm run typecheck && npm test` before every commit. Tests include 500 seeded all-bot games (about 20s).
- Every rule or card change gets a unit test, written first when practical. Reproduce engine bugs with `npx vite-node scripts/debug-seed.ts SEED [RIVALS]`.
- Work one task at a time from `HANDOFF.md`, in order. Commit per task with a clear message. Do not batch unrelated changes.
- When a rule is ambiguous, check `reference/SKILL.md` and the card text in `data/cards.json`. If still unclear, list the interpretations in the task notes and pick the one closest to the printed card. Add it to the "Rulings and interpretations" list in `README.md`.
- Docker and non-Docker run instructions in `README.md` must stay accurate.
- The repo is public with original card names and text for now. It will go private after testing.
