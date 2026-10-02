# Quality gates

`npm run ci` runs, in order: `audit:kernel` → `typecheck` → `test` → `build`. All four must pass.
A failing gate is never worked around; it is fixed.

## 1. `npm run audit:kernel`

`scripts/audit-kernel.mjs` enforces two rules across `src/core`, `src/entities`, `src/data`,
`src/services`, and `src/testing`:

1. **No browser APIs** (`document`, `window`, `HTMLElement`, `AudioContext`) in executable kernel
   code. Comments and string literals are stripped first, so narrative text mentioning a window
   is fine.
2. **No simulation -> presentation imports.** The kernel may not import from `src/ui`,
   `src/adapters`, or `CompatibilityPresentation`. Dependencies point one way.

**Why:** the simulation must run in Node so it can be tested and reproduced without a browser, and
so the tactical foundation stays reusable. `tests/unit/architecture.test.ts` enforces the same rule
from inside the suite.

Browser code belongs in `src/ui` and `src/adapters`.

## 2. `npm run typecheck`

`tsc --noEmit`, strict, with `noUncheckedIndexedAccess`.

**Why:** types are the cheapest guard against a refactor silently changing a shape.

Enforced by convention, tracked by `npm run metrics`:

- no new `// @ts-nocheck` — currently 2, both legacy bridges, and that number may only fall;
- no new `any` in production code outside the bridges.

## 3. `npm test`

Full Vitest suite, Node environment. See [TESTING.md](TESTING.md).

## 4. `npm run build`

`tsc --noEmit && vite build`, producing `dist/index.html`, `dist/bundle.js`, `dist/bundle.css`.

**Why:** typechecking clean but failing to bundle is still broken.

## Tracked, not yet automated

`npm run metrics` prints the numbers recorded in [STATUS.md](STATUS.md). These must move in one
direction only:

| Metric | Direction |
| --- | --- |
| `SimulationRuntime.ts` lines | down, to zero |
| tests passing | up |
| `CompatibilityPresentation.ts` lines | down, to zero |
| `@ts-nocheck` files | down, to zero |
| files importing `SimulationRuntime` | down, to zero |
| default-hero id references in `src` | down, to content/UI only |
| `state.player` / `state.enemies` references | down, to zero (generic actors) |
| `any` outside bridges | down |

Growth in any of these is a defect even when CI is green — but explain it rather than hide it.
A metric that moves the wrong way for a defensible reason belongs in [STATUS.md](STATUS.md) with the
reason. Never reshape code purely to make a number look better; that trade was tried once and
reverted (see [HISTORY.md](HISTORY.md)).

## Rules CI cannot check

Reviewers must check these by reading:

- gameplay behavior did not drift during a refactor;
- no rule branches on an actor's identity (`tests/unit/architecture.test.ts` catches comparisons
  against registered character ids, but not every possible spelling);
- no second authoritative implementation of the same concern was introduced;
- UI does not mutate combat truth;
- no actor-name branches in generic simulation code;
- AI cannot take an action a player could not legally take;
- new content did not require editing unrelated core files.
