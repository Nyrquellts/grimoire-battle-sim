# Decisions

Append-only. Each entry records what was decided, why, and what it affects. Where an early entry
referred to source material or tooling that is not part of this repository, it has been reworded;
the decisions themselves are unchanged.

---

## D1 — Production minifier is `oxc`, not `esbuild`

**Date:** 2026-08-19 · **Area:** build

`vite.config.ts` requested `minify: 'esbuild'`, but Vite 8 bundles rolldown/oxc and does not ship
`esbuild`, so `npm run build` failed with `Cannot find package 'esbuild'`. Switched to `minify: 'oxc'`,
the bundled minifier. No effect on gameplay or output filenames.

---

## D2 — Simulation self-checks live in the kernel, not the browser

**Date:** 2026-08-19 · **Area:** testing, presentation

171 behavior contracts existed only inside `CompatibilityPresentation.ts`, reachable only by opening
`index.html#selftest`. They were simulation contracts, not presentation concerns, so 167 of them
moved to `src/testing/SelfChecks.ts` (browser-free) and are executed by `tests/unit/selfChecks.test.ts`.
The four that genuinely inspect the DOM stayed in the UI.

Both consumers share one list, so there is no duplicated implementation. Effect: the suite went
from 19 to 187 tests and the presentation bridge shrank by 212 lines. Check bodies were moved
verbatim; only type annotations were added.

---

## D3 — `ActionGateway.validate` annotates its state parameter explicitly

**Date:** 2026-08-19 · **Area:** core

The third parameter was typed only by its default initializer (`state = this.#store.read()`), which
left `TState` uninstantiated for external callers: every call passing a state failed to typecheck
with *"IState is not assignable to TState"*. Annotating it `state: TState = this.#store.read()`
fixed 13 errors at once. Runtime behavior unchanged.

---

## D4 — `IActor` and `IState` declare their real fields

**Date:** 2026-08-19 · **Area:** types

Both interfaces carried `[key: string]: unknown`, so every legacy field read as `unknown` and no
consumer could be written in strict TypeScript. The fields the simulation actually uses are now
declared and grouped (identity, combat, equipment, alchemy/signs, special, metadata), with new
supporting types `ICriticalWound`, `IDeathState`, `IRetreatState`, `IActorAi`, `IFeedEntry`.

The index signature stays for fields not yet declared, and is marked as only ever shrinking. Shapes
were taken from `createPlayer()` and `baseActor()` in the runtime, so the declarations describe what
is actually built. Purely additive: no runtime change.

---

## D5 — Registry rows carry one documented loose type

**Date:** 2026-08-19 · **Area:** data, types

`RegistryHub`'s 30 content maps had no declared fields at all, so `Registry.weapons` did not exist
on the type. Fields are now declared as `Map<string, RegistryEntry>`, where `RegistryEntry` is
`{ id: string; [field: string]: any }`.

This is the project's one deliberate content-layer `any`. Registry content is genuinely
heterogeneous per kind and is schema-validated on insertion; per-kind interfaces (`Weapon`,
`BestiaryEntry`, `Sign`, …) arrive with the `Registry<T>` + Zod migration, which retires
`RegistryHub` and this type with it. It is greppable by name and tracked by `npm run metrics`.

---

## D6 — Nested `ActionGateway` execution queues instead of re-entering

**Date:** 2026-08-19 · **Area:** core

`execute()` had an `allowNested: true` escape hatch that let a caller re-enter the gateway while a
transaction was open. That is unsound: the inner action checkpoints and commits against a store the
outer transaction has not yet written, and an outer rollback cannot undo the inner action.

The hatch is removed. An action requested while a transaction is open is queued and runs after the
current transaction commits, in request order. Rejections, rollback, and post-commit errors are
covered by `tests/unit/actionGateway.test.ts`. No caller used `allowNested`.

---

## D7 — Post-commit failures never roll back committed state

**Date:** 2026-08-19 · **Area:** core

`execute()` wrapped the post-commit `action:after` emission and the store notification in the same
`try` as the transaction, so a presentation or observer error rolled back a legal, completed combat
action — the simulation could be undone by a rendering bug.

Commit is now a hard boundary. Failures before it roll back; failures after it are reported through
`action:postCommitError` and leave game state committed.

