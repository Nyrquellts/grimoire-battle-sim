import { DiceService } from './Dice';
import { EventPipeline } from './EventPipeline';
import { SeededRng } from './SeededRng';

/**
 * The shared deterministic singletons every simulation service uses.
 *
 * They live here rather than inside a service so that extracted modules depend on the kernel
 * instead of on each other or on the legacy bridge. There is deliberately no container, locator, or
 * injection framework: three module-level values, imported directly.
 *
 * Determinism note: `Random` is the *only* source of randomness in the simulation. Presentation may
 * not consume it — a render or audio path that draws from this RNG would make combat depend on
 * whether anyone was watching. `Store` captures and restores `Dice` alongside game state, so an
 * action that rolls back also rewinds the randomness it consumed.
 */

/** Ordered event bus for lifecycle hooks and non-invasive rules modifiers. */
export const Pipeline = new EventPipeline();

/** The simulation's single deterministic RNG. */
export const Random = new SeededRng();

/** Dice facade over `Random`. Seed it to replay any battle exactly. */
export const Dice = new DiceService(Random);
