import { GridService } from './GridService';
import type { EventPipeline } from '../core/EventPipeline';
import type { IActor, IState } from '../entities/types';

/**
 * Creature abilities: what a monster can do besides walk forward and bite.
 *
 * The system is generic. It reads ability rows, decides which are legal right now, and resolves
 * them through a small set of `kind` handlers. It never names a creature and never names an
 * ability — a griffin charges because its row says `kind: 'chargeAttack'`, not because this file
 * knows what a griffin is.
 *
 * Passive abilities are not actions. They are read as *tags* by whatever rule cares:
 * `poisonImmune` by conditions, `mindImmune` by Axii, `regenerate` at round end. Asking
 * `hasTag(actor, 'nightVision')` is how a rule stays content-free while still being specific.
 */

export interface AbilityDefinition {
  name?: string;
  description?: string;
  kind?: string;
  requires?: {
    minDistance?: number;
    maxDistance?: number;
    needsLos?: boolean;
    cooldown?: number;
    staCost?: number;
    healthBelow?: number;
    alliesAtLeast?: number;
  };
  utility?: number;
  params?: Record<string, unknown>;
  tags?: string[];
  /**
   * The action name this ability scores as, when the tag mapping is not what the profile weights
   * already call it. A hurled stone is `throwRock` because that is the weight brutes are written
   * against; leaving this out is the normal case.
   */
  actionName?: string;
  /** Rough damage a hit is worth, for utility scoring. Defaults from the ability's tags. */
  expectedDamage?: number;
  [field: string]: unknown;
}

export interface AbilitySource {
  get(id: string): AbilityDefinition | undefined;
}

/** One ability the AI may offer this turn. */
export interface AbilityOption {
  id: string;
  ability: AbilityDefinition;
  utility: number;
}

export interface CreatureAbilityDeps {
  abilities: AbilitySource;
  /** Ability ids for a creature id. */
  lookup(creatureId: string): string[];
  /** Ability ids a variant adds on top of its species. Optional. */
  lookupVariant?(variantKey: string): string[];
}

export class CreatureAbilitySystem {
  readonly #deps: CreatureAbilityDeps;
  /** Narration hook for the illusion drain, injected by `attachRules`. */
  #onDrain: ((state: IState, actor: IActor, amount: number) => void) | null = null;