---

## D8 — One ammunition model, driven by the Slow Reload effect

**Date:** 2026-08-19 · **Area:** rules, services · **Rule status:** standard

`ammo` counts carried **unfired** rounds. Firing spends one and unchambers a Slow Reload weapon;
reloading chambers a round that firing already paid for and spends nothing. This is the model the
enemy path already used; only the player path had diverged into a double spend.

Reloading is gated by the weapon's `Slow Reload` effect rather than by a weapon id, because the
effect is what the rule is about. Bows therefore have no chambered state and every crossbow has one.

`src/services/Ammunition.ts` is the sole implementation, used by `ranged`, `reload`, `enemyRanged`,
and `enemyReload`. It takes a weapon-lookup callback instead of importing the registry, so it stays
dependency-free and directly testable.

---

## D9 — A second Full Moon refreshes the duration and does not stack

**Date:** 2026-08-19 · **Area:** rules · **Rule status:** standard (no stacking) plus an interpretation (timer)

The reference rule is that the potion's bonus does not stack with itself. It does not say whether a
second dose refreshes the timer. This build refreshes the duration and keeps the bonus at +30; the
second dose still costs a dose, an Action, and 75 toxicity.

Classified as a **simulator interpretation** of an under-specified rule, not a standard rule. If the
reference is ever clarified, this is the place to change.

---

## D10 — Temporary maximum Health is a revocable ledger, not a rewritten base stat

**Date:** 2026-08-19 · **Area:** services

Writing a bonus straight into `maxHp` loses the information needed to take it back, which is why
Full Moon became permanent and stacked. `src/services/TemporaryHealth.ts` records each bonus
against its source so it can be revoked exactly.

`maxHp` still stores the *effective* maximum rather than being derived on read: simulation state is
plain data that is structured-cloned at every transaction boundary, and a getter would not survive
cloning. `baseMaxHealth(actor)` recovers the base value at any time. The mechanism is generic —
nothing in it is Witcher-specific.

---

## D11 — Combat branches on actor data, never on actor identity

**Date:** 2026-08-19 · **Area:** entities, services, ui

Rules asked "is this Nikhail?" when they meant "is this the human-controlled actor?", "does this
actor have skills?", or "does this weapon carry silver?". Those are all data questions, and asking
them by name made the engine require one specific character.

`isPlayerControlled(actor)` (`control === 'PLAYER'`) and `usesSkillBasedCombat(actor)`
(`attack == null`) now carry those meanings, weapons declare `combatSkill` and `silverDamage`, and
narration uses the actual actor with `GrammarService` pronouns.

`tests/unit/architecture.test.ts` derives the forbidden ids from the character registry, so
registering a new named character automatically protects it too.

---

## D12 — `RegistryHub` moved to `src/data`

**Date:** 2026-08-19 · **Area:** data

The content hub and its 30 per-kind validators lived inside the simulation bridge, mixing content
storage with combat rules and forcing the bridge to grow whenever content types were declared.
They now live in `src/data/RegistryHub.ts` as strict TypeScript.

This is a step toward, not a substitute for, the Phase 6 goal: fold these tables onto the generic
`Registry<T>` with Zod schemas and delete `RegistryHub` entirely.

Moved verbatim apart from type annotations. Net effect: the bridge lost 195 lines against baseline.

---

## D13 — Shared kernel singletons live in `src/core/kernel.ts`

**Date:** 2026-08-19 · **Area:** core

`Pipeline`, `Random`, and `Dice` were created inside the simulation bridge, so every service that
needed to roll a die or emit an event had to import the bridge — which is precisely what the
migration is trying to end. They now live in one small module that services import directly.

No container, locator, or injection framework: three module-level values. The kernel is the one
place allowed to hold shared mutable simulation singletons, and presentation must never draw from
`Random`.

---

## D14 — Extracted systems take content as a dependency, not as an import

**Date:** 2026-08-19 · **Area:** services

`ConditionSystem`, `EquipmentSystem`, `DamageResolver`, and `DefenseResolver` are classes that
receive what they need — a condition table, a weapon lookup, the critical-wound tables — rather than
importing Witcher content. The Witcher wiring happens in one place, and swapping the content swaps
the game without touching the rules code.

