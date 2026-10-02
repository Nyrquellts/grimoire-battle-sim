/**
 * Simulation services.
 *
 * The first group is extracted, strict TypeScript with no dependency on the legacy bridge. The
 * second group is still a facade over `SimulationRuntime.ts` and shrinks as extraction continues.
 */

// --- generic tactical foundation -------------------------------------------------------------
export * from './Ammunition';
export * from './Attack';
export * from './CombatLog';
export * from './Conditions';
export * from './Damage';
export * from './Defense';
export * from './DirtyTileService';
export * from './Equipment';
export * from './GridService';
export * from './Loot';
export * from './ActorState';
export * from './Escape';
export * from './Targeting';
export * from './Teams';
export * from './Zones';
export * from './TemporaryHealth';

// --- Witcher rules ----------------------------------------------------------------------------
export * from './CombatRules';
export * from './CriticalWounds';
export * from './Skills';

// --- still inside the legacy bridge -----------------------------------------------------------
export * from './AI';
export * from './ActorComposer';
export * from './Combat';

export * from './Narrative';
export * from './Zone';
