import { Dice, Pipeline } from '../core/kernel';
import { pushFeed } from './CombatLog';
import type { IActor, IState } from '../entities/types';

/**
 * Conditions and the Death State.
 *
 * The framework is generic: a condition is a registered definition with an optional per-round
 * tick, statuses are either `true` (until removed) or a countdown, and immunity is a list on the
 * actor. Which conditions exist and what they do is *content* — this module never names one.
 *
 * The single Witcher rule that cannot be expressed as a definition is that some statuses suppress
 * regeneration (Moon Dust). Rather than hardcode that name here, the host game declares which
 * statuses block regeneration when it constructs the system.
 */

/** A registered condition definition. Only the fields the framework reads are declared. */
export interface ConditionDefinition {
  name?: string;
  description?: string;
  /** Applied at each round end while the condition is active. */
  tick?: { hp?: number };
  [field: string]: unknown;
}

/** Anything that can resolve a condition id — a `Map` satisfies this. */
export interface ConditionSource {
  get(id: string): ConditionDefinition | undefined;
}

export interface ConditionSystemOptions {
  /** Statuses that suppress an actor's natural regeneration while active. */
  regenerationBlockers?: readonly string[];
}

/** Result of one Death State save. */
export interface DeathSaveResult {
  ok: boolean;
  roll: number;
  base: number;
  penalty: number;
}

export class ConditionSystem {
  readonly #definitions: ConditionSource;
  readonly #regenerationBlockers: readonly string[];

  constructor(definitions: ConditionSource, options: ConditionSystemOptions = {}) {
    this.#definitions = definitions;
    this.#regenerationBlockers = options.regenerationBlockers ?? [];
  }

  /** The registered definition for a condition, if it exists. */
  definition(id: string): ConditionDefinition | undefined {
    return this.#definitions.get(id);
  }

  /** Whether a condition is currently active on an actor. */
  has(target: IActor, id: string): boolean {
    return Boolean(target.statuses?.[id]);
  }

  /**
   * Applies a condition. `value` may be `true` (lasts until removed) or a round count.
   * Unregistered conditions and immunities are refused, and the caller is told so.
   */
  add(target: IActor, id: string, value: number | boolean = true): boolean {
    if (!this.#definitions.get(id)) return false;
    if ((target.immunities || []).includes(id)) return false;
    target.statuses[id] = value;
    Pipeline.emit('condition:added', { target, condition: id, value });
    return true;
  }

  /** Clears a condition. */
  remove(target: IActor, id: string): void {
    delete target.statuses[id];
  }

  /**
   * Advances one actor's conditions by a round: applies ticks, counts down durations, expires
   * finished conditions, then applies regeneration. An actor driven to zero enters the Death State.
   */
  tickActor(target: IActor): void {
    for (const [id, value] of Object.entries(target.statuses || {})) {
      if (!value) continue;
      const tick = this.#definitions.get(id)?.tick?.hp;
      if (tick) target.hp += tick;
      if (typeof value === 'number' && value > 0) {
        const remaining = value - 1;
        if (remaining <= 0) delete target.statuses[id];
        else target.statuses[id] = remaining;
      }
    }

    if (target.regen && !this.regenerationSuppressed(target) && !target.dead) {
      target.hp = Math.min(target.maxHp, target.hp + target.regen);
    }
    if (target.hp <= 0) this.enterDeath(target);
  }

  /** Whether any active status is currently suppressing this actor's regeneration. */
  regenerationSuppressed(target: IActor): boolean {
    return this.#regenerationBlockers.some(id => Boolean(target.statuses?.[id]));
  }

  /**
   * Puts an actor into the Death State. Returns true only the first time, so callers can tell
   * "just collapsed" from "was already dying".
   */
  enterDeath(target: IActor): boolean {
    if (target.dead) return false;
    const first = !target.death?.active;
    target.death = target.death || { active: true, savePenalty: 0 };
    target.death.active = true;
    target.death.savePenalty = Math.max(0, target.death.savePenalty || 0);
    return first;
  }

  /**
   * One Death State save. Success keeps the actor conscious but makes the next save harder;
   * failure kills them. Returns null when the actor is not dying.
   */
  deathSave(target: IActor): DeathSaveResult | null {
    if (!target.death?.active || target.dead) return null;
    const penalty = Math.max(0, target.death.savePenalty || 0);
    const base = Math.max(1, (target.stats?.STUN ?? target.stats?.BODY ?? 5) - penalty);
    const roll = Dice.d(10);
    const ok = roll <= base;
    if (ok) target.death.savePenalty = penalty + 1;
    else {
      target.dead = true;
      target.death.active = false;
    }
    return { ok, roll, base, penalty };
  }
}

/** Narration wrapper around `deathSave`, so the log records why a save happened. */
export function createDeathStateService(conditions: ConditionSystem) {
  return Object.freeze({
    save(state: IState, target: IActor, reason = 'Death State'): DeathSaveResult | null {
      const result = conditions.deathSave(target);
      if (!result) return null;
      pushFeed(state, {
        kind: result.ok ? 'action' : 'critical',
        title: `${target.name} — Death Save`,
        story: result.ok
          ? `${target.name} is below zero Health but remains conscious enough to fight on, badly diminished.`
          : `${target.name}'s body finally gives out.`,
        math: `${reason}: d10 ${result.roll} vs ${result.base}${result.penalty ? ` (cumulative -${result.penalty})` : ''}`,
        targetId: target.id
      });
      return result;
    }
  });
}
