import { isPlayerControlled } from '../entities/Actor';
import { GridService } from './GridService';
import { ActorStateService, isHostile } from './ActorState';
import { ActorAccess, TeamService } from './Teams';
import type { IActor, IState } from '../entities/types';

/**
 * Who an actor may attack, and who they attack by default.
 *
 * Two jobs kept apart on purpose: `legal` answers "is this a valid target", and `nearest`/`resolve`
 * answer "which one". Actions validate with the first and fall back to the second, so a stale
 * selection never blocks an otherwise-legal attack — it just retargets.
 */

export interface TargetFilter {
  attackable?: boolean;
  hostile?: boolean;
  maxRange?: number;
  requireLos?: boolean;
  predicate?: ((target: IActor) => boolean) | null;
}

export interface TargetResolveRequest extends TargetFilter {
  actorId?: string;
  /** Explicitly requested by the caller; tried first. */
  requestedId?: string | null;
  /** The current UI selection; tried second. */
  selectedId?: string | null;
}

export const TargetingService = Object.freeze({
  /**
   * Whether these two are on opposing sides.
   *
   * Player-controlled actors — including anything currently puppeted onto the player's side — use
   * the threat test, because the player's opposition is "everything still fighting them". Everyone
   * else goes through the team relationship table, which is what makes three-way fights work.
   */
  hostileTo(state: IState, actor: IActor | null, target: IActor | null): boolean {
    if (!actor || !target || actor.id === target.id) return false;
    if (isPlayerControlled(actor)) return isHostile(target);
    if (actor.faction === 'player-controlled') return isHostile(target);
    if (isPlayerControlled(target)) return isHostile(actor);
    if (target.faction === 'player-controlled' && actor.faction !== 'player-controlled') return true;
    return TeamService.relationship(state, actor.team || actor.faction, target.team || target.faction) === 'hostile';
  },

  /** Whether this actor may target that one right now. */
  legal(state: IState, actor: IActor | null, target: IActor | null, { attackable = true, hostile = true, predicate = null }: TargetFilter = {}): boolean {
    if (!actor || !target || actor.id === target.id) return false;
    if (attackable && !ActorStateService.attackable(target)) return false;
    if (hostile && !this.hostileTo(state, actor, target)) return false;
    return typeof predicate === 'function' ? Boolean(predicate(target)) : true;
  },

  /**
   * Closest legal target. Ties break on actor id so the choice is deterministic — two actors at
   * equal distance must not depend on array order.
   */
  nearest(state: IState, actor: IActor | null, { attackable = true, hostile = true, maxRange = Infinity, requireLos = false, predicate = null }: TargetFilter = {}): IActor | null {
    if (!actor) return null;
    return ActorAccess.all(state)
      .filter(target => this.legal(state, actor, target, { attackable, hostile, predicate }))
      .map(target => ({
        target,
        distance: GridService.distance(actor.pos, target.pos),
        los: GridService.los(state, actor.pos, target.pos).clear
      }))
      .filter(row => row.distance <= maxRange && (!requireLos || row.los))
      .sort((a, b) => a.distance - b.distance || String(a.target.id).localeCompare(String(b.target.id)))[0]?.target ?? null;
  },

  /**
   * Picks a target: an explicit request first, then the current selection, then the closest legal
   * one.
   *
   * When the attack needs line of sight, a target already in the clear is preferred; if none is,
   * it still falls back to the physically closest, and the action validator decides whether to
   * reposition or reject. That keeps "no clean shot" a rules decision rather than a targeting one.
   */
  resolve(state: IState, { actorId = state.player.id, requestedId = null, selectedId = null, attackable = true, hostile = true, maxRange = Infinity, requireLos = false, predicate = null }: TargetResolveRequest = {}): IActor | null {
    const actor = ActorAccess.find(state, actorId);
    if (!actor) return null;

    for (const id of [requestedId, selectedId]) {
      if (!id) continue;
      const target = ActorAccess.find(state, id);
      if (this.legal(state, actor, target, { attackable, hostile, predicate })) return target;
    }

    if (requireLos) {
      const lined = this.nearest(state, actor, { attackable, hostile, maxRange, requireLos: true, predicate });
      if (lined) return lined;
    }
    return this.nearest(state, actor, { attackable, hostile, maxRange, predicate });
  },

  /** Resolves a target and writes it back onto the action payload, so `run` and `validate` agree. */
  bind(state: IState, payload: Record<string, unknown>, options: TargetFilter = {}): IActor | null {
    const target = this.resolve(state, {
      actorId: (payload.actorId as string) || state.player.id,
      requestedId: payload.targetId as string | null,
      selectedId: state.selectedEnemyId,
      ...options
    });
    if (target) payload.targetId = target.id;
    return target;
  },

  /** Moves the UI selection, ignoring ids that are not present. */
  select(state: IState, targetId: string | null | undefined): void {
    if (targetId && ActorAccess.find(state, targetId)) state.selectedEnemyId = targetId;
  }
});
