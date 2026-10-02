# Known issues

Confirmed defects and open gaps. A defect gets a failing regression test before it is fixed, and a
fixed defect stays on record with the test that guards it. Status is one of `confirmed`,
`test written` or `fixed`.

For the wider picture of what works, see [STATUS.md](STATUS.md).

## Fixed

### A — A crossbow shot and reload consumed two bolts

**Status:** fixed — `tests/unit/ammunition.test.ts` (13 tests)

Firing and reloading each decremented the ammunition pool, so one shot-and-reload cycle cost two
bolts. The player path also spent ammunition for any ranged weapon, bows included, which have no
chambered state, and drew from the first non-empty pool in key order rather than the chosen
ammunition type.

**Model.** `ammo` counts carried unfired bolts. Firing spends one and unchambers a Slow Reload
weapon. Reloading chambers a round that firing already paid for and spends nothing.

**Fix.** `src/services/Ammunition.ts` is the single authority for carrying, chambering and spending
rounds, and `ranged`, `reload`, `enemyRanged` and `enemyReload` all use it. Reloading is driven by
the weapon's Slow Reload effect rather than by a weapon id, so bows have no chambered state and
every crossbow has one. An `ammoType` payload selects the pool. The enemy path was already correct;
only the player path had diverged. Rule status: standard.

**Covered:** a shot plus a reload spends one bolt; firing unloaded; loaded with no reserve; reload
with no bolts; reload when already loaded; the last bolt; a requested ammunition type; a requested
type that is empty; the default pool; bows needing no reload; no second shot before reloading; enemy
fire and reload accounting.

### B — Full Moon permanently raised maximum Health

**Status:** fixed — `tests/unit/fullMoon.test.ts` (8 tests)

The potion wrote its +30 straight into base maximum Health. Expiry only removed the potion's entry,
White Honey cleared toxicity and potion effects but left the maximum raised, and a second dose
stacked the bonus permanently.

**Fix.** `src/services/TemporaryHealth.ts` records temporary maximum-Health bonuses against the
source that granted them, so a bonus can be removed exactly. Expiry and White Honey revoke it,
current Health clamps to the reduced maximum, and a second dose does not stack. Rule status:
standard for the bonus and its non-stacking.

**Simulator interpretation.** The reference does not say whether a second dose refreshes the timer.
This build refreshes the duration and keeps the bonus at +30. See [DECISIONS.md](DECISIONS.md) D9.

### C — The engine hardcoded one actor's name

**Status:** fixed — `tests/unit/genericActor.test.ts` (12 tests) plus an architecture guard

Generic simulation code branched on one character's id and embedded the name in narration, so the
engine required a specific character and blocked generic multi-actor combat. Confirmed sites
included the weapon-skill choice, silver damage, aim handling, death-state handling, combat
validation, action-resource spending, active Signs, bomb resolution and about twenty-five narration
strings.

| Was | Now |
| --- | --- |
| an id check deciding weapon skill | weapons declare `combatSkill`; actors with a flat `attack` use it, character sheets use skills |
| an id and weapon-id check gating silver damage | `weapon.silverDamage` against a silver-vulnerable target |
| an id check gating the aim bonus | any actor's `aim` value |
| an id check meaning "the human player" | `isPlayerControlled(actor)`, which is `control === 'PLAYER'` |
| the id as a literal target or actor id | `state.player.id` |
| a hardcoded name in narration | the actual actor's name and pronouns via `GrammarService` |

`tests/unit/architecture.test.ts` derives the forbidden ids from the character registry and fails the
build if any simulation file compares an id against one, so this cannot come back.

**Intentional gameplay change.** An AI-controlled copy of a registered character now fights with its
own skills. Previously only the literal id took the skill path, so a spawned copy attacked at a flat
base of 10 despite a Swordsmanship of 20. Default single-player combat is unchanged.

### D — Armor Piercing had its two levels swapped

**Status:** fixed — `tests/unit/damagePipeline.test.ts`

Both levels halve the armour value; the improved level additionally skips Damage Resistance. The
implementation had plain Armor Piercing skipping resistance without halving armour, so it did the
improved level's job and skipped its own. Rule status: standard.

**Intentional gameplay change.** Armor-piercing weapons are now better against armour and worse
against resistant creatures. No test had covered plain Armor Piercing, which is why it survived.

### E — A scenario's briefing leaked into the next plain encounter

**Status:** fixed — `tests/integration/scenarios.test.ts`

`scenarioOpening` writes `state.scenario` so the cockpit can show which set piece is being played,
and nothing cleared it. Starting a plain encounter afterwards left the previous scenario's name and
briefing attached to an unrelated fight.

**Fix.** `src/actions/scenarios.ts` subscribes to `combat:beforeStart` and clears the field. The
module that writes a field owns clearing it. Presentation only: no roll, cost or outcome was
affected.

### F — The battle map was wider than its panel

**Status:** fixed — verified by measurement in headless Chrome; there is no automated test, because the
suite runs without a DOM