`tests/unit/damagePipeline.test.ts` is the proof: it resolves damage and defense while importing no
Witcher content and no bridge module. If that file ever needs them back, the extraction regressed.

One rule resisted this: some statuses suppress regeneration (Moon Dust). Rather than name it inside
the generic condition system, the host declares `regenerationBlockers` when constructing it.

---

## D15 — Damage does not call AI; it announces

**Date:** 2026-08-19 · **Area:** services

The damage pipeline called `DeathStateTacticsService.prepare()` directly when a dying actor passed
its save — a rules service reaching down into AI. It now emits `deathSave:passed` and the AI layer
subscribes. Same work, same ordering, one less downward dependency.

---

## D16 — Sign resolution dispatches on content, not on Sign id

**Date:** 2026-09-08 · **Area:** actions

`resolveSign` was a chain of `sign.id === 'aard' || sign.id === 'aardSweep'` comparisons, so every
Sign needed a branch in rules code — exactly the lore-in-the-engine problem ground rule 8 exists to
prevent. Sign rows now declare a `resolver` (`force`, `flame`, `ward`, `shield`, `zone`, `dominate`,
`utility`) plus the numbers that resolver reads, and `src/actions/signs.ts` dispatches on the data.

The values reproduce the reference Signs exactly. Adding two advanced Signs, Somne and Supirre,
needed no rules code at all, which is the test of whether the change worked.

The self-check that asserted "exactly ten Signs" became a floor plus a new check that every Sign
declares a resolver — a fixture that fails when content is *added* is testing the wrong thing.

---

## D17 — Sign augments are house content, bounded by the rules' own economy

**Date:** 2026-09-08 · **Area:** content, magic

The brief called for magic that can be mixed and enhanced "within reason". The reference system has
no rule for modifying a Sign mid-cast, so augments are **house** content and say so in every row
(`ruleStatus: 'house'`), per [CONTENT_POLICY.md](CONTENT_POLICY.md).

"Within reason" is enforced by rules the system already has rather than by a special case:

- every augment costs STA, so weaving competes with raw investment for one budget;
- the total is measured against the Vigor Threshold, and past it the caster pays 5 HP per point;
- `exclusiveGroup` stops variants of one idea stacking, and a cast carries at most two;
- the cross-family augments require a battlefield precondition — a zone, a condition — so they
  reward setup instead of being free damage.

Augments are declarative: `effects` are additive numbers the resolver already reads. An augment
cannot introduce behavior, which is what keeps "invent your own magic" from becoming "write your own
rules". Authored augments loaded from a pack are held to the same bounds by
`ContentPack`'s schema, which caps every field and refuses `ruleStatus: 'official'`.

What was implemented from the reference system rather than invented: magical focuses and the
one-focus-at-a-time limit, Greater Focus, the magic fumble table and the elemental fumble effects,
and dimeritium lowering the Vigor Threshold by 1 per unit.

---

## D18 — Authored content arrives through one validated path

**Date:** 2026-09-08 · **Area:** data

Characters, scenarios, and custom augments are added as **content packs**: plain JSON validated by
Zod at the boundary before anything reaches the registry. The Forge's character form, the paste box,
and a file in `src/data/packs/` all funnel through `loadContentPack`, so a form can never register a
row a hand-written pack could not.

Loading is additive and non-destructive. An id that already exists is skipped and reported rather
than overwritten — silently replacing a built-in creature with a custom one is the drift
[CONTENT_POLICY.md](CONTENT_POLICY.md) exists to prevent.

This is **not** a save system, and the no-persistence rule stands. Nothing writes to disk or to
browser storage; a pack is authored, exported as text, and pasted back or committed to
`src/data/packs/`.

---

## D19 — Bridge size is measured in code characters, not only lines

**Date:** 2026-09-08 · **Area:** tooling

Lifting the Sign action out of `SimulationRuntime.ts` removed ~4.9 KB of logic and *raised* the file's
line count by 28, because the legacy code is minified onto very long lines while the replacement
wiring block is readable.

