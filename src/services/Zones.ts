import { Dice } from '../core/kernel';
import { clone, invariant } from '../core/utils';
import { isActorOnMap } from '../entities/Actor';
import { GridService } from './GridService';
import type { ConditionSystem } from './Conditions';
import type { DamageResolver } from './Damage';
import type { ActorAccess } from './Teams';
import type { HitLocation, IActor, IPosition, IState, IZone } from '../entities/types';

/**
 * Persistent battlefield zones: fire, gas, magical circles — anything that occupies ground for a
 * number of rounds and does something to whoever stands in it.
 *
 * What a zone *does* is content, declared on its definition as `applies`, not branched on by id
 * here. That is what keeps this generic: a new hazard is a new registry row, not an edit to this
 * file.
 *
 * Zones tick once per round: effects apply, then every zone's duration drops and expired zones are
 * removed.
 */

/** One per-round effect a zone applies to an actor standing in it. */
export interface ZoneEffect {
  /** Applied through the condition framework, so immunity and definitions are respected. */
  condition?: string;
  /** Written straight onto `statuses`, for counters that are not registered conditions. */
  status?: string;
  /** Rounds; omitted means "until removed". */
  duration?: number;
}

/** A registered zone definition. */
export interface ZoneDefinition {
  name?: string;
  applies?: readonly ZoneEffect[];
  /** Gas clouds that a fire effect can set off. */
  ignitable?: boolean;
  [field: string]: unknown;
}

export interface ZoneSource {
  has(id: string): boolean;
  get(id: string): ZoneDefinition | undefined;
}

export interface ZoneDeps {
  definitions: ZoneSource;
  conditions: Pick<ConditionSystem, 'add'>;
  damage: DamageResolver;
  actors: Pick<typeof ActorAccess, 'all' | 'active'>;
  /** Resolves a hit location for ignition damage, which strikes a rolled location. */
  location(model: string, called: string): HitLocation;
}

export interface CreateZoneRequest {
  type: string;
  center?: IPosition | null;
  radius: number;
  duration: number;
  power?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export class ZoneSystem {
  readonly #deps: ZoneDeps;

  constructor(deps: ZoneDeps) { this.#deps = deps; }

  /** Places a zone on the map. Unknown zone types are a content error, not a silent no-op. */
  create(state: IState, { type, center, radius, duration, power = 0, source = 'system', metadata = {} }: CreateZoneRequest): IZone {
    invariant(this.#deps.definitions.has(type), `Unknown zone type: ${type}`);
    const c = center || state.player.pos;
    const zone: IZone = {
      id: `zone-${state.round}-${state.map.zones.length + 1}-${Dice.int(9999)}`,
      type,
      x: c.x,
      y: c.y,
      radius: Number(radius) || 0,
      duration: Math.max(1, Number(duration) || 1),
      power: Number(power) || 0,
      source,
      metadata: clone(metadata)
    };
    state.map.zones.push(zone);
    return zone;
  }

  /** Whether a position falls inside a zone's radius. */
  contains(zone: IZone, pos: IPosition): boolean {
    return GridService.distance({ x: zone.x, y: zone.y }, pos) <= zone.radius;
  }

  /** Live zones covering a position. */
  at(state: IState, pos: IPosition): IZone[] {
    return state.map.zones.filter(zone => zone.duration > 0 && this.contains(zone, pos));
  }

  /** Live zones covering a tile, paired with their definitions. Used by the map view and the AI. */
  tileMeta(state: IState, x: number, y: number): Array<{ zone: IZone; def: ZoneDefinition }> {
    return this.at(state, { x, y })
      .map(zone => ({ zone, def: this.#deps.definitions.get(zone.type) }))
      .filter((row): row is { zone: IZone; def: ZoneDefinition } => Boolean(row.def));
  }

  /** Applies every covering zone's declared effects to one actor. */
  applyToActor(state: IState, actor: IActor | null | undefined): void {
    if (!actor || !isActorOnMap(actor)) return;
    for (const { def } of this.tileMeta(state, actor.pos.x, actor.pos.y)) {
      for (const effect of def.applies ?? []) {
        if (effect.condition) {
          this.#deps.conditions.add(actor, effect.condition, effect.duration ?? true);
        } else if (effect.status) {
          const current = Number(actor.statuses[effect.status]) || 0;
          actor.statuses[effect.status] = Math.max(effect.duration ?? 1, current);
        }
      }
    }
  }

  /** One round of zone upkeep: apply effects, age every zone, drop the expired ones. */
  tick(state: IState): void {
    for (const actor of this.#deps.actors.all(state)) this.applyToActor(state, actor);
    for (const zone of state.map.zones) zone.duration--;
    state.map.zones = state.map.zones.filter(zone => zone.duration > 0);
  }

  /**
   * Sets off ignitable gas clouds covering a point.
   *
   * Everyone inside takes 5d6 to a rolled location and catches fire, the gas marker is cleared, and
   * the cloud is consumed.
   */
  igniteDream(state: IState, center: IPosition): void {
    const clouds = state.map.zones.filter(zone =>
      zone.duration > 0
      && this.#deps.definitions.get(zone.type)?.ignitable
      && this.contains(zone, center));

    for (const cloud of clouds) {
      for (const actor of this.#deps.actors.active(state)) {
        if (!this.contains(cloud, actor.pos)) continue;
        const location = this.#deps.location(actor.family === 'Human' ? 'human' : 'monster', 'random');
        const roll = Dice.rollNotation('5d6');
        this.#deps.damage.resolve(state, {
          attacker: state.player, target: actor, raw: roll.total, type: 'E',
          location, weapon: { effects: [] }, source: 'Dragon’s Dream ignition'
        });
        this.#deps.conditions.add(actor, 'burning');
        delete actor.statuses.flammableGas;
      }
      cloud.duration = 0;
    }
  }
}
