# History

How the codebase reached its present shape, and what was learned on the way. For where things stand
today, read [STATUS.md](STATUS.md). For the reasoning behind individual choices, read
[DECISIONS.md](DECISIONS.md).

The project began as a working simulator whose engine, content and interface lived mostly in two very
large files. The work since has been to pull generic systems out of those files one at a time, keep
every existing behaviour intact while doing it, and add content and features on top of the cleaner
structure. Numbers below are the ones recorded when each stage finished.

## Test count over time

| Stage | Tests passing |
| --- | ---: |
| Baseline | 18 of 19 |
| Safety net | 187 |
| Gateway transactions | 204 |
| Defects A, B, C | 239 |
| Combat services | 262 |
| Signs and magic | 354 |
| Battlefields and abilities | 414 |
| Creature stats | 465 |
| Zone risk | 482 |
| Identity branches | 489 |
| Bombs and mages | 508 |
| Deployment | 515 |
| Hero creator and release preparation | 803 |

## Baseline (2026-08-19)

Verified against the code rather than the notes that came with it. Two documentation claims were
wrong: one described a working CI when the production build was broken, and one described a prebuilt
offline bundle that no longer applied.

| Gate | Result |
| --- | --- |
| kernel audit | pass |
| typecheck | pass |
| tests | 1 of 19 failed |
| build | failed |

- The test failure was a method extracted as a bare function, which lost its `this`.
- The build failure was a minifier option that Vite 8 does not bundle.
- 171 simulation regression checks were reachable only through a hidden browser URL.

## Safety net

Important behaviour could not be verified without a browser, so nothing could be moved safely. The
171 in-browser checks became a headless suite (167 migrated plus a registration guard), the build was
repaired, and the kernel audit was widened to cover `src/entities`, `src/data` and `src/testing`.
Check bodies moved verbatim. No gameplay changed.

## Gateway transactions

`ActionGateway` is the single entry point for every state change, so everything extracted later
depends on its transaction semantics. Two real defects were fixed, each after a failing test:

1. A caller could re-enter an open transaction, so an outer rollback could not undo the inner work.
   Requests made during a transaction are now queued and run in order after commit
   ([D6](DECISIONS.md)).
2. An observer or renderer error after commit rolled back a legal combat action. Commit is now a hard
   boundary, and post-commit failures are reported separately ([D7](DECISIONS.md)).

Rollback also discards work the failed transaction queued, queue growth is bounded by drained actions
rather than by queue length (bounding length still hung, which the loop test caught), and the
transaction depth is released in a `finally`.

## Defects A, B and C

Each followed the same order: reproduce, write a failing test, confirm it fails, fix, confirm it
passes, run the whole gate. The details are in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

- **A.** A crossbow shot and reload spent two bolts. `Ammunition.ts` became the single authority.
- **B.** Full Moon wrote its bonus into base maximum Health, so it never expired. `TemporaryHealth.ts`
  keeps a revocable ledger keyed by source.
- **C.** The engine branched on one character's id. Every identity branch left simulation and
  presentation code, and an architecture test now derives the forbidden ids from the registry and
  fails the build on any comparison.

`RegistryHub` and its validators also left the bridge in this stage ([D12](DECISIONS.md)).

## Combat services

Priority shifted to separating the generic tactical foundation from the setting's content, because
that boundary is what makes the rules replaceable. Damage, defence, attack, conditions, teams,
equipment, the combat log, critical wounds, hit locations and skills moved into their own modules,
verbatim apart from type annotations and wiring.

Extracted systems are classes that **receive** their content instead of importing it
([D14](DECISIONS.md)), and one block wires the setting's content in. `tests/unit/damagePipeline.test.ts`
resolves damage and defence while importing no setting content and no bridge module; if it stops
compiling, the boundary has leaked.

Defect D turned up while documenting the pipeline: Armor Piercing and Improved Armor Piercing had
their effects swapped. It was fixed test-first and recorded as an intentional balance change.

## Targeting, escape, zones, loot

`ActorState`, `Targeting`, `Escape`, `Zones` and `Loot` followed. Zone effects became content:
definitions carry `applies: [{ condition | status, duration }]`, so a new hazard is a registry row
rather than an edit to the zone service.

## Signs, magic and authoring

Sign validation, cost and resolution moved to `src/actions/signs.ts`, with generic cast planning in
`SpellCasting.ts` (focuses, Vigor, augments, fumbles). The presentation shell, Sign palette, Forge
panel, registry view, command parser and combat-feedback effects were built outside the legacy
bridge.

The simulation bridge's line count rose by 35 in this stage while its executable code shrank by
1,666 characters, because two minified lines were replaced by a readable block. That is why the
bridge metric is code characters, not lines ([D19](DECISIONS.md)).

## A real battlefield, and monsters that fight like monsters

The grid grew from 24 x 16 to 48 x 32 and became configurable. Battlefields became generated recipes
over a shape library, deployment replaced hardcoded spawn coordinates, terrain effects ride on
attack and defence modifier events, and creature abilities became data with cooldowns and passives.
Bugs found on the way:

