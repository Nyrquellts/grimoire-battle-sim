# Status

What works, what is partial, what is missing, and what has not been measured. Snapshot taken on
2026-10-01.

Every claim carries its evidence, and anything without evidence is marked **UNKNOWN** rather than
assumed:

- **test**: covered by the automated suite, which runs in Node with no DOM.
- **browser**: observed in headless Chrome 154 driving the page through its own controls.
- **measured**: a number printed by a script on the day.

For defects and gaps in detail, see [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## The gate

`npm run ci` on Windows 11 with Node 24.19.0 and npm 11.17.0:

| Gate | Result |
| --- | --- |
| Kernel audit (no browser APIs, no simulation to presentation imports) | pass |
| Typecheck (`tsc --noEmit`, strict, `noUncheckedIndexedAccess`) | pass |
| Tests | 803 passed, 0 failed, in 37 files (29 unit, 8 integration) |
| Production build | ok: `bundle.js` 642 kB (197 kB gzip), `bundle.css` 45 kB (11 kB gzip) |

Test counts are not a coverage figure. 169 of the 803 come from the behaviour contracts in
`src/testing/SelfChecks.ts` (168 named checks and a registration guard), and several integration files
hold one broad sweep rather than many small tests (`ai`, `combatRound`, `zone`).

The repository does not run this gate on a hosted runner yet, so treat Linux as **UNKNOWN**:
everything above was run on Windows.

## What works

| Area | What it covers | Evidence |
| --- | --- | --- |
| Hero creator | Four peoples, nine callings, a point pool (60, 70, 75 or 80) or rolled statistics, 61 skills with budgets and a cap at level 6, starting coin, gear purchase, an optional field kit, name suggestions, validated export and import | test: `characterBuilder` (84), `characterPanel` (71), `playerCharacter` (66), `creatorShell` (23). browser: opened a premade as a copy, seated it as the hero, and fought as it |
| Fights | Encounter builder, ten authored scenarios, the action economy, melee, ranged, bombs, Signs, alchemy, critical wounds, morale, undo | test: `attackPanel`, `damagePipeline`, `ammunition`, `fullMoon`, `bombs`, `combatRound`. browser and measured: all ten scenarios start, show their briefing and play a full opposition phase with no console errors (10 of 10) |
| Signs and weaving | Twelve Signs, thirteen augments, focuses, Vigor overexertion, the cost readout | test: `signPanel` (20), `signCasting` (18), `spellCasting` (25). browser: Igni at a draw of 4 with one augment reads "5 STA, Overexert 3, -15 HP" |
| Opposition AI | Utility scoring with six cognition tiers, sixteen profiles, eighteen doctrines, twenty-six creature abilities, ranged deployment | test: `aiTactics` (45), `creatureAbilities` (34), `mages` (5), `ai`, `combatRound` |
| Battlefields | Seventeen generated recipes over a shape library, 33 terrain types, seven zone kinds, elevation, cover, darkness | test: `battlefield` (23), `grid`, `dirtyTiles`. measured: the whole 48 x 32 field is visible from 1280 x 720 to 2560 x 1300 |
| Content packs | Characters, scenarios and Sign augments as validated JSON that never overwrites a built-in row | test: `contentPack` (15), `forgePanel` (18) |
| Engine guarantees | Transactional action gateway with exact rollback including RNG state, deterministic dice, one ammunition model, no simulation code that compares an id against a registered character | test: `actionGateway` (21), `dice`, `ammunition` (13), `genericActor` (12), `architecture` (4) |

The ten scenarios were each started and given one opposition phase on 2026-10-01. Beyond that, play
in the browser was limited: an attack that closed on a group of drowners, a Sign weave previewed (not
cast), and one full round of *The Mage and Her Guard*. Casting itself is covered by the `signCasting`
tests, and longer fights are **UNKNOWN**.

## Partial

Works, with limits that are recorded rather than hidden:

- **Ammunition types.** Broadhead and Bodkin can be chosen and are spent, but their effects are not
  applied to the shot (R1).
- **Skill penalties.** Critical-wound and blind penalties apply to a fixed skill list, not to every
  weapon skill (R3).
- **Armour encumbrance** is stored and not applied to any roll (R5).
- **Hero magic.** Heroes can cast the five basic Signs. Mage and Priest magic is not simulated for
  heroes, and the creator says so (M2). Magic Screen and Mirror Ward have no effect (M1).
- **Narrative perks** in the creator do not touch combat and are tagged as such (M3).
- **Descriptive creature tags** (`feral`, `pounce`, `scentTracking`, `longReach`) are recorded and
  consumed by nothing. A full-information tactical simulator has no surface for them.
- **Identity branches** remain in the legacy bridge and in `Damage.ts`: black-dragon armour handling,
  special bomb effects chosen by item name, and spell lists chosen by school (A1).
- **Bear and great bear** share one profile.
- **Map size** is configurable only in code (`GridService.configure`, 8 to 128 tiles a side). The
  interface has no control for it.
- **Small screens.** Below 1181 pixels the map pans sideways and the layout is not tuned. The Hero tab
  showed no horizontal overflow and no console errors at 390 pixels wide (browser).

## Not implemented

- Save games. A hero or a content pack is kept by exporting it as JSON.
- Multiplayer or any network feature. The source contains no network calls (checked by search).
- A battle view designed for phones.

## Not measured (UNKNOWN)

- Browsers other than Chrome: Firefox, Safari and Edge were not run.
- Real phones and tablets. Only an emulated 390 pixel viewport was checked.
- Runtime performance on low-end hardware.
- Audio. The sound toggle exists, but headless Chrome plays no sound.
- Balance across the creature roster. Bombs and mages were measured; most other matchups were not.
- Keyboard-only and screen-reader use.
- Linux and macOS. The gate has only been run on Windows.

The browser checks were run with throwaway scripts that drive the page through its own controls. They
are not part of the repository, so the browser rows record one run and are not a gate.

## Content inventory

Read from the registry at runtime, not from the documentation.

| Kind | Count | Kind | Count |
| --- | ---: | --- | ---: |
| Creatures | 63 | Weapons | 46 |
| Scenarios | 10 | Armour pieces | 27 |
| Battlefield recipes | 17 | Alchemy items | 36 |
| Terrain kinds | 33 | Creation skills | 61 |
| Zone kinds | 7 | Peoples | 4 |
| Signs | 12 | Callings | 9 |
| Sign augments | 13 | Premade heroes | 5 |
| Spells | 30 | Conditions | 15 |
| Creature abilities | 26 | Critical wounds | 24 |
| AI profiles | 16 | Combat doctrines | 18 |

## Code size and the legacy bridges

From `npm run metrics`:

| Measure | Value |
| --- | ---: |
| TypeScript under `src` | 92 files, 19,022 lines |
| `SimulationRuntime.ts` | 1,649 lines, 130,425 code characters |
| `CompatibilityPresentation.ts` | 505 lines, 21,952 code characters |
| Files with `@ts-nocheck` | 2 (the two bridges) |
| `any` outside the bridges | 1 (`ContentRecord`, the open content index signature) |

The two bridges are the code that has not been moved into focused modules yet. They may only shrink
(see [CONTRIBUTING.md](../CONTRIBUTING.md) and [MIGRATION.md](MIGRATION.md)), and the line count is a
rougher measure than the code-character count. See [D19](DECISIONS.md).

## Reproducing this page

```bash
npm install
npm run ci
npm run metrics
```

The registry counts come from the registry tables in `src/data/RegistryHub.ts` (`Registry.<kind>.size`);
the Bestiary, Alchemy and Rules tabs list the same rows.
