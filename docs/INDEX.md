# Documentation index

Navigation only. Each rule lives in exactly one document.

| Document | Answers |
| --- | --- |
| [../README.md](../README.md) | What this is, how to run it, a quick tour. |
| [PLAYING.md](PLAYING.md) | How to play: building a hero, scenarios, Sign weaving, adding content. |
| [STATUS.md](STATUS.md) | What works, what is partial, what is unmeasured. Measured numbers only. |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Confirmed defects, open gaps, and the tests that guard fixes. |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | Module ownership, state flow, layers, grid, rendering. |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Building, ground rules, and what a good change looks like. |
| [CONTENT_POLICY.md](CONTENT_POLICY.md) | How rules are classified, and what does and does not belong in the repository. |
| [../NOTICE.md](../NOTICE.md) | Unofficial fan project notice and what the license covers. |
| [TESTING.md](TESTING.md) | How the test suite is organised and how to add coverage. |
| [QUALITY_GATES.md](QUALITY_GATES.md) | What CI enforces and why each gate exists. |
| [MIGRATION.md](MIGRATION.md) | The plan for retiring the two legacy bridge files. |
| [HISTORY.md](HISTORY.md) | How the codebase got here, and the lessons from the way. |
| [DECISIONS.md](DECISIONS.md) | Decisions taken, with the reasoning. Append-only. |

## Where things live

```text
src/core          deterministic kernel: RNG, dice, store, event pipeline, action gateway
src/entities      actor and state types, small pure helpers
src/data          content registries, schemas, content packs
src/data/content  registration modules, one per content area
src/data/raw      base data tables
src/data/packs    authored content packs (characters, scenarios, augments)
src/actions       action modules registered on the gateway
src/services      simulation services, the hero builder, and the SimulationRuntime legacy bridge
src/testing       browser-free simulation self-checks shared by Vitest and the debug panel
src/ui            presentation, plus the CompatibilityPresentation legacy bridge
src/ui/panels     one module per view: attack, Signs, Forge, registry tabs, hero creator, map
src/ui/effects    combat feel: floating numbers, impact, shake
src/adapters      browser and headless boundaries: renderer, audio, input, storage
tests             Vitest unit and integration suites, plus fixtures
scripts           audit-kernel.mjs (architecture gate), metrics.mjs (legacy-bridge numbers)
docs              these pages; docs/images holds the README screenshots
```