Reflowing the wiring to protect the number would have repeated an earlier mistake in reverse
(folding declarations onto dense lines to hold a count down; see [HISTORY.md](HISTORY.md)), so
`npm run metrics` now also reports executable characters per bridge (comments and string literals
stripped). That number cannot be gamed by reflowing in either direction. The line counts stay, since
they still describe the file's readability.

Extracting from a minified bridge is expected to move lines up and characters down. Judge the
characters.

---

## D20 — The grid is configurable, and one tile is one metre

**Date:** 2026-09-08 · **Area:** services

The field was a fixed 24x16, with the dimensions hardcoded in `GridService`, the tile schema, and
three CSS breakpoints. At one metre per tile that is a 24 m x 16 m battlefield — smaller than a
crossbow's 50 m range and crossable in two turns by anything with SPD 8. Range bands, preferred
range, ranged AI profiles, and escape routing were all being decided on a field too small for any
of them to matter.

`GridService` now holds its dimensions in a module record with a `configure()` guard (8-128 per
side), and the default is **48x32**. Everything downstream already read `GridService.SIZE`, so the
change was contained; `DirtyTileService` regrows its version buffer, the tile schema checks shape
rather than a fixed length of 384, and the CSS reads `--grid-w`/`--grid-h` published by the
renderer.

Actor placement moved to `DeploymentService` for the same reason: `{x: 4, y: 8}` and a hardcoded
spawn column only worked at one size.

---

## D21 — Terrain is content; the battlefield is a recipe

**Date:** 2026-09-08 · **Area:** data, services

Battlefields were hand-placed coordinate lists inside the bridge — `for(let y=2;y<14;y++) wall(11,y)`
— which meant every environment was the same every time, none of them survived a resize, and the
`terrain` registry existed but nothing read it.

Now:

- **`src/data/content/terrain.ts`** holds terrain rows: movement cost, cover SP, what they block,
  and declarative combat effects. Cover values follow the reference cover table. Effects follow the
  reference environmental rules: swamp -2 Dodge/Athletics; deep water -2 melee, ranged range
  quartered and damage halved, Athletics for dodging; ice and snow call for a DC:14 Athletics roll
  once the actor has run or attacked. Movement cost per tile is marked `adaptation` — the reference describes
  terrain qualitatively and a tile grid has to put a number on it.
- **`src/services/Battlefield.ts`** is a generic shape library — river, road, ruins, camp, graves,
  ridge, cluster, patches, wall — that paints whatever terrain a recipe names, using the seeded
  kernel RNG so a battlefield varies between fights and replays exactly from a seed.
- **`src/data/content/battlefields.ts`** is the recipes. Seventeen of them, including the six new
  ones the shape library made cheap: river crossing, boulder field, abandoned camp, drowned marsh,
  graveyard, frozen lake.
- **`src/services/TerrainRules.ts`** applies the effects through the existing `attack:modifier` and
  a new `defense:modifier` event, so combat resolution never learns what ground it is on.

Two invariants the builder enforces, because a battlefield that breaks them is unplayable: the two
deployment zones stay mutually reachable (it carves the narrowest crossing it can find until they
are), and obstacles never spawn where combatants will stand.

Feature counts scale with map area, so resizing the field changes how *large* a battlefield is
rather than how dense.

---

## D22 — Monsters get their own abilities, as data

**Date:** 2026-09-08 · **Area:** data, actions, AI

Every creature was a stat block that walked forward and bit. A wraith fought like a bandit with
claws; a noonwraith could be killed with a steel sword; a griffin never used the air. The
`abilities` field on bestiary rows held *vulnerabilities* ("Necrophage Oil", "Fire"), not
behaviour, and the only creature with real tactics was the dragon, hardcoded as
`enemy.exceptional === 'dragon'`.

The reference system gives every monster a list of abilities. Those are now content:

- **`src/data/content/creatureAbilities.ts`** — the ability table, each row carrying its rule
  status. Charge is -4 for 10d6 with an 8 m knockback; Sonic Screech is a Stun save at -1 within
  10 m; Incorporeal means physical attacks do nothing. A lookup table maps bestiary ids to ability
  ids — the one place a creature is connected to its behaviour.
- **`src/services/CreatureAbilities.ts`** — generic availability, cooldowns, and passive expansion.
- **`src/actions/creatures.ts`** — one `enemyAbility` action with a resolver per `kind`, so a new
  charging monster is a content row rather than a new action.

