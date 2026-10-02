# Contributing

Thanks for taking an interest in Grimoire Battle Sim. Bug reports, rules corrections, new content and
code are all welcome. This page covers how to build the project, the ground rules that keep the
codebase healthy, and what a good change looks like.

## Getting started

You need Node.js 22 or newer.

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run ci         # audit -> typecheck -> test -> build
npm run metrics    # legacy-bridge numbers
```

`npm run ci` is the gate. It runs the kernel audit, the strict typecheck, the full Vitest suite and
the production build, in that order. Never describe a step as passing without having run it, and
note that `npm test` alone is not enough: the bundler is stricter than the test runner.

The map of the repository is in [docs/INDEX.md](docs/INDEX.md); module ownership and runtime flow are
in [ARCHITECTURE.md](ARCHITECTURE.md).

## Ground rules

1. **Do not rewrite working systems.** An architecture change has to solve a stated problem. Prefer
   the smallest coherent change that keeps CI green.
2. **Gameplay must not drift during refactoring.** Moving code may change ownership, types and
   testability. It may not change a roll, modifier, damage formula, AI score, action cost, turn
   timing or combat outcome. Rule corrections are separate, tested changes.
3. **Rules fidelity.** The simulator models a published tabletop combat system. When you add or
   correct a rule, check it against your own copy of that system, classify how closely the
   implementation follows it (see [docs/CONTENT_POLICY.md](docs/CONTENT_POLICY.md)), and never
   substitute mechanics from video games, TV adaptations or other role-playing games. Do not paste
   rulebook text into the repository: encode the rule as data and describe it in your own words.
   Never invent a citation or a rule.
4. **Engineering references decide how, never what.** A technique from a paper or a book can shape
   an implementation. It must never give a creature or a hero an ability the rules do not grant.
5. **UI never owns combat truth.** Presentation may request actions and hold ephemeral display
   state. It may not mutate HP, conditions, turn state, phase, winner or equipment simulation state.
   See [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md).
6. **Every rules-changing action goes through `ActionGateway`.** No exceptions.
7. **New bugs get a failing regression test first.** Reproduce, write the failing test, fix it,
   run CI. See [docs/TESTING.md](docs/TESTING.md).
8. **No lore in the generic engine.** No `if (name === 'Drowner')`. Behaviour comes from data: tags,
   traits, abilities, AI profiles, attack definitions, resistances.

## Legacy bridges only shrink

| File | Status |
| --- | --- |
| `src/services/SimulationRuntime.ts` | Legacy migration bridge. Never add systems, actions, content, mechanics, AI or features to it. Code leaves it; nothing enters. Delete when empty. |
| `src/ui/CompatibilityPresentation.ts` | Legacy presentation bridge. Same rule. Delete when empty. |

Adding to either file is a defect, even if it compiles. `npm run metrics` prints their sizes; they
must never go up. [docs/MIGRATION.md](docs/MIGRATION.md) is the plan for retiring them.

## Non-negotiables

- No new `// @ts-nocheck` (currently 2, both legacy bridges).
- No new `any` in production code outside the bridges.
- The kernel (`src/core`, `src/entities`, `src/data`, `src/services`, `src/testing`) stays
  browser-free.
- No persistence or save system unless one is explicitly requested. Export and import of JSON is
  the supported way to keep a hero or a content pack.
- One authoritative implementation per concern, never two.

## Adding content

Most additions are data, not code.

- **A creature, weapon, Sign, scenario or battlefield** is a registry row under `src/data/content/`
  or `src/data/raw/`. Give it a rule status (`standard`, `adapted`, `house` or `original`) and write
  its description in your own words.
- **A character, scenario or Sign augment** can ship as a content pack: validated JSON loaded
  through the Forge tab or from `src/data/packs/`. See [src/data/packs/README.md](src/data/packs/README.md).
- **A hero** can be built in the Hero tab and exported as JSON.

If a change needs an engine edit to support a content row, that is a sign the engine is missing a
data field. Add the field rather than a special case.

## Making a change

1. Branch from `main`.
2. Write the failing test first when fixing a bug; add tests alongside a feature.
3. Run `npm run ci`. If you touched a legacy bridge, run `npm run metrics` as well and confirm it
   did not grow.
4. Update the docs the change makes stale. [docs/STATUS.md](docs/STATUS.md) carries measured numbers;
   regenerate them rather than editing by hand.
5. Open a pull request that says what changed and why, and what you ran to check it.

## Reporting a bug

Open an issue with what you did, what you expected and what happened: the encounter setup, the
hero, and the actions you took. The simulation is deterministic when seeded, so if you can reproduce
it from a seed (`Dice.seed(n)` in a test), include that and a maintainer can replay the fight exactly.
