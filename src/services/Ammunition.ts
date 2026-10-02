import type { IActor } from '../entities/types';

/**
 * Ammunition model — the single authority for how rounds are carried, chambered, and spent.
 *
 * `ammo` counts carried **unfired** rounds:
 *
 * ```text
 * FIRE   -> one round leaves the pool; a Slow Reload weapon is left unchambered
 * RELOAD -> the weapon is chambered; the pool is NOT touched
 * ```
 *
 * Reloading readies a round that firing already paid for, so a shot-and-reload cycle costs exactly
 * one round.
 *
 * Rules basis: a Slow Reload weapon takes one action to reload. Only crossbows carry that
 * effect, so bows have no chambered state. Ammunition types are discrete carried items (Standard,
 * Blunt, Broadhead, Bodkin). `ruleStatus: standard`.
 *
 * Two carry shapes exist while the actor model converges: composed actors hold a single numeric
 * pool with a `loaded` flag, and the hand-authored player sheet holds named pools with a
 * `crossbowLoaded` flag. Both are handled here so the rule has one implementation; the fields
 * themselves unify when actors become generic.
 */

/** Minimal weapon shape this module needs. */
export interface AmmunitionWeapon {
  effects?: readonly string[];
}

/** True when the weapon must be reloaded between shots. */
export function requiresReload(weapon: AmmunitionWeapon | null | undefined): boolean {
  return Boolean(weapon?.effects?.includes('SlowReload'));
}

/** Named ammunition pools, or null when the actor carries a single unnamed pool. */
export function ammoPools(actor: IActor): Record<string, number> | null {
  const ammo = actor.ammo;
  return ammo && typeof ammo === 'object' ? (ammo as Record<string, number>) : null;
}

/** Total carried unfired rounds, across every pool. */
export function ammoTotal(actor: IActor): number {
  const pools = ammoPools(actor);
  if (pools) return Object.values(pools).reduce((sum, count) => sum + (Number(count) || 0), 0);
  return Number(actor.ammo ?? 0);
}

/**
 * Which pool the next shot draws from.
 *
 * A requested type is honoured only when it still has rounds. With no request, pools are tried in
 * declaration order, so the default choice is deterministic. Returns null for a single unnamed pool
 * or when nothing is available.
 */
export function chooseAmmoType(actor: IActor, requested?: string | null): string | null {
  const pools = ammoPools(actor);
  if (!pools) return null;
  if (requested) return (pools[requested] ?? 0) > 0 ? requested : null;
  return Object.keys(pools).find(type => (pools[type] ?? 0) > 0) ?? null;
}

/** True when the actor has a round chambered. Weapons without Slow Reload are always ready. */
export function isLoaded(actor: IActor, weapon: AmmunitionWeapon | null | undefined): boolean {
  if (!requiresReload(weapon)) return true;
  return ammoPools(actor) ? actor.crossbowLoaded !== false : actor.loaded !== false;
}

/** Sets the chambered state for weapons that have one. */
export function setLoaded(actor: IActor, weapon: AmmunitionWeapon | null | undefined, value: boolean): void {
  if (!requiresReload(weapon)) return;
  if (ammoPools(actor)) actor.crossbowLoaded = value;
  else actor.loaded = value;
}

/**
 * Spends one round for a shot and leaves a Slow Reload weapon unchambered.
 * Returns the pool it came from, or null for a single unnamed pool.
 * Callers must have validated availability first; this throws rather than going negative.
 */
export function spendRound(actor: IActor, weapon: AmmunitionWeapon | null | undefined, requested?: string | null): string | null {
  if (ammoTotal(actor) <= 0) throw new Error(`${actor.name ?? actor.id} has no ammunition remaining.`);
  setLoaded(actor, weapon, false);

  const pools = ammoPools(actor);
  if (!pools) {
    actor.ammo = Math.max(0, Number(actor.ammo ?? 0) - 1);
    return null;
  }

  const type = chooseAmmoType(actor, requested);
  if (!type) throw new Error(`${actor.name ?? actor.id} has no ${requested ?? 'usable'} ammunition remaining.`);
  pools[type] = Math.max(0, (pools[type] ?? 0) - 1);
  return type;
}

/**
 * Finds the weapon a reload applies to: an explicitly named one, the actor's equipped weapon, or
 * the first Slow Reload weapon they carry. Reloading is a property of the weapon, so an actor
 * holding a sword can still span the crossbow on their belt.
 *
 * `lookup` resolves a weapon id, keeping this module free of any registry dependency.
 */
export function findReloadableWeapon(
  actor: IActor,
  lookup: (id: string) => AmmunitionWeapon | null | undefined,
  requestedId?: string | null
): AmmunitionWeapon | null {
  for (const id of [requestedId, actor.weaponId, ...(actor.weapons ?? [])]) {
    if (!id) continue;
    const weapon = lookup(id);
    if (requiresReload(weapon)) return weapon ?? null;
  }
  return null;
}

/** Chambers a round that firing already paid for. Never touches the carried pool. */
export function reload(actor: IActor, weapon: AmmunitionWeapon | null | undefined): void {
  setLoaded(actor, weapon, true);
}

/** Why a shot is not currently possible, or null when it is legal. */
export function shotBlockedReason(
  actor: IActor,
  weapon: AmmunitionWeapon | null | undefined,
  requested?: string | null
): string | null {
  if (!isLoaded(actor, weapon)) return 'The crossbow is not loaded.';
  if (requested && !chooseAmmoType(actor, requested)) return `No ${requested} bolts remain.`;
  if (ammoTotal(actor) <= 0) return 'No bolts remain.';
  return null;
}

/** Why a reload is not currently possible, or null when it is legal. */
export function reloadBlockedReason(actor: IActor, weapon: AmmunitionWeapon | null | undefined): string | null {
  if (!requiresReload(weapon)) return 'That weapon does not need reloading.';
  if (isLoaded(actor, weapon)) return 'Crossbow is already loaded.';
  if (ammoTotal(actor) <= 0) return 'No bolts remain.';
  return null;
}
