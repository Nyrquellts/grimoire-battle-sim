# Migration plan

The simulator works. The goal is to make its internals modular, deterministic, testable, and
extensible **without changing what it does**, and to leave a generic tactical foundation that does
not depend on the setting's content.

Two legacy files hold most of the implementation. Both may only shrink:

- `src/services/SimulationRuntime.ts` — the simulation bridge
- `src/ui/CompatibilityPresentation.ts` — the presentation bridge

Measured state lives in [STATUS.md](STATUS.md); how the work got here is in [HISTORY.md](HISTORY.md).

## Order

Each step is one coherent task that ends with `npm run ci` green and the metrics updated.

| # | Step | State |
| --- | --- | --- |
| 1 | Test safety net — simulation behavior runs headlessly | **done** |
| 2 | `ActionGateway` transaction safety | **done** |
| 3 | Architecture guards — browser-free kernel, dependency direction, cycles | mostly done (cycle detection outstanding) |
| 4 | Type safety — remove ineffective unions, narrow actor state | ongoing |
| 5 | Typed actions and events — an action/payload contract | pending |
| 6 | Unify registries onto `Registry<T>`; delete `RegistryHub` | started — `RegistryHub` moved to `src/data` |
| 7 | Validate raw content with schemas at the import boundary | pending |
| 8 | Extract `SimulationRuntime` service by service (order below) | in progress — tiers 1 and 2 done |
| 9 | Split the action registration block into action modules | pending |
| 10 | Extract AI | pending |
| 11 | Extract `CombatFlow`, then delete `SimulationRuntime.ts` | pending |
| 12 | Clean presentation, then delete `CompatibilityPresentation.ts` | pending — offenders listed below |
| 13 | Generic actor/team combat — only after step 11 | pending |

Defects A to E are fixed; see [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Extraction order for step 8

Dependencies first, so nothing has to be moved twice:

1. ~~`ActorAccess`, `TeamService`, `EquipmentStateService`, `ConditionService`, `DeathStateService`~~ **done** (`ActorStateService` still in the bridge — it depends on `EscapeService`)
2. ~~`DamageService`, `DefenseService`, `AttackService`~~ **done**, plus `CriticalWounds`, `CombatRules`, `Skills`, `CombatLog`
3. ~~`ZoneService`, `LootService`, `HarvestService`, `DragonHoardService`~~ **done**, plus `ActorState`, `Targeting`, `Escape`. Remaining: `NarrativeService`, `ReactionService`, `DialogueService`, `DefeatService`, `GrammarService`, `MoraleService`, `ActorComposer`, `EncounterFactory`, life-history services
4. action registrations
5. AI
6. `CombatFlow` — last, because it coordinates everything else

## Step 12: UI writes that are combat truth

Found while removing identity hardcodes. The UI may keep ephemeral display state (`ui.palette`,
`ui.attackPane`, `ui.called`, expanded panels, form inputs). These writes are simulation state and
must move behind explicit commands:

| Site in `src/ui/CompatibilityPresentation.ts` | Why it is combat truth |
| --- | --- |
| `draft.player.selectedWeapon = …` | decides which weapon later attacks resolve with |
| `draft.selectedEnemyId = …` | the targeting default the rules read |
| `d.phase='combat'; d.winner=null; d.aftermath.defeat=null` in the tester handlers | resurrects a finished battle from the view layer |
| `d.setup.*` and `d.setup.lineup` mutations | encounter definition; belongs behind a setup command |
| `d.feed = []` (clear log) | narration history the simulation owns |

The tester handlers are the worst of these: they already dispatch a proper action and then patch
combat state directly afterwards. Give `TesterService` commands that own the whole effect.

## Rules for every extraction

1. Add or confirm regression tests **before** moving anything.
2. Move the implementation; do not rewrite it. Behavior must be identical.
3. The new module is strict TypeScript, no `@ts-nocheck`, browser-free.
4. The new module must not import `SimulationRuntime`.
5. Delete the old copy in the same change. **Never leave two implementations.**
6. Update callers; run focused tests, then `npm run ci`.
7. The bridge line count must decrease. Record it.

## Definition of done

Both bridges deleted. No new `@ts-nocheck`. Strict types in extracted services. CI green.
Kernel browser-free. Major services directly tested. Tests no longer import `SimulationRuntime`.
UI mutates no combat truth. One authoritative implementation each for damage, defense, attack
resolution, movement, actor lookup, registry, and action execution. Generic actor/team combat
works — 2v3, AI allies, AI enemies, three or more factions. The default hero is content, not an
engine requirement. Normal content can be added without touching core systems. Combat bugs can be
reproduced deterministically from a seed and an encounter.