**Passives are translated, not special-cased.** `poisonImmune` becomes an entry in
`actor.immunities`, which `ConditionSystem.add` has always honoured; `regenerate` becomes
`actor.regen`; `fueledByRage` becomes `morale.fearImmune`. Nothing new had to learn about abilities
for a standard passive to work.

**Abilities are ordinary AI candidates.** They go through the same utility scorer as attacking and
moving, mapped onto the action vocabulary the profile weights already use, so a griffin still bites
when charging scores worse. Ground rule 8 holds: the AI never names a creature.

The counter matters as much as the ability. A wraith is immune to steel *until* Yrden forces it to
materialise, which is the interaction the rules describe — `attachRules` puts both halves in one
place.

---

## D23 — Terrain affinity is how a monster fights where it belongs

**Date:** 2026-09-08 · **Area:** AI

Drowners are amphibious and live in and around water, but the AI scored
every tile the same way for everyone. `terrainAffinity` in `src/services/AiTactics.ts` reads the
tile's terrain effects and the actor's `waterNative` tag: a water-native creature *gains* where
water would penalise anyone else, and everything else avoids ground that costs it movement or
defense.

That single number is why a drowner now fights from the shallows, and why dragging one onto dry
land is worth doing. It names neither a creature nor a terrain.

---

## D24 — Creature statistics follow the reference system, and are held as data

**Date:** 2026-09-08 · **Area:** data

Every creature in the simulator was an *approximation* of its stat block in the reference system.
Measured across 63 profiles: none had a skill list, none had VIGOR or LUCK, 58 had no STA or REC, 18
were missing EMP and CRA, and the values that were present drifted — the drowner's claws were `2d6+2`
where the reference gives `3d6`, and its attack was a flat 14 where REF 7 + Melee +6 gives 13.

That mattered more than it looks. The tabletop system is already balanced; approximating it throws
that away and replaces it with numbers nobody tuned.

The fix was to bring the numbers up to the reference rather than to judge them. Stat blocks are data
in two files, because the reference lays monsters out in two different ways:

- `src/data/raw/coreBestiaryStats.ts` gives monsters *skills* and no to-hit numbers, so attack and
  defense are derived with the system's formula (`stat + skill`);
- `src/data/raw/supplementBestiaryStats.ts` gives `Dodge Base`, `Block Base` and a per-attack
  `ATK Base` outright, so nothing is derived there.

**The stat-block files hold only the numbers a stat block carries.** Family, AI profile, loot
tables, silver vulnerability and engine flags stay in `witcherData.ts` and are merged with the stat
blocks at registration. That split is the point: a wrong number is either a data bug or a project
choice, and which file it lives in tells you which.

**Nothing is invented.** A construct's Stamina is `null`, which is data rather than a hole, and the
rules read it as "does not tire". Two creatures, the True Dragon and the Higher Vampire, are authored
rather than overlaid, because they carry hand-built attack definitions that the encounter, variant
and defeat systems key on and their numbers already match; the integrity suite holds them to the
reference numbers with a spot check. Bear and great bear still share one profile, a known limitation
recorded in the suite rather than hidden.

`tests/unit/bestiaryIntegrity.test.ts` spot-checks hand-typed literals for several creatures, so a
block that ends up in the wrong column or row fails against a human-typed value rather than against
itself, and it checks that the blocks actually reach the registry.

---

## D25 — Passives are derived from the stat block where it allows it

**Date:** 2026-09-08 · **Area:** data

The core stat blocks list abilities for every creature. The supplement blocks mostly do not: they
encode the same information in the attack Effect column, the Regeneration line, and the Immunities
list. Hand-listing abilities for those creatures would have meant reading the same numbers twice and
letting the two copies drift.

`derivedAbilities` reads them back instead: a Regeneration value becomes `regeneration`, an
Immunities entry becomes `poisonImmunity` or `bleedImmunity`, an attack whose Effect says Crushing
Force becomes `crushingForce`. It cannot drift from the stat block, and a creature added later gets
its passives without anyone remembering to.

What is left is mapped by family with the creature's own stat block as the justification — a fire
elemental gets `crushingForce` because its Punch says so, and `fueledByRage` because a summoned
construct has nothing to frighten. The module header says plainly which rows are derived and which
are characterised, because those are different kinds of claim.

