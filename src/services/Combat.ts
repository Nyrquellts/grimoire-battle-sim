/**
 * Migration facade for combat pieces that still live in the legacy bridge.
 *
 * Shrinks as each one is extracted. `AttackService`, `DamageService`, `DefenseService`,
 * `CriticalService`, and `ConditionService` are gone from here already — they are wired instances
 * of the real modules (`./Attack`, `./Damage`, `./Defense`, `./CriticalWounds`, `./Conditions`).
 */
export { CombatFlow, Rules } from './SimulationRuntime';
