import { GridService } from './GridService';
import type { DeploymentZones } from './Battlefield';
import type { IActor, IPosition, IState } from '../entities/types';

/**
 * Where combatants start.
 *
 * Starting distance is a rules input, not decoration: it decides how many rounds a crossbow gets
 * before a swordsman closes, whether a Sign is in range on turn one, and whether a routing enemy
 * can actually escape. Hardcoded spawn coordinates only worked while the map was one fixed size.
 *
 * Placement rules:
 * - each side deploys inside its own band, on opposite edges of the field;
 * - nobody starts on impassable terrain or on top of somebody else;
 * - a group spreads out rather than stacking into a column, so a single area attack cannot open
 *   the fight by catching the whole opposition;
 * - a side that can reach out deploys within reach, rather than at the far edge of the field.
 */

/** Below this `preferredRange` an actor has no reach worth deploying for, and closes on foot. */
const REACHES_OUT = 10;
/** Deployed a little beyond its reach, so the first round is a choice rather than a formality. */
const OPENING_MARGIN = 4;
/** However short the reach, a fight never opens closer than this. */
const MIN_OPENING_GAP = 12;

export interface DeploymentDeps {
  /** Inclusive 1..max integer roll, from the kernel dice. */
  roll(max: number): number;
}

export class DeploymentService {
  readonly #deps: DeploymentDeps;

  constructor(deps: DeploymentDeps) { this.#deps = deps; }

  /** Places one actor near the centre of a zone, then spreads outward to the first legal tile. */
  placeOne(state: IState, actor: IActor, zone: DeploymentZones['player']): IPosition {
    const center = { x: Math.floor(zone.x + zone.w / 2), y: Math.floor(zone.y + zone.h / 2) };
    const spot = this.#firstFree(state, center, actor.id, zone) ?? this.#firstFreeAnywhere(state, actor.id) ?? center;
    actor.pos = { ...spot };
    return actor.pos;
  }

  /**
   * Places a whole side.
   *
   * Actors are dealt down the zone at a stride derived from how many there are, so two enemies
   * stand well apart and eight still fit. Each candidate falls back to a spiral search when the
   * ideal tile is blocked.
   */
  placeGroup(state: IState, actors: readonly IActor[], band: DeploymentZones['player']): void {
    if (!actors.length) return;
    const zone = this.#engagementBand(state, actors, band);
    const stride = Math.max(1, Math.floor(zone.h / (actors.length + 1)));

    actors.forEach((actor, index) => {
      const ideal = {
        x: zone.x + (index % Math.max(1, zone.w)),
        y: zone.y + Math.min(zone.h - 1, stride * (index + 1))
      };
      const spot = this.#firstFree(state, ideal, actor.id, zone)
        ?? this.#firstFreeAnywhere(state, actor.id)
        ?? ideal;
      actor.pos = { ...spot };
    });
  }

  /**
   * How far out a side actually deploys.
   *
   * The band the battlefield hands out sits on the far edge — around 39 m on the default grid.
   * That is right for a side whose only reach is its arms: crossing the ground is the fight. It is
   * wrong for anyone who came to shoot, because a bow, a crossbow and a spellbook all fall short of
   * it, so an archer or a caster spent four rounds walking before the fight started at all.
   *
   * Reach comes from `preferredRange`, which the loadout already sets and which the AI already
   * steers by, so nothing here asks what an actor *is*. A group deploys as a group at the reach of
   * its longest arm: a warband with one mage in it keeps its shield wall in front of the mage
   * rather than leaving them 26 m apart, and a group with no reach at all is left exactly where it
   * was, so melee encounters are unchanged.
   *
   * The band is only ever pulled closer, never pushed further out.
   */
  #engagementBand(state: IState, actors: readonly IActor[], band: DeploymentZones['player']): DeploymentZones['player'] {
    const reach = actors.reduce((longest, actor) => Math.max(longest, Number(actor.preferredRange) || 0), 0);
    if (reach < REACHES_OUT) return band;

    const gapNow = band.x - state.player.pos.x;
    if (gapNow <= 0) return band;

    const wanted = Math.max(MIN_OPENING_GAP, reach + OPENING_MARGIN);
    if (wanted >= gapNow) return band;

    const x = Math.min(band.x, Math.max(state.player.pos.x + MIN_OPENING_GAP, state.player.pos.x + wanted));
    return { ...band, x: Math.max(0, Math.min(x, GridService.W - band.w)) };
  }

  /**
   * A spiral search outward from `origin` for a tile that is passable and unoccupied.
   *
   * Preferring tiles inside the zone keeps deployment tidy; the search widens past the zone only
   * when the zone itself is full, which a very large lineup can manage.
   */
  #firstFree(state: IState, origin: IPosition, actorId: string, zone: DeploymentZones['player']): IPosition | null {
    const maxRadius = Math.max(GridService.W, GridService.H);
    for (let radius = 0; radius < maxRadius; radius++) {
      const candidates: IPosition[] = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          candidates.push({ x: origin.x + dx, y: origin.y + dy });
        }
      }
      // Inside the deployment band first, then anything legal at the same distance.
      const inside = candidates.filter(point => this.#legal(state, point, actorId) && withinZone(zone, point));
      if (inside.length) return inside[this.#deps.roll(inside.length) - 1] ?? inside[0]!;
      const outside = candidates.filter(point => this.#legal(state, point, actorId));
      if (radius > 3 && outside.length) return outside[0]!;
    }
    return null;
  }

  /** Last resort: the first legal tile anywhere on the map. */
  #firstFreeAnywhere(state: IState, actorId: string): IPosition | null {
    for (let index = 0; index < GridService.SIZE; index++) {
      const point = GridService.pos(index);
      if (this.#legal(state, point, actorId)) return point;
    }
    return null;
  }

  /** Passable, on the map, and nobody standing there. */
  #legal(state: IState, point: IPosition, actorId: string): boolean {
    if (!GridService.inside(point.x, point.y)) return false;
    const tile = GridService.tile(state, point.x, point.y);
    if (!tile || tile.blocksMove) return false;
    if (state.player.id !== actorId && samePoint(state.player.pos, point)) return false;
    return !state.enemies.some(enemy => enemy.id !== actorId && samePoint(enemy.pos, point));
  }
}

function withinZone(zone: DeploymentZones['player'], point: IPosition): boolean {
  return point.x >= zone.x && point.x < zone.x + zone.w && point.y >= zone.y && point.y < zone.y + zone.h;
}

function samePoint(a: IPosition | undefined, b: IPosition): boolean {
  return Boolean(a) && a!.x === b.x && a!.y === b.y;
}
