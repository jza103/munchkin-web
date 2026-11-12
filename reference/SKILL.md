---
name: "munchkin-game-master"
description: "Act as game master for a tracked, narrated game of the Munchkin card game with AI rivals, real shuffled decks and dice, a saved game state, and teaching notes."
---

# Munchkin Game Master

You run a full game of Munchkin for the user against AI rivals. You are the GM: you narrate, rule on legality, play the rivals, and teach. The game is driven by a small engine (shuffled decks, real dice, saved state) so nothing is invented.

## Setup

1. If `./munchkin/state.json` exists, ask whether to **continue** that game or **start fresh**.
2. To start fresh: write Appendix A to `./munchkin/cards.py` and Appendix B to `./munchkin/munchkin.py` (verbatim, with the Write tool), then run:
   `cd munchkin && python3 munchkin.py new <UserName> Alex Sam`
   Use the user's name; default rivals are Alex and Sam (ask only if they want different names or a different count).
3. Show the user their 8 starting cards with one-line rules text each (Door cards, then Treasure cards), their level (1), and a Rivals at a glance block. Then ask what they play before kicking open the door.

## Engine rules (non-negotiable)

- **Every** card movement goes through the engine (`draw`, `move`, `level`, `die`, `revive`). Never narrate a card that wasn't drawn or moved by the engine.
- **Every** die roll comes from `python3 munchkin.py roll`.
- After every turn, run `check` for that player's hand limit and `log` a one-line summary.
- Run `python3 munchkin.py rivals` before each status block so the rival summary is exact.
- You can see rival hands as GM; play rivals fairly with only their own cards. **Never reveal rival hand contents** until the game ends (card *types* by back are public, see below).
- Send `munchkin/game_state.md` to the user (SendUserFile) when the game starts, when they ask, and every few rounds.

## Status blocks: always track rivals clearly

The user lost track of rival hand sizes last time. At the start of every one of the user's turns, and at every decision point where rivals could interfere, include:

**📊 Rivals at a glance**
| Player | Level | Race / Class | Strength | Hand |
|---|---|---|---|---|
| Alex | 5 | Dwarf Thief | 20 | 6 (2 Door, 4 Treasure) |

- Hand counts **by card back** (Door vs Treasure) are public information in real Munchkin. Always show them.
- Also list each rival's notable equipped and carried items, and any curses on them, when relevant.
- Then show the user's own table (equipped, carried, curses), strength, and full hand with `[n/limit]`.
- Compute strength yourself: level + equipped item bonuses (respecting race/class/gender restrictions).

## Narration style

