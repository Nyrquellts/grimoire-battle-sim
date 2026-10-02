# Architecture

Start at [docs/INDEX.md](docs/INDEX.md) for navigation. This document covers module ownership and
runtime flow only.

The codebase is being restructured out of two large legacy files into focused modules. The rule that
governs every move is simple: **a module move may change ownership, types, rendering cost and
testability; it may not change a roll, modifier, AI score, action cost or combat outcome.**

## Runtime flow

```text
User input
  -> AppController
  -> ActionGateway.validate(...)
  -> ActionGateway checkpoint
  -> ActionGateway.spend(...)
  -> ActionGateway.run(...)
  -> ZustandHistoryStore immutable update
  -> EventPipeline events
  -> AI decision / CombatFlow when applicable
  -> coalesced Store notification
  -> View selector / DirtyTileService
  -> IRenderer adapter
```

The action gateway is the only rules-changing entry point. Presentation code may request an action;
it may not mutate simulation state directly.

## Three layers

### 1. Pure simulation kernel

`src/core`, `src/entities`, `src/data` and the browser-free parts of `src/services` contain state,
deterministic RNG, rules, AI, pathfinding, tables and combat services. They must not import or
reference `window`, `document`, `HTMLElement`, CSS, Web Audio or other browser APIs. `npm run
audit:kernel` enforces this.

`src/services/SimulationRuntime.ts` is the temporary behaviour-preservation bridge for the legacy
service graph. It is browser-free and is being reduced into the focused service modules without
changing game behaviour. New code must not add DOM dependencies to it, and nothing new may be added
to it at all (see [CONTRIBUTING.md](CONTRIBUTING.md)).

### 1b. Action modules

`src/actions/*.ts` hold one action family each. A module exports `register<Family>Actions(deps)`,
receives its collaborators rather than importing the bridge, and registers validate, spend and run
specs on the gateway. The wiring of content into services, meaning which registry and which service
instance, is one block in the bridge, so an action module stays testable and the bridge only shrinks.

`signs.ts` is the reference implementation. It also exposes read-only helpers (`previewSignCast`,
`augmentAvailability`) so presentation can cost a prospective action without a second copy of the
planner.

### 2. Action gateway

`src/core/ActionGateway.ts` owns action validation, checkpointing, resource spending, resolution,
rollback and action pipeline events.

```text
validate -> checkpoint -> begin transaction
  -> action:before -> action:beforeRun -> spend -> run -> combat:checkEnd
-> COMMIT -> end transaction -> action:after -> presentation notification
```

`COMMIT` is a hard boundary:

- a failure **before** it rolls the transaction back exactly, including the RNG state and any work the
  transaction had queued;
- a failure **after** it is reported on `action:postCommitError` and leaves committed game state alone,
  so an observer or renderer bug can never undo a legal combat action.

Re-entering the gateway during an open transaction is rejected as unsound, because an inner action
would checkpoint against uncommitted state. Such requests are queued and run in order once the
transaction commits, bounded by `ActionGateway.MAX_QUEUED_ACTIONS` so an action cycle cannot hang the
game.

### 3. Presentation adapters

`src/ui` and `src/adapters` are the browser-facing boundary. `src/ui/Shell.ts` composes every view
added after the migration began (the Forge, the hero creator, combat feel, audio), so new
presentation does not grow the legacy bridge. `src/ui/panels/*` render to strings and are therefore
testable without a DOM; `src/ui/effects/*` draw feedback from simulation events and own no state.

`IRenderer` defines the rendering contract. `WebRenderer` is the DOM adapter; `ConsoleRenderer`
supports headless and debug use. `AudioAdapter` is browser-only and is deliberately kept outside the
kernel.

## State ownership

`ZustandHistoryStore` uses the vanilla Zustand store. It preserves the simulator's immutable
snapshot API while adding:

- bounded checkpoint and undo history;
- coalesced notification scheduling;
- selector subscriptions for fine-grained views;
- injectable scheduling for deterministic tests.

No persistent save system is enabled. `StorageAdapter.ts` is only a boundary interface. A hero or a
content pack is kept by exporting it as JSON and importing it again, and imported data is validated
(the hero importer, the content-pack schemas in `src/data/ContentPack.ts`, and the Zod schemas in
`src/data/Schemas.ts`) before it reaches the kernel.

## Grid and pathfinding

The tactical field defaults to 48 x 32 tiles (1,536), one metre per tile, and is configurable:
`GridService.configure({ width, height })` clamps each dimension to 8–128 (the interface has no
control for it yet). Hot-path coordinates use one-dimensional integer indices:

```text
index = y * width + x
x = index % width
y = floor(index / width)
```

`GridService` stores and retrieves tiles from a flat array and uses integer keys and typed arrays for
A\*, reachability, parents and score buffers. Human-readable `{x,y}` objects remain at API boundaries
where they make code clearer. Battlefields are generated from recipes over a shape library in
`src/services/Battlefield.ts`, and a tile's appearance and movement cost come from its terrain row.