- the river generator's axis was inverted, so a river ran along the fight instead of across it;
- composed monsters never received their `creatureKey`, so every lookup keyed on it returned nothing;
- Charge could not path to its target, so it "succeeded" without moving and landed a free attack
  from across the map;
- two tooltips were written to each tile, and the later one dropped the terrain name.

## Creature stats

Creature statistics were brought up to the reference system: at the end of the stage 61 of 63
creatures carried full stat blocks and 60 carried abilities. The two authored exceptions keep hand-built attack definitions that
the encounter, variant and defeat systems depend on; overlaying generated values on them broke four
self-checks and was reverted in favour of a spot check. This stage also fixed a drowner attack that
was wrong, a stub ability that set a status nothing read, and a new suite that shifted the shared dice
stream and broke a self-check four suites later.

## Zone risk, identity branches, dead actions

The last AI function that branched on both zone id and species became wiring over a data-driven
`AiTactics.zoneRisk`; zones carry a `threat` block. Six rules sites stopped asking what a creature
*is* and started asking what it *has* (cognition via the Long-Lived ability, regeneration via
`regen > 0`, breath attacks via a breath weapon, vertical mobility via the action's `flight` tag).
Removing the dragon wrapper exposed two AI offers naming actions nothing had registered: dragons
could not fly and nekkers could not throw, behind green self-checks that only asked whether the
candidate was offered. An architecture test now fails if the AI offers an action the gateway lacks
([D27](DECISIONS.md), [D28](DECISIONS.md)).

## Bombs, mages and deployment

Bombs now scatter on a failed Athletics check and catch everyone in the radius, the thrower
included ([D29](DECISIONS.md)). Mages gained the Spell Casting skill they never had, and spell choice
weighs a spell by its own damage dice instead of a flat score ([D30](DECISIONS.md)). Ranged sides
deploy within reach of their opponent instead of at the far edge ([D31](DECISIONS.md)).

## Hero creator and release preparation

- **Hero creator.** A Hero tab builds a character from a race, a profession, a stat method (point-buy
  at four power levels, or rolled), a skill and package budget, a starting kit and an appearance, and
  checks the result with a live build report. Heroes export and import as JSON, and a roster of
  premade characters seats any of them in a fight.
- **Content review.** Verbatim reference text, quotations, page citations and named canon characters
  were removed from source, tests and documents, and the policy was written down in
  [CONTENT_POLICY.md](CONTENT_POLICY.md). Numeric tables and setting vocabulary were kept, which is
  disclosed in [NOTICE.md](../NOTICE.md).
- **Defects found in the browser.** A hardcoded full "shield" meter was removed from the vitals bar,
  a hero whose race and profession share a name was being labelled twice, and the 48 x 32 map was
  wider than its panel at every common desktop width, hiding its right-hand columns behind a scroll
  bar ([KNOWN_ISSUES.md](KNOWN_ISSUES.md) F). None of them could be seen from the test suite.
- **Documentation.** The working notes were consolidated into the pages listed in
  [INDEX.md](INDEX.md).

## Lessons worth keeping

- **`npm test` alone is not sufficient.** Vitest tolerates re-exports that no longer exist; the
  bundler does not. Only `npm run ci` catches it.
- **A green check can assert nothing.** Assert that an action validates, and preferably that
  dispatching it changes the fight.
- **A spell or action with no effect still gets chosen.** When an enemy looks busy but harmless,
  check that what it is doing resolves into something.
- **A creature archetype can be missing the skill that defines it.** Mages had no Spell Casting
  skill at all; the cast action hid that by rolling raw statistics. When an enemy underperforms,
  check its sheet has the skills its actions roll before touching the AI.
- **Flat AI scores make a whole system decorative.** Score by what the option does.
- **Module-scope wiring hits temporal dead zones.** Resolve late-declared collaborators with a
  getter.
- **Do not reshape code to flatter a metric.** Folding 30 registry declarations onto 8 dense lines to
  hold a line count down was tried and reverted; extracting the class was the honest fix.
- **Check the rules before touching one.** Several of the defects above were found by reading the
  reference system, not by reading the code. Budget time for that, not just for typing.
- **Content-heavy services cost more to extract than rules services.** `Loot.ts` needed roughly six
  typing passes where `Damage.ts` needed one. Fix what the compiler points at; blanket regex
  annotation broke the string arrays.
- **A self-check that counts content breaks when content is added.** Assert a floor and a shape, not
  a fixture.
- **A test that draws from `Dice` can break a later one.** Snapshot and restore the shared stream
  around anything that rolls.
- **The presentation bridge is `@ts-nocheck`, so a missing import is invisible to CI.** After editing
  it, load the page and check the console.
- **Measure the layout at the sizes people use.** The map overflowed its panel from the day it grew
  to 48 x 32, and nothing failed. A headless-browser sweep over nine desktop viewports found it in
  seconds.
- **`requestAnimationFrame` does not fire while a browser pane is not painting.** An apparently
  frozen UI can be the environment; verify panels with headless tests.