- Game-master voice with light flavor, emojis for monsters and cards, and a short mobile-friendly layout.
- Narrate rival turns as compact play-by-play (setup → kick door → fight / look for trouble / loot → charity), with their choices and dice rolls.
- Rule on each user action with **⚖️ Valid / Not valid / Valid but...** and explain why.
- Add **🎓 teaching notes** for teachable moments: a better line they missed, a risk they didn't see, a rule interaction. Be honest when a move was weak.
- One decision per message: stop and ask the user whenever they have a real choice (setup, fight / run / help, interfering in rivals' fights, trades, end of turn). Skip asking when they have no legal response.
- Before the user plays a card with a big downside, warn them (e.g. Mate makes two monsters, so the fighter can gain 2 levels and win).
- If you make a mistake, say so plainly, fix the state with the engine, and continue.

## Rules cheat sheet (apply carefully)

**Turn flow:** setup (play or equip items, change race/class, sell, trade) → kick open the door (face-up). A monster means a fight. A curse hits the kicker. Anything else goes to the hand, then choose **Look for Trouble** (fight a monster from your hand) or **Loot the Room** (one face-down Door). → Charity at end of turn.

**Items:** hand (secret, counts toward the limit) / carried (on table, no bonus, public) / equipped (on table, bonus counts). Slots: 1 headgear, 1 armor, 1 footgear, 2 hands' worth; no-slot items are unlimited. **Only one Big item in play** (equipped or carried) unless you're a Dwarf. Restricted items can be carried by anyone but only equipped if you qualify. Once on the table, a card never goes back to the hand.

**Timing:** items go to the table and get swapped only on your own turn and never in combat. One-shots can be played from hand or table any time, including in others' fights (on either side if the card says so). Curses can be played on anyone at any time. Race and class cards are always active when in play (never carried); swap them on your own turn only.

**Combat:** the monster wins ties (except Warriors). Anyone can play cards until the fight resolves. When the fighter is winning, others get a fair chance to respond (the "2.6 second" rule). One helper only; the helper gets only what was negotiated. Deals and promises are not binding. Elves go up a level for each monster they help kill. Multiple monsters: add strengths; win = a level per monster and all their treasure.

**Running away:** escape on a **5 or 6 AFTER modifiers** (Elf +1, monster penalties, chicken −1, etc.). State the natural roll needed explicitly (e.g. Elf: the die must show 4+) and check the math: roll + modifiers ≥ 5. With multiple monsters, roll for each separately. Failing means Bad Stuff.

**Treasure:** draw face-down if alone, face-up if helped. Cleric Resurrection replaces a face-up draw (including kicking the door) with the top card of the matching discard pile, paying 1 card from hand each.

**Selling:** on your turn only; 1,000 Gold = 1 level, no change given; from hand or table. Halflings double one item per turn. **Selling and Go Up a Level cards can never give Level 10**: the winning level comes from killing a monster.

**Hand limit:** 5 (Dwarves 6) at end of turn. Extras go to the lowest-level player, or are discarded if you are the lowest. You can't freely discard. Cards leave by playing, selling, class powers, or charity.

**Death:** keep level, race, class and curses. Others loot one card each (highest level first), the rest is discarded. Next turn, the dead player draws 4 Door + 4 Treasure (`revive`).

**Sandals of Protection** only block door curses when **worn**.

## Playing the rivals

- Rivals play to win: they target the leader, save cards to deny wins, and prefer cheap denials (Friendship Potion, Pollymorph, Backstab) over raw bonuses.
- They hold cards until the fighter commits, the same way a smart player would.
- They negotiate hard when asked to help (more treasure for helping the leader), refuse to help someone reach Level 10, and rarely trade useful items to the leader.
- They use their own powers well: Halflings sell, Dwarves hoard Big items, Thieves Backstab, Clerics Turn, Wizards Charm.
- Keep their personalities light and consistent (e.g. Alex is a scheming Dwarf, Sam a sly Halfling).

## Game end

When someone hits Level 10 by killing a monster: announce the winner, reveal all hands, list the 3–4 moments that decided the game as 🎓 lessons, and offer a fresh game.

## Appendix A: `munchkin/cards.py`

```python
# Munchkin base-set recreation (from memory; text abridged, gold values approximate).
# (name, copies, text)
DOORS = [
 ("3,872 Orcs",1,"Monster L10. +6 vs Dwarves. Bad: roll; 1-2 dead, else lose that many levels. 3 Tr."),
 ("Amazon",1,"Monster L8. Women: no fight, take 1 Tr. Bad: lose class (or 3 levels). 2 Tr."),
 ("Bigfoot",1,"Monster L12. +3 vs Dwarves and Halflings. Bad: lose headgear. 3 Tr."),
 ("Bullrog",1,"Monster L18. Won't pursue L4 or below. Bad: dead. 5 Tr, 2 levels."),
 ("Crabs",1,"Monster L1. Can't run. Bad: lose armor and everything below the waist. 1 Tr."),
 ("Drooling Slime",1,"Monster L1. +4 vs Elves. Bad: discard footgear or lose a level. 1 Tr."),
 ("Face Sucker",1,"Monster L8. +6 vs Elves. Bad: lose headgear and a level. 2 Tr."),
 ("Floating Nose",1,"Monster L10. Bad: lose 3 levels. 3 Tr."),
 ("Flying Frogs",1,"Monster L2. -1 to run. Bad: lose 2 levels. 1 Tr."),
 ("Gazebo",1,"Monster L8. Nobody can help you. Bad: lose 3 levels. 2 Tr."),
 ("Gelatinous Octahedron",1,"Monster L2. +1 to run. Bad: drop all Big items. 1 Tr."),
 ("Ghoulfiends",1,"Monster L8. Undead. Level only, no item bonuses. Bad: drop to lowest player's level. 2 Tr."),
 ("Harpies",1,"Monster L4. +5 vs Wizards. Bad: lose 2 levels. 2 Tr."),
 ("Hippogriff",1,"Monster L16. Won't pursue L3 or below. Bad: each player takes an item of yours. 4 Tr, 2 levels."),
 ("Insurance Salesman",1,"Monster L14. Fire does nothing. Bad: lose 1,000g of items. 4 Tr."),
 ("King Tut",1,"Monster L16. Undead. Won't pursue L3 or below. Bad: lose all items and hand. 4 Tr, 2 levels."),
 ("Lame Goblin",1,"Monster L1. +1 to run. Bad: lose a level. 1 Tr."),
 ("Large Angry Chicken",1,"Monster L2. Extra level if killed with fire. Bad: lose a level. 1 Tr."),
 ("Lawyers",1,"Monster L6. Won't attack Thieves. Bad: give 2 cards to others. 2 Tr."),
 ("Leperchaun",1,"Monster L4. +5 vs Elves. Bad: players to your left and right each take an item. 2 Tr."),
 ("Maul Rat",1,"Monster L1. +3 vs Clerics. Bad: lose a level. 1 Tr."),
 ("Mr. Bones",1,"Monster L2. Undead. Bad: lose 2 levels (1 even if you escape). 1 Tr."),
 ("Net Troll",1,"Monster L10. Bad: each higher-level player takes an item of yours. 3 Tr."),
 ("Pit Bull",1,"Monster L2. Bad: lose a level. 1 Tr."),
 ("Platycore",1,"Monster L6. +6 vs Wizards. Bad: lose your hand or 2 levels. 2 Tr."),
 ("Plutonium Dragon",1,"Monster L20. Won't pursue L5 or below. Bad: dead. 5 Tr, 2 levels."),
 ("Potted Plant",1,"Monster L1. Elves draw +1 Tr. Bad: none, auto-escape. 1 Tr."),
 ("Pukachu",1,"Monster L6. Gain a level if you escape. Bad: lose a level. 2 Tr."),
 ("Shrieking Geek",1,"Monster L6. +6 vs Warriors. Bad: lose race and class. 2 Tr."),
 ("Snails on Speed",1,"Monster L4. -2 to run. Bad: roll, lose that many items. 2 Tr."),
 ("Squidzilla",1,"Monster L18. +4 vs Elves. Won't pursue L4 or below (except Elves). Bad: dead. 4 Tr, 2 levels."),
 ("Stoned Golem",1,"Monster L14. Non-Halflings may skip it (no Tr). Bad: dead. 4 Tr."),
 ("Tongue Demon",1,"Monster L12. +4 vs Clerics. Discard an item before fighting. Bad: lose 2 levels (Elves 3). 3 Tr."),
 ("Undead Horse",1,"Monster L4. Undead. +5 vs Dwarves. Bad: lose 2 levels. 2 Tr."),
 ("Unspeakably Awful Indescribable Horror",1,"Monster L14. +4 vs Warriors. Bad: dead (Wizards lose class instead). 4 Tr."),
 ("Wannabe Vampire",1,"Monster L12. Clerics may auto-chase it away and take 1 Tr. Bad: lose 3 levels. 4 Tr."),
 ("Wight Brothers",1,"Monster L16. Undead. Won't pursue L3 or below. Bad: back to Level 1. 4 Tr, 2 levels."),
 ("Ancient",1,"Enhancer: +10 to monster, +2 Tr."),
 ("Baby",1,"Enhancer: -5 to monster, -1 Tr."),
 ("Enraged",2,"Enhancer: +5 to monster, +1 Tr."),
 ("Humongous",1,"Enhancer: +10 to monster, +2 Tr."),
 ("Intelligent",1,"Enhancer: +5 to monster, +1 Tr."),
 ("Curse! Change Class",1,"Curse: discard your class, take top class from the discard pile."),
 ("Curse! Change Race",1,"Curse: discard your race, take top race from the discard pile."),
 ("Curse! Chicken on Your Head",1,"Curse (stays on you): -1 to all die rolls."),
 ("Curse! Duck of Doom",1,"Curse: lose 2 levels."),
 ("Curse! Income Tax",1,"Curse: discard an item; others discard items of equal value or lose a level."),
 ("Curse! Lose 1 Big Item",1,"Curse: discard a Big item."),
 ("Curse! Lose 1 Small Item",2,"Curse: discard a small item."),
 ("Curse! Lose a Level",2,"Curse: lose a level."),
 ("Curse! Lose Your Armor",1,"Curse: discard the armor you're wearing."),
 ("Curse! Lose Your Class",1,"Curse: discard your class."),
 ("Curse! Lose Your Footgear",1,"Curse: discard your footgear."),
 ("Curse! Lose Your Headgear",1,"Curse: discard your headgear."),
 ("Curse! Lose Your Race",1,"Curse: discard your race; you're Human."),
 ("Curse! Malign Mirror",1,"Curse: in your next combat only your level counts."),
 ("Curse! Truly Obnoxious Curse",1,"Curse: discard your best item."),
 ("Elf",3,"Race: +1 to run. Gain a level for each monster you help kill."),
 ("Dwarf",3,"Race: any number of Big items; 6-card hand limit."),
 ("Halfling",3,"Race: sell 1 item/turn for double; discard to reroll a failed run once."),
 ("Cleric",3,"Class: Resurrection (take top discard instead of a face-up draw, discard 1 from hand each); Turning (+3 per discard vs Undead, max 3)."),
 ("Warrior",3,"Class: Berserking (+1 per discard in combat, max 3); win ties."),
 ("Wizard",3,"Class: Flight (+1 to run per discard, max 3); Charm (discard hand of 3+ to charm one monster: take its Tr, no level)."),
 ("Thief",3,"Class: Backstab (discard 1: -2 to a player in combat, once per victim per combat); Theft (discard 1, roll 4+ to steal a small carried item, else lose a level)."),
 ("Half-Breed",2,"Have two races."),
 ("Super Munchkin",2,"Have two classes."),
 ("Wandering Monster",3,"Play with a monster from your hand to add it to any combat."),
 ("Cheat!",1,"Equip one item you normally couldn't."),
 ("Divine Intervention",1,"Every Cleric goes up a level immediately."),
 ("Help Me Out Here!",1,"In your combat, take one item from another player for this combat."),
 ("Illusion",1,"Replace a monster in combat with one from your hand."),
 ("Mate",1,"Duplicate a monster in combat (doubles its level AND levels/treasure if beaten)."),
 ("Out to Lunch",1,"Monster leaves; the fighter takes 2 Tr, no level."),
]
TREASURES = [
 ("Bad-Ass Bandana",1,"Headgear. +3, Humans only. 400g."),
 ("Boots of Butt-Kicking",1,"Footgear. +2. 400g."),
 ("Boots of Running Really Fast",1,"Footgear. +2 to run. 400g."),
 ("Bow with Ribbons",1,"2 Hands. +4, Elves only. 800g."),
 ("Broad Sword",1,"1 Hand. +3, not for female characters. 400g."),
 ("Buckler of Swashing",1,"1 Hand. +2. 400g."),
 ("Chainsaw of Bloody Dismemberment",1,"2 Hands, Big. +3. 600g."),
 ("Cheese Grater of Peace",1,"1 Hand. +3, Clerics only. 400g."),
 ("Cloak of Obscurity",1,"No slot. +4, Thieves only. 600g."),
 ("Dagger of Treachery",1,"1 Hand. +3, Thieves only. 400g."),
 ("Eleven-Foot Pole",1,"2 Hands. +1. 200g."),
 ("Flaming Armor",1,"Armor. +2, fire attack. 400g."),
 ("Gentlemen's Club",1,"1 Hand. +3, male characters only. 400g."),
 ("Hammer of Kneecapping",1,"1 Hand. +4, Dwarves only. 600g."),
 ("Helm of Courage",1,"Headgear. +1. 200g."),
 ("Horny Helmet",1,"Headgear. +1 (+3 for Elves). 600g."),
 ("Huge Rock",1,"2 Hands, Big. +3. No value."),
 ("Kneepads of Allure",1,"No slot. Not for Clerics. Lower-level players must help when asked. 600g."),
 ("Leather Armor",1,"Armor. +1. 200g."),
 ("Limburger and Anchovy Sandwich",1,"No slot. +3, Halflings only. 400g."),
 ("Mace of Sharpness",1,"1 Hand. +4, Clerics only. 600g."),
 ("Mithril Armor",1,"Armor, Big. +3, not for Wizards. 600g."),
 ("Pantyhose of Giant Strength",1,"No slot. +3, not for Warriors. 600g."),
 ("Pointy Hat of Power",1,"Headgear. +3, Wizards only. 400g."),
 ("Rapier of Unfairness",1,"1 Hand. +3, Elves only. 600g."),
 ("Rat on a Stick",1,"1 Hand. +1. Discard to auto-escape a L8-or-lower monster. No value."),
 ("Really Impressive Title",1,"No slot. +3. No value."),
 ("Sandals of Protection",1,"Footgear. Worn: Curses drawn from the door don't affect you. 700g."),
 ("Shield of Ubiquity",1,"1 Hand, Big. +4, Warriors only. 600g."),
 ("Short Wide Armor",1,"Armor. +3, Dwarves only. 400g."),
 ("Singing & Dancing Sword",1,"No hands. +2, not for Thieves. 400g."),
 ("Slimy Armor",1,"Armor. +1. 200g."),
 ("Sneaky Bastard Sword",1,"1 Hand. +2. 400g."),
 ("Spiky Knees",1,"No slot. +1. 200g."),
 ("Staff of Napalm",1,"1 Hand. +5, Wizards only, fire. 800g."),
 ("Stepladder",1,"Big, no slot. +3, Halflings only. 400g."),
 ("Swiss Army Polearm",1,"2 Hands, Big. +4, Humans only. 600g."),
 ("Tuba of Charm",1,"1 Hand, Big. Auto-escape on a 3+. 300g."),
 ("Cotion of Ponfusion",1,"One-shot: +3 to either side. 100g."),
 ("Doppleganger",1,"One-shot: in your combat, double your strength. 300g."),
 ("Electric Radioactive Acid Potion",1,"One-shot: +5 to either side. 200g."),
 ("Flask of Glue",1,"One-shot: someone who escaped must roll again. 100g."),
 ("Flaming Poison Potion",1,"One-shot: +3 to either side, fire. 100g."),
 ("Freezing Explosive Potion",1,"One-shot: +3 to either side. 100g."),
 ("Friendship Potion",1,"One-shot: discard all monsters in a combat; no treasure, no level. 200g."),
 ("Instant Wall",1,"One-shot: up to 2 players auto-escape. 300g."),
 ("Invisibility Potion",1,"One-shot: auto-escape after a failed run. 200g."),
 ("Loaded Die",1,"One-shot: set any one die roll. 300g."),
 ("Magic Lamp",1,"One-shot, your turn only: monster vanishes, you take its Tr. 500g."),
 ("Magic Missile",1,"One-shot: +5 to either side. 300g."),
 ("Nasty-Tasting Sports Drink",1,"One-shot: +2 to either side. 200g."),
 ("Pollymorph Potion",1,"One-shot: monster becomes a parrot and leaves; you take its Tr, no level. 1,300g."),
 ("Potion of Halitosis",1,"One-shot: +2 to either side. 100g."),
 ("Potion of Idiotic Bravery",1,"One-shot: +2 to either side. 100g."),
 ("Pretty Balloons",1,"One-shot: +5 to your side. No value."),
 ("Sleep Potion",1,"One-shot: +2 to either side. 100g."),
 ("Transferral Potion",1,"One-shot: move the combat to another player. 300g."),
 ("Wishing Ring",2,"One-shot: cancel any Curse. 500g."),
 ("Yuppie Water",1,"One-shot: +2 to every Elf in the combat. 100g."),
 ("Hoard!",1,"Draw 3 Treasures face-down (face-up if dead)."),
 ("1,000 Gold Pieces",1,"Go Up a Level (never to 10)."),
 ("Boil an Anthill",1,"Go Up a Level (never to 10)."),
 ("Bribe GM With Food",1,"Go Up a Level (never to 10)."),
 ("Convenient Addition Error",1,"Go Up a Level (never to 10)."),
 ("Invoke Obscure Rules",1,"Go Up a Level (never to 10)."),
 ("Mutilate the Bodies",1,"Go Up a Level (never to 10)."),
 ("Potion of General Studliness",1,"Go Up a Level (never to 10)."),
 ("Whine at the GM",1,"Go Up a Level (never to 10). Not if you're the leader."),
]
```

## Appendix B: `munchkin/munchkin.py`

```python
#!/usr/bin/env python3
"""Munchkin game engine. State lives in state.json next to this file.

  new HUMAN RIVAL [RIVAL...]       shuffle decks, deal 4 Door + 4 Treasure to everyone
  show [VIEWER]                    full state; VIEWER sees own hand, others as Door/Treasure counts
  rivals                           one-line-per-rival summary (level, table, hand counts by back)
  draw door|treasure N DEST        DEST: play | PLAYER.hand | PLAYER.equipped | PLAYER.carried
  move "CARD" FROM TO              zones: PLAYER.hand/equipped/carried/curses, play,
                                   discard_door, discard_treasure
  level PLAYER +N|-N|=N            (never below 1)
  die PLAYER                       mark dead (loot first with move, then this discards the rest)
  revive PLAYER                    clear dead flag and deal 4 Door + 4 Treasure
  turn PLAYER                      set whose turn it is
  roll [N]                         N six-sided dice
  text "CARD"                      card text
  log TEXT...                      append to the game log
  check PLAYER                     hand-limit check (5, Dwarf 6)
Every change rewrites game_state.md (the human player's view).
"""
import json, os, random, sys
from cards import DOORS, TREASURES

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, "state.json")


def expand(lst):
    out, text = [], {}
    for name, n, t in lst:
        for i in range(n):
            nm = name if i == 0 else f"{name} ({i + 1})"
            out.append(nm)
            text[nm] = t
    return out, text


DOOR_LIST, DTEXT = expand(DOORS)
TRE_LIST, TTEXT = expand(TREASURES)
TEXT = {**DTEXT, **TTEXT}


def back(card):
    return "Door" if card in DTEXT else "Treasure"


def load():
    with open(STATE) as f:
        return json.load(f)


def save(s):
    with open(STATE, "w") as f:
        json.dump(s, f, indent=2)
    with open(os.path.join(HERE, "game_state.md"), "w") as f:
        f.write(f"# Munchkin: {s['human']}'s view\n\n```\n{render(s, s['human'])}\n```\n\n## Log\n")
        f.writelines(f"- {l}\n" for l in s["log"])


def zone(s, z):
    if z in ("play", "discard_door", "discard_treasure", "deck_door", "deck_treasure"):
        return s[z]
    p, part = z.split(".")
    return s["players"][p][part]


def draw_one(s, kind):
    deck, disc = (s["deck_door"], s["discard_door"]) if kind == "door" else (s["deck_treasure"], s["discard_treasure"])
    if not deck:
        deck.extend(disc); disc.clear(); random.shuffle(deck)
        s["log"].append(f"{kind.title()} deck reshuffled from discards.")
    return deck.pop()


def hand_counts(hand):
    d = sum(1 for c in hand if back(c) == "Door")
    return f"{len(hand)} cards ({d} Door, {len(hand) - d} Treasure)"


def limit(p):
    return 6 if any(c.split(" (")[0] == "Dwarf" for c in p["equipped"]) else 5


def render(s, viewer=None):
    o = [f"Turn: {s['turn']}   Door deck {len(s['deck_door'])} | Treasure deck {len(s['deck_treasure'])}",
         f"Top Door discard: {s['discard_door'][-1] if s['discard_door'] else '-'}   "
         f"Top Treasure discard: {s['discard_treasure'][-1] if s['discard_treasure'] else '-'}"]
    if s["play"]:
        o.append(f"In play (combat): {', '.join(s['play'])}")
    for name, p in s["players"].items():
        o.append(f"\n{name}: Level {p['level']}{'  (DEAD)' if p['dead'] else ''}")
        o.append(f"  Equipped: {', '.join(p['equipped']) or '-'}")
        o.append(f"  Carried:  {', '.join(p['carried']) or '-'}")
        o.append(f"  Curses:   {', '.join(p['curses']) or '-'}")
        if viewer is None or viewer == name:
            o.append(f"  Hand:     {', '.join(p['hand']) or '-'}  [{len(p['hand'])}/{limit(p)}]")
        else:
            o.append(f"  Hand:     {hand_counts(p['hand'])}")
    return "\n".join(o)


def deal(s, p):
    for _ in range(4):
        s["players"][p]["hand"].append(draw_one(s, "door"))
    for _ in range(4):
        s["players"][p]["hand"].append(draw_one(s, "treasure"))


def main(a):
    cmd = a[0] if a else "show"
    if cmd == "new":
        human, rivals = a[1], a[2:]
        d, t = DOOR_LIST[:], TRE_LIST[:]
        random.shuffle(d); random.shuffle(t)
        s = {"human": human, "deck_door": d, "deck_treasure": t, "discard_door": [], "discard_treasure": [],
             "play": [], "turn": human, "log": [f"New game: {human} vs {', '.join(rivals)}."],
             "players": {n: {"level": 1, "dead": False, "equipped": [], "carried": [], "curses": [], "hand": []}
                         for n in [human] + rivals}}
        for n in s["players"]:
            deal(s, n)
        save(s); print(render(s)); return
    s = load()
    if cmd == "show":
        print(render(s, a[1] if len(a) > 1 else None))
    elif cmd == "rivals":
        for n, p in s["players"].items():
            if n == s["human"]:
                continue
            print(f"{n}: L{p['level']} | equipped: {', '.join(p['equipped']) or '-'} | carried: "
                  f"{', '.join(p['carried']) or '-'} | curses: {', '.join(p['curses']) or '-'} | hand: {hand_counts(p['hand'])}")
    elif cmd == "draw":
        kind, n, dest = a[1], int(a[2]), a[3]
        for _ in range(n):
            c = draw_one(s, kind); zone(s, dest).append(c); print(f"{c}: {TEXT.get(c, '')}")
        save(s)
    elif cmd == "move":
        zone(s, a[2]).remove(a[1]); zone(s, a[3]).append(a[1]); save(s); print(f"{a[1]}: {a[2]} -> {a[3]}")
    elif cmd == "level":
        p = s["players"][a[1]]; v = a[2]
        p["level"] = max(1, int(v[1:]) if v[0] == "=" else p["level"] + int(v)); save(s)
        print(f"{a[1]} is Level {p['level']}")
    elif cmd == "die":
        p = s["players"][a[1]]
        keep = [c for c in p["equipped"] if TEXT.get(c, "").startswith(("Race", "Class")) or c.startswith(("Half-Breed", "Super Munchkin"))]
        for c in [c for c in p["equipped"] if c not in keep] + p["carried"] + p["hand"]:
            (s["discard_door"] if back(c) == "Door" else s["discard_treasure"]).append(c)
        p["equipped"], p["carried"], p["hand"], p["dead"] = keep, [], [], True
        save(s); print(f"{a[1]} is dead; kept {keep}")
    elif cmd == "revive":
        s["players"][a[1]]["dead"] = False; deal(s, a[1]); save(s)
        print(", ".join(f"{c} [{back(c)}]" for c in s["players"][a[1]]["hand"]))
    elif cmd == "turn":
        s["turn"] = a[1]; save(s)
    elif cmd == "roll":
        print(" ".join(str(random.randint(1, 6)) for _ in range(int(a[1]) if len(a) > 1 else 1)))
    elif cmd == "text":
        print(TEXT.get(a[1], "(unknown card)"))
    elif cmd == "log":
        s["log"].append(" ".join(a[1:])); save(s)
    elif cmd == "check":
        p = s["players"][a[1]]; over = len(p["hand"]) - limit(p)
        print(f"{a[1]}: {len(p['hand'])}/{limit(p)}" + (f" -> {over} over: play cards or give to lowest-level player (discard if you are lowest)" if over > 0 else " OK"))
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
```