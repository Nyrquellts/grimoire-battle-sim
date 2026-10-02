# Testing

Everything runs headlessly in Node under Vitest. No test requires a browser.

```bash
npm test            # full suite
npm run test:watch  # while working
npm run ci          # audit -> typecheck -> test -> build
```

## Layout

```text
tests/unit/          one service, kernel module, or panel per file
tests/integration/   several systems cooperating (AI decisions, a full round, zones, scenarios)
tests/unit/selfChecks.test.ts   runs every check in src/testing/SelfChecks.ts
tests/unit/architecture.test.ts guards the browser-free kernel boundary
```

## Boundary guards

Two suites exist to fail when an extraction regresses, not to cover a feature:

- `tests/unit/damagePipeline.test.ts` — damage and defense, importing no setting content and no
  bridge module;
- `tests/unit/spellCasting.test.ts` — cast planning, same rule.

If either one needs the content registry or `SimulationRuntime` back to compile, the boundary
between the generic engine and the setting's content has leaked and that is the bug, whatever else
is green.

## Testing presentation

Panels render to strings and handle clicks through plain data, so they are tested in Node with no
DOM: `tests/unit/signPanel.test.ts`, `tests/unit/forgePanel.test.ts` and
`tests/unit/characterPanel.test.ts` are the models. Assert the markup contains what the player needs
to see, and that a handler produced the right store change or the right dispatched action.

**Do not rely on a background or hidden browser tab to verify a panel.** `requestAnimationFrame` does
not fire while a page is not painting. The UI then looks frozen — clicks land and state changes, but
nothing redraws — and it is easy to mistake that for a broken feature. Event handlers still run
synchronously, so a click's *immediate* effect is observable; a re-render is not.

## Simulation self-checks

`src/testing/SelfChecks.ts` holds the project's oldest behavior contracts — 168 named assertions
covering the pipeline, store, RNG, rules, damage, defense, targeting, tactical grid, zones, loot,
harvesting, world composition, AI, and combat lifecycle.

They used to run only by opening `index.html#selftest` by hand. They now live in the browser-free
kernel and have two consumers:

- `npm test` executes every one of them, so a regression fails CI;
- the in-app diagnostics panel renders the same results plus a few DOM-only checks.

A check returns `true`/`undefined` to pass, `false` to fail, or throws. `runSelfChecks()` snapshots
and restores the shared `Store` and `Dice` singletons so diagnostics cannot disturb a live battle.

Add a check there when the contract is about *simulation behavior*. Add a normal Vitest test when
you want proper assertion messages, fixtures, or async — new work should prefer normal Vitest tests.

## The bug workflow

Non-negotiable, in this order:

```text
reproduce -> write a failing test -> confirm it fails -> fix -> confirm it passes -> npm run ci
```

A fix without a regression test is not finished. Never disable or loosen a test to make a change
pass.

## Determinism

The simulator is deterministic: `Dice.seed(n)` then an identical state produces an identical
outcome. Tests rely on this rather than on tolerance ranges.

`Store` carries an RNG sidecar, so a checkpoint/undo restores the RNG state along with the game
state. A rolled-back action must not consume randomness.

## What deserves coverage

Priority order, highest risk first: action transactions and rollback; damage (armour, penetration,
ablation, location multipliers, criticals, resistance, cover); defense (static, dodge, stamina,
repeated defenses, stunned/frozen); attack (melee, ranged, LOS, every range band, fast/strong,
called shots, critical margins); the tactical grid (movement, terrain, elevation, occupancy,
pathfinding, LOS, reachability); conditions (application, duration, ticking, expiry, immunity);
AI (legality, targeting, determinism, ammunition, retreat, surrender); and combat flow (full rounds,
multiple actors, pause/resume, victory, defeat, reset).