## Rendering and dirty tiles

The browser creates one tile button per grid cell and keeps them; the grid is rebuilt only when its
configured size changes. `DirtyTileService` tracks the previous immutable state and returns only tile
indices whose visual representation can have changed. Each dirty tile receives a monotonically
increasing integer version in a pre-sized `Uint32Array`.

Dirty sources include:

- terrain changes;
- actor start and end positions;
- selected target changes;
- reachable-area changes;
- route changes;
- zone creation, removal and ticks;
- token-state changes such as death, flight, surrender or retreat.

The renderer never rebuilds the tactical grid for ordinary state changes.

## AI pacing

`CombatFlow` yields between enemy actions. The delay is presentation pacing only: the AI decision and
the deterministic game rules are unchanged. Generation tokens invalidate stale scheduled work after
reset or stop, so an old enemy phase cannot leak into a new encounter.

## Data

Base data tables are isolated under `src/data/raw`, and registration modules under
`src/data/content`. `src/data/RegistryHub.ts` holds the per-kind content tables and their
insertion-time validators; `src/data/Registry.ts` is the generic `Registry<T>` that will replace it.
Services consume registered data rather than owning embedded tables.

Content carries the rules, not the code: a weapon declares its `combatSkill`, its `silverDamage` and
effects such as `Slow Reload`, so adding a weapon never requires editing combat services. Because
the setting is data, it can be replaced without touching engine code
([docs/CONTENT_POLICY.md](docs/CONTENT_POLICY.md)).

Authored content (characters, scenarios, Sign augments) arrives as a content pack: validated JSON that
passes through one path and never overwrites a built-in row (`src/data/ContentPack.ts`; see
[src/data/packs/README.md](src/data/packs/README.md)).

## Hero creator

The Hero tab is built in three layers, and only the last one touches the DOM.

| Layer | Module | Role |
| --- | --- | --- |
| Rows | `src/data/content/characterCreation.ts`, `heroPresets.ts` | races, professions, skills, packages, starting kits and the premade heroes |
| Rules | `src/services/CharacterBuilder.ts` | pure: a draft goes in, a sheet and a list of issues come out; also export and import |
| Seat | `src/services/PlayerCharacter.ts` | `actorFromSheet` turns a sheet into a combat actor; `HeroRoster` offers premades and seats the chosen hero |
| View | `src/ui/panels/CharacterPanel.ts` | renders to strings, so it is tested without a DOM |

`CharacterBuilder` makes every character a pure function of its draft: stat method (point-buy at one of
four totals, or rolled), skill and package budgets, starting coin, optional field kit, and a
`buildHero` report that says what is wrong before the hero ever reaches a fight. Heroes export as JSON
with a format tag and a version.

## Type boundaries

The strict public model is defined in `src/entities/types.ts` with discriminated action payload
unions and enums for action, damage, effect and morale categories. `unknown` is preferred to `any` at
extension points.

`IActor` and `IState` declare the fields the simulation actually uses, grouped by concern (identity,
combat, equipment, alchemy and Signs, special, metadata). Both keep a `[key: string]: unknown` index
signature for fields not yet declared; that signature only ever shrinks.

Rules read actor **data**, never actor identity. `isPlayerControlled(actor)` and
`usesSkillBasedCombat(actor)` in `src/entities/Actor.ts` carry the meanings that used to be spelled as
an id comparison.

The remaining legacy service and presentation bridges are intentionally isolated while they are
converted service by service. This prevents a "big bang" rewrite from altering simulator behaviour
just to satisfy the compiler. New modules are strict TypeScript and must not use `// @ts-nocheck`.

## Testing

Vitest tests run in Node with no DOM. Unit tests cover deterministic dice, state and undo, action
transactions and rollback, grid and pathfinding, damage, attack resolution, critical thresholds,
ammunition, temporary Health, identity-free combat, the hero builder and the panels that render to
strings. Integration tests cover AI decision legality, an enemy phase and full-round transition,
zones, Signs, bombs, mages, creature abilities and scenarios.

`src/testing/SelfChecks.ts` holds the project's oldest behaviour contracts: 168 named simulation
assertions that used to run only inside the browser. They now execute headlessly in `npm test` and
are also rendered by the in-app diagnostics panel.

See [docs/TESTING.md](docs/TESTING.md) for the workflow and [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md)
for what CI enforces.

## Build output

Vite is configured to emit:

```text
dist/index.html
dist/bundle.js
dist/bundle.css
```

The production output is minified. Development uses native ES modules and Vite HMR.

## Portability rule

A quick audit command for kernel browser leakage is:

```bash
grep -RInE '\b(document|window|HTMLElement|AudioContext)\b' src/core src/services
```

Matches in comments or narrative strings should be inspected; executable kernel code must have none.