  constructor(deps: CreatureAbilityDeps) { this.#deps = deps; }

  /**
   * Ability ids an actor has.
   *
   * An actor may carry an explicit `abilityIds` list — that is how an authored character or a
   * variant gets abilities its base creature does not. Otherwise they come from the bestiary row
   * the actor was composed from.
   */
  idsFor(actor: IActor): string[] {
    const explicit = Array.isArray(actor.abilityIds) ? actor.abilityIds.map(String) : null;
    const base = explicit ?? this.#deps.lookup(String(actor.creatureKey ?? ''));
    const variant = actor.variantKey ? (this.#deps.lookupVariant?.(String(actor.variantKey)) ?? []) : [];
    return variant.length ? [...new Set([...base, ...variant])] : base;
  }

  /** Full definitions for an actor's abilities. */
  definitionsFor(actor: IActor): Array<{ id: string; ability: AbilityDefinition }> {
    const out: Array<{ id: string; ability: AbilityDefinition }> = [];
    for (const id of this.idsFor(actor)) {
      const ability = this.#deps.abilities.get(id);
      if (ability) out.push({ id, ability });
    }
    return out;
  }

  /**
   * Whether an actor carries a passive marker.
   *
   * This is the seam other rules use. `conditions.add` asks for `poisonImmune`; the Axii resolver
   * asks for `mindImmune`; terrain asks for `amphibious`. None of them import this content.
   */
  hasTag(actor: IActor, tag: string): boolean {
    for (const { ability } of this.definitionsFor(actor)) {
      if (ability.tags?.includes(tag)) return true;
    }
    return false;
  }

  /** Merged parameters of the first ability carrying a tag, for passives with numbers. */
  paramsForTag(actor: IActor, tag: string): Record<string, unknown> | null {
    for (const { ability } of this.definitionsFor(actor)) {
      if (ability.tags?.includes(tag)) return ability.params ?? {};
    }
    return null;
  }

  /**
   * Which abilities the actor could use right now, with their utility.
   *
   * Passives are excluded: they are always on and are never a choice.
   */
  available(state: IState, actor: IActor, target: IActor | null): AbilityOption[] {
    const options: AbilityOption[] = [];
    const distance = target ? GridService.distance(actor.pos, target.pos) : Infinity;
    const los = target ? GridService.los(state, actor.pos, target.pos).clear : false;
    const allies = state.enemies.filter(other => other.id !== actor.id && !other.dead && !other.fled).length;

    for (const { id, ability } of this.definitionsFor(actor)) {
      if (!ability.kind || ability.kind === 'passive') continue;
      const gate = ability.requires ?? {};

      if (gate.minDistance !== undefined && distance < gate.minDistance) continue;
      if (gate.maxDistance !== undefined && distance > gate.maxDistance) continue;
      if (gate.needsLos && !los) continue;
      if (gate.staCost !== undefined && (Number(actor.sta) || 0) < gate.staCost) continue;
      if (gate.alliesAtLeast !== undefined && allies < gate.alliesAtLeast) continue;
      if (gate.healthBelow !== undefined && (Number(actor.hp) / Math.max(1, Number(actor.maxHp))) > gate.healthBelow) continue;
      if (this.onCooldown(actor, id, state.round, gate.cooldown)) continue;

      options.push({ id, ability, utility: Number(ability.utility) || 70 });
    }
    return options;
  }

  /** Whether an ability was used too recently. */
  onCooldown(actor: IActor, abilityId: string, round: number, cooldown?: number): boolean {
    if (!cooldown) return false;
    const used = this.usedRound(actor, abilityId);
    return used !== null && round - used < cooldown;
  }

  /** The round an ability was last used, or null. */
  usedRound(actor: IActor, abilityId: string): number | null {
    const memory = actor.ai?.memory as Record<string, unknown> | undefined;
    const log = memory?.abilityUse as Record<string, number> | undefined;
    const round = log?.[abilityId];
    return typeof round === 'number' ? round : null;
  }

  /**
   * Expands passive abilities onto the fields the existing rules already read.
   *
   * This is deliberately a translation rather than a new rules path. Poison immunity becomes an
   * entry in `actor.immunities`, which `ConditionSystem.add` has always honoured; regeneration
   * becomes `actor.regen`; rage becomes `morale.fearImmune`. Nothing new has to learn about
   * abilities for a passive to work.
   *
   * Safe to call more than once: every write is idempotent.
   */
  applyPassives(actor: IActor): void {
    const immunities = new Set((actor.immunities ?? []).map(String));

    for (const { ability } of this.definitionsFor(actor)) {
      if (ability.kind !== 'passive') continue;
      const tags = ability.tags ?? [];
      const params = ability.params ?? {};

      if (tags.includes('poisonImmune')) immunities.add('poisoned');
      if (tags.includes('bleedImmune')) immunities.add('bleeding');
      if (tags.includes('mindImmune')) { immunities.add('stunned'); immunities.add('puppet'); }
      if (tags.includes('regenerate')) actor.regen = Math.max(Number(actor.regen) || 0, Number(params.perRound) || 0);
      if (tags.includes('unintimidatable') || tags.includes('fearImmune')) {
        actor.morale = { ...(actor.morale ?? { state: 'steady', fear: 0 }), fearImmune: true };
      }
      if (tags.includes('incorporeal')) actor.statuses.incorporeal = true;
    }

    actor.immunities = [...immunities];
  }

  /**
   * Subscribes the passive rules that cannot be expressed as an actor field.
   *
   * Incorporeality is the one that matters: a wraith is immune to physical attacks, and the way a
   * witcher answers that is Yrden, which makes incorporeal creatures corporeal.
   * Cancelling in `damage:before` puts both halves of that in one place.
   */
  attachRules(pipeline: EventPipeline, options: {
    corporealZones?: readonly string[];
    onDrain?: (state: IState, actor: IActor, amount: number) => void;
  } = {}): void {
    const corporealZones = options.corporealZones ?? [];
    this.#onDrain = options.onDrain ?? null;

    // An ordered ally fights better until the order goes stale.
    pipeline.on('attack:modifier', context => {
      const actor = context.actor as IActor | undefined;
      const order = actor?.statuses?.commanded as { bonus?: number; remaining?: number } | undefined;
      if (!order || (Number(order.remaining) || 0) <= 0) return;
      context.mod = (Number(context.mod) || 0) + (Number(order.bonus) || 0);
    });

    // Round upkeep: orders expire, and standing illusions drain their target.
    pipeline.on('turn:begin', context => {
      const state = context.state as IState | undefined;
      if (!state || context.side !== 'player') return;

      for (const actor of [state.player, ...(state.enemies ?? [])]) {
        const order = actor?.statuses?.commanded as { remaining?: number } | undefined;
        if (!order) continue;
        order.remaining = (Number(order.remaining) || 0) - 1;
        if (order.remaining <= 0) delete actor.statuses.commanded;
      }

      // Each surviving copy drains Health from the target and heals whoever made them.
      for (const actor of state.enemies ?? []) {
        const illusions = actor.statuses?.illusions as { copies?: number; drain?: number } | undefined;
        if (!illusions || Number(illusions.copies) <= 0 || actor.dead) continue;
        const drain = Number(illusions.drain) || 0;
        if (drain <= 0) continue;
        state.player.hp = Math.max(0, state.player.hp - drain);
        actor.hp = Math.min(actor.maxHp, actor.hp + drain);
        this.#onDrain?.(state, actor, drain);
      }
    });

    /**
     * Crushing Force ruins armour at double rate.
     *
     * The other half of the rule — that such a blow cannot be parried — has no surface in
     * this simulator, which resolves defense as dodge or a static DC and never models a parry. It
     * is left as a descriptive tag rather than faked.
     */
    pipeline.on('damage:after', context => {
      const attacker = context.attacker as IActor | undefined;
      const target = context.target as IActor | undefined;
      const location = context.location as { id?: string } | undefined;
      if (!attacker || !target || !this.hasTag(attacker, 'unparryable')) return;
      const absorbed = Number((context.result as { armorAbsorbed?: number } | undefined)?.armorAbsorbed) || 0;
      if (absorbed <= 0 || !target.armorByLocation || !location?.id) return;
      const slot = target.armorByLocation[location.id] !== undefined ? location.id : 'torso';
      const current = Number(target.armorByLocation[slot]) || 0;
      if (current > 0) target.armorByLocation[slot] = Math.max(0, current - 1);
    });

    /**
     * Illusory copies eat a blow before their maker does.
     *
     * A copy dies to a single blow, so an attack that would land on the maker destroys one copy
     * instead. That is what makes the ability worth an action: it is three attacks of protection,
     * and clearing it is the counter.
     */
    pipeline.on('damage:before', context => {
      const target = context.target as IActor | undefined;
      const illusions = target?.statuses?.illusions as { copies?: number } | undefined;
      if (target && illusions && Number(illusions.copies) > 0) {
        illusions.copies = Number(illusions.copies) - 1;
        if (illusions.copies <= 0) delete target.statuses.illusions;
        context.cancelled = true;
        context.blockedBy = 'Illusory copy';
        context.reason = `The blow lands on a copy of ${target.name}, which comes apart like heat-haze.`;
        return;
      }

      const state = context.state as IState | undefined;
      if (!target?.statuses?.incorporeal || !state) return;
      // Physical damage only: fire, magic, and anything elemental still bites.
      if (!['P', 'S', 'B'].includes(String(context.type ?? 'S'))) return;
      if (this.#standingInZone(state, target, corporealZones)) return;

      context.cancelled = true;
      context.blockedBy = 'Incorporeal';
      context.reason = `${target.name} is incorporeal; steel passes through it.`;
    }, 60);
  }

  /** Whether an actor stands inside any of the named zone types. */
  #standingInZone(state: IState, actor: IActor, types: readonly string[]): boolean {
    if (!types.length) return false;
    return (state.map?.zones ?? []).some(zone =>
      types.includes(String(zone.type))
      && GridService.distance({ x: zone.x, y: zone.y }, actor.pos) <= Number(zone.radius));
  }

  /** Records a use, so cooldowns hold. */
  markUsed(actor: IActor, abilityId: string, round: number): void {
    if (!actor.ai) return;
    const memory = (actor.ai.memory ??= {}) as Record<string, unknown>;
    const log = (memory.abilityUse ??= {}) as Record<string, number>;
    log[abilityId] = round;
  }
}
