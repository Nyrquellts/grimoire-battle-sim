import { isActorOnMap } from '../entities/Actor';
import type { IActor, IState } from '../entities/types';

/**
 * Team relationships and actor lookup.
 *
 * Nothing here is Witcher-specific: teams are opaque string ids, and relationships are read from
 * `state.teamRelations`. This is what multi-faction combat is built on — three or more sides,
 * neutrals, and alliances that change mid-battle all fall out of the relationship table rather than
 * out of a hardcoded player-versus-everyone assumption.
 *
 * `ActorAccess` is deliberately the *only* place that knows combat state is still shaped as
 * `player` plus `enemies[]`. When actors become a single generic list, this file changes and
 * callers do not.
 */

export type Relationship = 'ally' | 'hostile' | 'neutral';

export const TeamService = Object.freeze({
  /**
   * How team `a` regards team `b`.
   *
   * An explicit entry in either direction wins. Otherwise anything involving the player side is
   * hostile by default and everything else is neutral, which keeps generated encounters fighting
   * without needing a relationship declared for every pairing.
   */
  relationship(state: IState, a: string | undefined, b: string | undefined): Relationship {
    if (a === b) return 'ally';
    const table = state.teamRelations || {};
    const declared = table[`${a}|${b}`] || table[`${b}|${a}`];
    if (declared) return declared as Relationship;
    const playerSide = (team: string | undefined) => team === 'player' || team === 'player-controlled';
    return playerSide(a) || playerSide(b) ? 'hostile' : 'neutral';
  },

  /** Declares how two teams regard each other for the rest of the battle. */
  set(state: IState, a: string, b: string, relation: Relationship): void {
    state.teamRelations ??= {};
    state.teamRelations[`${a}|${b}`] = relation;
  }
});

/** The team an actor fights for. `faction` is the fallback for content that predates teams. */
function sideOf(actor: IActor): string | undefined {
  return actor.team || actor.faction;
}

export const ActorAccess = Object.freeze({
  /** Every actor in the battle, in a stable order. */
  all(state: IState): IActor[] {
    return [state.player, ...(state.enemies || [])].filter(Boolean);
  },

  /** One actor by id, or null. */
  find(state: IState, id: string | undefined | null): IActor | null {
    return this.all(state).find(actor => actor.id === id) || null;
  },

  /** Actors still on the map: not dead, not fled, not removed. */
  active(state: IState): IActor[] {
    return this.all(state).filter(isActorOnMap);
  },

  /** Active actors this actor is at war with. */
  hostileTo(state: IState, actor: IActor): IActor[] {
    return this.active(state).filter(other =>
      other.id !== actor.id && TeamService.relationship(state, sideOf(actor), sideOf(other)) === 'hostile');
  },

  /** Active actors on this actor's side, excluding the actor itself. */
  alliesOf(state: IState, actor: IActor): IActor[] {
    return this.active(state).filter(other =>
      other.id !== actor.id && TeamService.relationship(state, sideOf(actor), sideOf(other)) === 'ally');
  }
});