The 48-tile field was drawn at a fixed 16 to 18 pixels a tile inside a panel that was narrower than
that, so at every common desktop width the right-hand 120 to 280 pixels of the battlefield sat behind
an internal horizontal scroll bar. At 1920 x 1080 the last seven or eight columns were out of sight.
The wide layout (palette beside the map) also began at 1600 pixels, where it left the map the least
room of any width.

**Fix.** The map wrapper is now a CSS size container and the tile edge is derived from the room it
has, between 11 and 18 pixels, so the whole field fits. The wide layout starts at 1800 pixels. Below
761 pixels the tiles stay a fixed 18 pixels and the map pans, because a shrunken field is too small
to tap. Measured in headless Chrome: the whole field is visible from 1280 x 720 to 2560 x 1300; at 820
pixels wide the field still pans, and at 1024 only a few pixels of padding scroll.

### G — Smaller presentation defects

**Status:** fixed — presentation only, no combat outcome involved

| Defect | Fix | Guard |
| --- | --- | --- |
| A hero whose people and calling share a name showed it twice ("Witcher Witcher") on the premade card and the sheet. | One `callingLabel` helper in `CharacterBuilder`. | `characterPanel.test.ts`, `playerCharacter.test.ts` |
| The vitals bar carried a fixed fifth gauge (a shield) that no rule fed. | Removed, with its style. | none (legacy view) |
| A diagnostics label still said the grid owns "exactly 384 nodes" after the grid grew to 1,536. | The label says "one node per tile"; the check itself already compared against the grid size. | the diagnostics panel |

### Also fixed, recorded as decisions

| Defect | Where |
| --- | --- |
| Dragons never flew and nekkers, trolls and cyclopes never threw stones: the AI offered actions the gateway did not know. | D28 |
| A failed bomb throw did nothing instead of scattering, and the thrower could not be caught in the blast. | D29 |
| Mages had no Spell Casting skill, a third had no attack spell, and every damaging spell scored the same. | D30 |
| Ranged sides deployed at the far edge, outside their own reach. | D31 |
| The river generator's axis was inverted; composed monsters never received their `creatureKey`; Charge could not path to its target; two tooltips were written to each tile. | [HISTORY.md](HISTORY.md#a-real-battlefield-and-monsters-that-fight-like-monsters) |

## Open

### Rules

| # | Issue | Effect |
| --- | --- | --- |
| R1 | Broadhead and Bodkin ammunition can be chosen and are spent, but their effects (bleeding, armour piercing) are not applied to the shot. | Choosing an ammunition type has no combat effect beyond the count. |
| R2 | The melee and ranged validators check that a weapon is registered and of the right class, but not that the hero carries it. | Reachable only through a hand-built action payload; the attack panel offers carried weapons. |
| R3 | Critical-wound and blind penalties apply to a fixed list of skills in `src/services/Skills.ts`. | Weapon skills outside the list (Archery, Melee, Small Blades, Staff/Spear) ignore those penalties. |
| R4 | The Devil's Puffball is described as doing double poison damage. | The simulation applies the ordinary Poisoned condition and does not double it. |
| R5 | Armour encumbrance (EV) is stored in the armour table. | It is not applied to any roll. |
| R6 | Weapon table entries for the battle axe, berserker axe, war bow, mace and highland mauler were flagged for a second pass against the reference rules. | Not yet re-checked, so not known to be wrong. |

### Magic and the creator

| # | Issue | Effect |
| --- | --- | --- |
| M1 | Magic Screen and Mirror Ward have no damage and no effect. The AI declines to cast them. | A real warding effect is content work. |
| M2 | Mage and Priest magic is not simulated for heroes; only the five basic Signs are. | The creator marks it "not simulated". |
| M3 | Perks the creator tags "narrative" (languages, social standing, lifepath colour) do not touch combat. | By design for now; the tag keeps it honest. |

### Architecture

| # | Issue | Effect |
| --- | --- | --- |
| A1 | Identity branches remain: black-dragon armour handling in `src/services/Damage.ts` checks the creature's kind and variant, `resolveBomb` in the legacy bridge picks special bomb effects by item name, and `mageSpellsForSchool` in the bridge holds spell lists by school. | Breaks ground rule 8; should become data. |
| A2 | The legacy bridges still hold most actions, the AI, `CombatFlow` and encounter composition. | See [MIGRATION.md](MIGRATION.md). |
| A3 | The kernel audit has no circular-dependency detection. | A cycle would not fail CI. |
| A4 | Some presentation handlers still write combat state directly. | Listed in [MIGRATION.md](MIGRATION.md) under Step 12. |

### Not verified

These are not known to be broken; they have simply not been measured. They are recorded so nothing is
claimed that was not run.

- Browsers other than Chrome.
- The battle view on phones and tablets. Below 1181 pixels the layout is the compact one and the map pans sideways; it has not been tuned. The Hero tab was checked at 390 pixels in headless Chrome (no horizontal overflow, no console errors) but not on a real device.
- Balance across the full creature roster. Bombs and mages were measured; most matchups were not.
- Runtime performance on low-end hardware.
- Keyboard and screen-reader use.