**Some creatures have no abilities on purpose.** A mage's threat is its spell list and its cognition
tier, and the reference gives it no monster abilities; an empty list there is a statement rather
than an omission.

**Some tags are descriptive and say so.** `feral`, `pounce`, `scentTracking` and `longReach` are
recorded and consumed by nothing: a tactical simulator with full information has no surface for
tracking by scent or leaping without a run-up. Faking a mechanic for them would have been worse than
admitting it. `unparryable` was the opposite case — half of Crushing Force (double armour ablation)
*is* modellable, so that half is implemented and the unparryable half is documented as having no
surface.

---

## D26 — Intelligence is what makes an enemy dangerous, and it is gated by tier

**Date:** 2026-09-08 · **Area:** AI

Every creature scored the fight the same way. A drowner, which has the wits of a bottom-feeder and
never plans beyond closing and biting, weighed cover and target priority exactly as carefully as a
higher vampire.

`tacticalInsight` in `src/services/AiTactics.ts` adds the judgements a thinking opponent would make,
each one gated on cognition tier:

| Tier | What it can work out |
| --- | --- |
| 2 | a ward standing on the target makes an attack worth less; an opening is worth committing to |
| 3 | height helps a shot, hazards are worth leaving, and a losing fight is worth breaking off |
| 4 | a target out of Stamina cannot cast, and a wounded one is worth finishing |
| 5 | being outnumbered means buying time; having a pack means pressing |

Gating by *tier* rather than by creature keeps ground rule 8 intact — nothing in the AI names a
monster. The effect is visible immediately: with Quen up, a higher vampire scores "target is warded"
and hesitates while a drowner charges anyway; at 20 Health the vampire repositions and the drowner
keeps swinging.

Every adjustment carries a label rather than folding into a number, because the AI debug panel's
explainability is a feature and a silent heuristic is not debuggable.

---

## D27 — A hazard declares what it threatens; an actor declares what it is

**Date:** 2026-09-08 · **Area:** AI, data

`AITacticalState.zoneRisk` decided how much a creature should fear a tile by recognising both the
hazard and the creature:

```js
if (type === 'dimeritiumCloud' && (actor.mage || actor.exceptional === 'higherVampire')) risk += 24;
if ((type === 'yrden' || type === 'magicTrap')
    && (actor.family === 'Specter' || actor.family === 'Vampire'
        || actor.exceptional === 'higherVampire')) risk += 22;
```

Two ground-rule-8 violations in one function: it branched on zone id *and* on creature identity.
Adding a hazard meant editing the AI, and a new incorporeal creature would have walked into Yrden
without concern unless someone remembered to extend the family list.

Both sides are data now.

**Zones declare their threat**, beside the `applies` block that already made zone *effects*
content:

```ts
dimeritiumCloud: { …, threat: { risk: 24, threatens: ['magic'], susceptibleTo: ['Dimeritium'] } }
yrden:           { …, threat: { risk: 22, threatens: ['incorporeal'], susceptibleTo: ['Yrden'] } }
flame:           { …, threat: { risk: 28, negatedBy: 'ordinaryFire' } }
```

**Actors declare themselves through their own stat block.** `actorCapabilities` reads:

- `magic` from a declared caster, a Spell Casting skill, or an ability tagged `usesMagic` — which
  is how a higher vampire qualifies, through its Shift ability, rather than by name;
- `incorporeal` from the ability tag — Shift makes its user incorporeal, and Yrden is the counter;
- susceptibilities from the bestiary's own "Vulnerable To" column, which already names Yrden,
  Dimeritium and Fire. That column was sitting in the data unused.

**Behaviour is identical.** Every case the old branches covered produces the same number:
drowner/fire 28, drowner/poison 0, mage/dimeritium 24, higher vampire/dimeritium 24, higher
vampire/Yrden 22, wraith, noonwraith and katakan/Yrden 22, ghoul/Yrden 0. The integration suite
asserts each of them, so this was a refactor rather than a rebalance.

The test that matters most registers a *new* hazard mid-test and shows it threatening the right
creatures with no engine change at all. That is the property the violation was costing.

