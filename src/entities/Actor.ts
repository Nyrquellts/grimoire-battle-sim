import type { IActor } from './types';

/** Returns true when an actor still occupies the tactical map. */
export function isActorOnMap(actor: IActor): boolean {
  return !actor.dead && !actor.fled && !actor.removed;
}

/** Returns a shallow identity-safe actor reference for diagnostics. */
export function actorLabel(actor: IActor): string {
  return `${actor.name} [${actor.id}]`;
}

/**
 * True when this actor is driven by the human player rather than by the AI.
 *
 * Rules that used to ask "is this Nikhail?" are really asking this. Control is actor data, so a
 * renamed, replaced, or additional player character behaves identically, and an AI-controlled copy
 * of a player character correctly does *not* consume the player's turn resources.
 */
export function isPlayerControlled(actor: IActor | null | undefined): boolean {
  return actor?.control === 'PLAYER';
}

/**
 * True when the actor resolves attacks from a skill list rather than a flat attack value.
 *
 * Full character sheets list skills and have no single `attack` number; bestiary and generated
 * stat-blocks carry `attack` instead. This is the data-driven replacement for identity checks in
 * attack resolution.
 */
export function usesSkillBasedCombat(actor: IActor): boolean {
  return actor.attack == null;
}
