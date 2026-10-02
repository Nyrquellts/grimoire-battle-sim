import { GridService } from './GridService';
import type { EventPipeline } from '../core/EventPipeline';
import type { TerrainEffects } from '../data/content/terrain';
import type { IActor, IState } from '../entities/types';

/**
 * What the ground does to a fight.
 *
 * Terrain declares its effects as data; this module is the one place that applies them. It hooks
 * the existing `attack:modifier` and `defense:modifier` events rather than reaching into the attack
 * or defense resolvers, so terrain is a rules *modifier* and never a special case inside combat.
 *
 * Everything applied here is a standard environmental rule:
 *
 * - swampy or overgrown ground: -2 Dodge/Escape and Athletics;
 * - deep water: -2 to attack, block and parry, ranged range quartered and damage halved;
 * - light level: darkness is -2 to attack and defense;
 * - snow and ice: running or attacking calls for a DC:14 Athletics check, and failing it drops you prone.
 *
 * The module is content-free: it reads `effects` off whatever terrain row the tile names and never
 * mentions a terrain by id.
 */

export interface TerrainSource {
  get(id: string): { effects?: TerrainEffects;[field: string]: unknown } | undefined;
}

export interface TerrainRulesDeps {
  pipeline: EventPipeline;
  terrain: TerrainSource;
  /** Applies a condition, used when a footing check fails. */
  conditions: { add(actor: IActor, id: string, duration?: number): unknown };
  /** Effective skill after wounds and conditions. */
  skill(actor: IActor, name: string): number;
  /** Rolls the Witcher exploding d10 check. */
  check(base: number, label: string): { total: number; text: string };
  /** Narration sink. */
  feed(state: IState, entry: Record<string, unknown>): void;
  /**
   * Whether an actor carries a passive that exempts it from a terrain rule.
   *
   * `nightVision` cancels the light-level penalty, `amphibious` cancels the water penalties. Both
   * are creature abilities; this keeps terrain from having to know which creature has them.
   */
  exempt?(actor: IActor, tag: string): boolean;
}

/** The merged effects of the tile an actor is standing on. */
export function terrainEffectsAt(state: IState, actor: IActor, source: TerrainSource): TerrainEffects {
  const tile = GridService.tile(state, actor.pos?.x ?? -1, actor.pos?.y ?? -1);
  if (!tile) return {};
  return source.get(String(tile.terrainKind))?.effects ?? {};
}

/** Ranged adjustments for an actor firing from where they stand. */
export function rangedProfileAt(
  state: IState,
  actor: IActor,
  source: TerrainSource
): { rangeDivisor: number; damageHalved: boolean } {
  const effects = terrainEffectsAt(state, actor, source);
  return {
    rangeDivisor: Math.max(1, Number(effects.rangedRangeDivisor) || 1),
    damageHalved: Boolean(effects.rangedDamageHalved)
  };
}

export class TerrainRules {
  readonly #deps: TerrainRulesDeps;
  readonly #unsubscribes: Array<() => void> = [];

  constructor(deps: TerrainRulesDeps) { this.#deps = deps; }

  /** Subscribes the terrain modifiers. */
  attach(): void {
    const { pipeline } = this.#deps;

    pipeline.on('attack:modifier', context => {
      const state = context.state as IState | undefined;
      const actor = context.actor as IActor | undefined;
      if (!state || !actor) return;
      const effects = this.effects(state, actor);
      const ranged = Boolean(context.ranged);

      let modifier = Number(context.mod) || 0;
      if (!this.#exempt(actor, 'amphibious')) {
        modifier += ranged ? (Number(effects.rangedPenalty) || 0) : (Number(effects.meleePenalty) || 0);
      }
      // Light level applies to everyone on the field, not to a tile.
      if (!this.#exempt(actor, 'nightVision')) modifier += Number(state.map?.visibilityPenalty) || 0;
      context.mod = modifier;
    });

    pipeline.on('defense:modifier', context => {
      const state = context.state as IState | undefined;
      const target = context.target as IActor | undefined;
      if (!state || !target) return;
      const effects = this.effects(state, target);
      // A defender in darkness is as blind as the attacker; the penalty cuts both ways.
      const water = this.#exempt(target, 'amphibious') ? 0 : (Number(effects.dodgePenalty) || 0);
      const dark = this.#exempt(target, 'nightVision') ? 0 : (Number(state.map?.visibilityPenalty) || 0);
      context.mod = (Number(context.mod) || 0) + water + dark;
    });

    // Footing: running or attacking on ice, snow, or scree calls for a DC:14 Athletics check.
    pipeline.on('action:after', context => {
      const state = context.state as IState | undefined;
      const actionName = String(context.actionName ?? '');
      if (!state || !FOOTING_ACTIONS.has(actionName)) return;
      const actorId = String(context.actorId ?? '');
      const actor = findActor(state, actorId);
      if (actor) this.footingCheck(state, actor);
    });
  }

  /** Drops every subscription. */
  detach(): void { for (const off of this.#unsubscribes.splice(0)) off(); }

  /** Whether a passive ability lets this actor ignore a terrain rule. */
  #exempt(actor: IActor, tag: string): boolean {
    return Boolean(this.#deps.exempt?.(actor, tag));
  }

  /** Terrain effects for the tile an actor occupies. */
  effects(state: IState, actor: IActor): TerrainEffects {
    return terrainEffectsAt(state, actor, this.#deps.terrain);
  }

  /**
   * Rolls the footing check for treacherous ground.
   *
   * Failing puts the actor prone. The check is DC:14 Athletics, rolled once the actor has run or
   * attacked on slick ground.
   */
  footingCheck(state: IState, actor: IActor): boolean {
    if (actor.dead || actor.statuses?.prone) return true;
    const dc = Number(this.effects(state, actor).footingDc) || 0;
    if (!dc) return true;
    // Something at home in this ground does not slip on it.
    if (this.#exempt(actor, 'amphibious')) return true;

    const roll = this.#deps.check(this.#deps.skill(actor, 'Athletics'), 'Footing');
    if (roll.total >= dc) return true;

    this.#deps.conditions.add(actor, 'prone');
    this.#deps.feed(state, {
      kind: 'miss',
      title: `${actor.name} loses their footing`,
      story: `The ground goes out from under ${actor.name}.`,
      math: `${roll.text} < DC ${dc} Athletics.`
    });
    return false;
  }
}

/** Actions violent or fast enough to test footing. */
const FOOTING_ACTIONS = new Set([
  'move', 'melee', 'ranged', 'barehanded', 'enemyMove', 'enemyMelee', 'enemyRanged', 'enemyMountedCharge'
]);

function findActor(state: IState, id: string): IActor | undefined {
  if (state.player?.id === id) return state.player;
  return state.enemies?.find(actor => actor.id === id);
}