Two rules-level identity branches remain, both older and both larger: the dragon's hardcoded AI
block (`exceptional === 'dragon'`, 14 sites) and the higher vampire's regeneration-window scoring
(8 sites). The family checks that survive — picking an AI profile or a life-history generator by
family — are content composition, not rules, and are fine where they are.

## D28 — The last rules-level identity branches, and two capabilities that never worked

The dragon's AI block and the higher vampire's regeneration scoring were the two identity branches
D27 left standing. Removing them turned up something worse than the branches.

**What replaced each branch.** Every site now asks the actor a question it can answer from its own
data:

| Was | Is | Reach |
| --- | --- | --- |
| `exceptional === 'dragon'` sharpens cognition | `hasTag(actor, 'agesIntoPower')` and an Elder age band | The Long-Lived ability |
| `dragon \|\| higherVampire` steadies morale | `cognitionTier(actor) >= 5` | Exactly those two today |
| `higherVampire` plans a regeneration window | `regen > 0 && tier >= 4` | Adds the katakan, correctly |
| `dragon && breath` offers a breath attack | `enemy.breath` | Anything with a breath weapon |
| the dragon's whole action wrapper | gone; the three offers stand on their own | — |
| `name === 'flight'` scores vertical mobility | `tags.includes('flight')` | Any flier |

The morale line was checked before it was written: tier 5 is truedragon and highervampire and
nothing else, so that one is a rename, not a rebalance. The regeneration ones deliberately widen —
a katakan regenerates 5 a round and is clever enough to use it, and there was never a reason it
should not.

**The two dead actions.** With the identity wrapper gone, the offers underneath were visible for
the first time, and two of them named actions that did not exist:

- `enemyDragonFlight` — offered on every dragon turn, rejected by the gateway as an unknown action
  every time. **Dragons had never flown.**
- `enemyThrowRock` — offered by every nekker warband and giant brute at 3–12 m, same result.
  **Nekkers, trolls and cyclopes had never thrown anything.**

Both had self-checks. Both self-checks passed, because both asked only whether the AI *offered* the
candidate — never whether anything could dispatch it. An offer no gateway accepts is not a
capability, and a green check that asserts one is worse than no check.

Flight already existed properly as the `takeFlight` ability row, so the dead offer was deleted
rather than implemented, along with the `dragonFlightTile` helper it was the only caller of. The
thrown stone did not exist at all, so it became a `thrownObject` resolver in `src/actions/creatures.ts`
and a `throwRock` row carried by nekker, troll, rocktroll and cyclops. Neither change added a line
to the bridge; the bridge lost three.

**The guard.** `tests/unit/architecture.test.ts` now reads every `add(name, score, 'actionName', …)`
in the AI's candidate builder and asserts the gateway has that action registered. It parses the call
arguments on nesting depth rather than by regex, because the scoring helper shares the name `add`
and a looser match reads a quoted string inside a scoring call as an action name. The two rewritten
self-checks now require the action to *validate*, not merely to be offered.

**What is left.** Twelve `exceptional ===` comparisons remain and all twelve pick content: an
anatomy id, an AI profile, a life-history generator, knowledge and voice keys, a reaction profile,
and one truthiness test for a power bonus. None of them changes a roll, a cost, or a decision.

## D29 — Bombs follow the rules, including the parts that hurt you

Bombs felt overpowered. Against the reference rules they mostly were not: a bomb hits every body
location for full damage dice each, and armour subtracts at every location. That spread is the
design — measured over 40 Grapeshots, a drowner (25 HP, no armour) is one-shot every time at an
average 63.9, a griffin (100 HP, 8 SP) takes 44.8, and a true dragon (150 HP, 25 SP) takes 7.9.
The bomb annihilates swarms and bounces off armour, as the rules intend.

Two things made ours stronger than the rules, and both are now fixed.

**A failed throw scattered instead of vanishing.** A failed Athletics check means the bomb lands off
target. Ours reported that no target was caught and did nothing, so a bomb was risk-free.
`CombatRules.scatter` now moves the burst 1d6 metres in a rolled direction and the bomb detonates
there. The reference's scatter table is a direction diagram rather than text, so the implemented
reading is the one the prose states wherever the table is referenced (fumbles, Disarm): 1d6 metres,
random direction. Distance is measured along the heading, so a diagonal scatter travels 1d6 metres
like any other rather than 1d6 on each axis.

