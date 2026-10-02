import { isActorOnMap } from '../entities/Actor';
import type { IActor, IRetreatState } from '../entities/types';

/**
 * What condition an actor is in, expressed as a few small orthogonal questions.
 *
 * Kept separate because "dead", "fled", "surrendered", "puppeted", and "dying" are genuinely
 * different axes that combat, loot, targeting, and victory checks each care about differently.
 * Collapsing them into one status enum is what produces bugs like a surrendered actor still being
 * attackable, or a puppeted one counting as defeated.
 */

/** Creates the retreat record if absent, so callers can read it without guarding. */
export function ensureRetreat(actor: IActor): IRetreatState {
  if (!actor.retreat) {
    actor.retreat = { state: 'none', startedRound: null, exit: null, lastRoute: [], blocked: 0, escapedRound: null, lastPos: null };
  }
  return actor.retreat;
}

/** Actively running for a battlefield edge, but not yet gone. */
export function isRouting(actor: IActor | null | undefined): boolean {
  return Boolean(actor) && !actor!.fled && ensureRetreat(actor!).state === 'routing';
}

export const ActorStateService = Object.freeze({
  /** Vital state: `alive`, `dying`, `unconscious`, or `dead`. */
  life(actor: IActor): 'alive' | 'dying' | 'unconscious' | 'dead' {
    if (actor.dead) return 'dead';
    if (actor.death?.active || actor.hp <= 0) return 'dying';
    if (actor.statuses?.unconscious) return 'unconscious';
    return 'alive';
  },

  /** What the actor is doing about the fight, regardless of health. */
  disposition(actor: IActor): 'fled' | 'surrendered' | 'routing' | 'captured' | 'fighting' {
    if (actor.fled) return 'fled';
    if (actor.statuses?.surrendered) return 'surrendered';
    if (isRouting(actor)) return 'routing';
    if (actor.statuses?.captured) return 'captured';
    return 'fighting';
  },

  /** Whether something else is currently driving this actor. */
  control(actor: IActor): 'puppeted' | 'normal' {
    return Number(actor.statuses?.puppet) > 0 ? 'puppeted' : 'normal';
  },

  /** Below zero Health or unconscious: still present, no longer acting normally. */
  downed(actor: IActor): boolean {
    return ['dying', 'unconscious'].includes(this.life(actor));
  },

  /**
   * Whether an attack may target this actor.
   *
   * Dying and unconscious combatants stay physical targets. An accepted surrender protects against
   * an accidental attack; refusing the surrender restores hostility and with it attackability.
   */
  attackable(actor: IActor | null | undefined): boolean {
    if (!actor || actor.dead || actor.fled || actor.removed || actor.statuses?.captured) return false;
    if (actor.statuses?.surrendered) return false;
    return true;
  },

  /** Only a corpse still on the field can be harvested. */
  harvestable(actor: IActor): boolean {
    return this.life(actor) === 'dead' && !actor.fled && !actor.statuses?.surrendered && !actor.statuses?.captured;
  },

  /** A living puppet: the battle is not over while one is still controlled. */
  unresolvedControl(actor: IActor): boolean {
    return this.life(actor) === 'alive' && this.control(actor) === 'puppeted';
  }
});

/**
 * Whether an actor is still an active threat.
 *
 * Deliberately *not* the same as "alive": a routing actor is still hostile because it can be run
 * down, while one that has surrendered, been captured, escaped, or been puppeted is not.
 */
export function isHostile(actor: IActor | null | undefined): boolean {
  if (!actor || !isActorOnMap(actor)) return false;
  const life = ActorStateService.life(actor);
  if (life === 'dead' || life === 'unconscious') return false;
  return !actor.statuses?.surrendered
    && !actor.statuses?.captured
    && !actor.fled
    && actor.faction !== 'player-controlled';
}