**The thrower could not be caught.** `resolveBomb` filtered `state.enemies`, so the player could
stand 1 m from a Dancing Star and take nothing. The rules say everyone in the area is caught, and
they warn pointedly about catching your own side. Victims are now everyone attackable within the
radius of wherever the bomb actually landed.

Together these are what makes a bomb a decision rather than a free button.

## D30 — A mage that cannot cast is not a mage

Five mages could be beaten without taking a scratch. Three separate causes, none of them balance.

**They had no Spell Casting skill.** The archetype gave mages statistics and a spell list but never
the one skill their whole threat rests on, so `effectiveSkill(mage, 'Spell Casting')` fell through
to a default of 10 against a witcher's Dodge of 20. `enemyCast` had been papering over this by
rolling raw WILL+INT, which the casting rules do not support — a spell is resolved as a Spell
Casting roll the target defends against. Mages now carry Spell Casting scaled
by rank on the same scale as the rest of their sheet, and the action rolls it.

**A third of them had no offensive spell at all.** The Illusion/Mind and Healing/Warding schools
were entirely utility — 86 of 300 generated mages could not hurt anyone under any circumstances.
Each now carries one attack in keeping with its school.

**Every damaging spell scored the same.** The offer was a flat 82 with a flat expected damage of
16, so a 1d6 cantrip was as attractive as an 8d6 thunderbolt — and against 14 SP of armour the
cantrip cannot do anything at all. `AiTactics.spellCandidate` now scores a spell by the average of
its own damage dice, and a sharper mind reaches further up its list. The caster reads its own
spellbook and the distance between the two of them; it does not look at the target's armour or
inventory.

A fourth thing fell out of the same work: escape spells were offered at a flat 94 whenever anything
came within 4 m, which beat every attack, so a healthy mage teleported out every round and walked
back in. Blinking away is now scored by how hurt the caster is — below a good attack at full health,
above everything when nearly dead.

**Measured, same harness, 25 fights of five mages over ten rounds:** average damage to the player
19.8 → **40.2**, damaging hits 29 → **83**, from *fewer* casts (964 → 837). They are not casting
more; they are casting things that work.

Mage loadouts were also four-in-six melee weapons, which is why they closed to 2 m and died there.
A mage's weapon is a focus now in two thirds of cases, with a 12 m standoff. That does not show up
in the numbers above, which place the mages by hand, but it decides how a real engagement opens.

## D31 — A side deploys within its reach

Every enemy started in a band on the far edge of the field, about 39 m out. For a drowner that is
correct and is the fight: crossing the ground is what the encounter is about. For anyone who came
to shoot it was four rounds of walking before the fight began — a bow, a crossbow and almost every
spell the system offers all fall short of 39 m.

Deployment now pulls the enemy band in to the reach of the group's longest arm. The rule reads
`preferredRange`, which the loadout already sets and the AI already steers by, so nothing here asks
what an actor is: a mage with a focus (12) opens at about 16 m, an archer (16) at 20 m, and anything
whose only reach is its arms is left exactly where it was. Melee encounters are unchanged by
construction, which is why the guard test pins the far band for reach 2 and 6.

The band moves as a band. A warband deploys at its longest reach rather than each actor at its own,
because a shield wall that starts 26 m behind its own mage is not a warband — it is two encounters.
The band is only ever pulled closer, never pushed out, and never inside 12 m.

**Measured, 25 fights of five mages over ten rounds, natural deployment:** average damage to the
player 7.4 → **12.8**, first cast on round 3.8 → **round 1.5**, casts 192 → **340**.

Tracing that fight turned up one more defect worth recording. `Magic Screen` and `Afan's Mirror`
have no damage and no effects at all, so resolving them changes nothing — and because a range of 0
skipped the range check they were castable from anywhere, three mages spent an entire fight casting
Magic Screen every round. `spellCandidate` now declines any spell that would resolve into nothing,
read from the spell's own row rather than from a list of names. Giving those two a real warding
effect would be the better fix and is left as content work; declining a no-op is strictly better
than spamming one.
