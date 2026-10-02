import { clone } from '../core/utils';
import { requiresReload, type AmmunitionWeapon } from './Ammunition';
import type { IActor } from '../entities/types';

/**
 * Per-weapon readiness: what an actor is carrying and whether they can currently use it.
 *
 * Kept separate from the actor's stats because readiness changes constantly during a fight —
 * weapons are dropped, broken, or put out of reach — and none of that should require touching the
 * character sheet.
 *
 * The weapon table is injected rather than imported so this stays free of any specific game's
 * content.
 */

/** One weapon's current readiness. */
export interface EquipmentSlot {
  state: 'ready' | 'dropped' | 'broken' | 'inaccessible' | string;
  droppedAt?: unknown;
  /** Only meaningful for weapons that must be reloaded between shots. */
  loaded?: boolean;
  [field: string]: unknown;
}

/** States in which a weapon cannot be used. */
const UNUSABLE: readonly string[] = ['dropped', 'broken', 'inaccessible'];

export class EquipmentSystem {
  readonly #lookup: (id: string) => AmmunitionWeapon | null | undefined;

  constructor(weaponLookup: (id: string) => AmmunitionWeapon | null | undefined) {
    this.#lookup = weaponLookup;
  }

  /** Creates a readiness row for every weapon the actor carries. Safe to call repeatedly. */
  ensure(actor: IActor | null | undefined): IActor | null | undefined {
    if (!actor) return actor;
    actor.equipmentState ??= {};
    const carried = [...(actor.weapons ?? []), actor.weaponId, actor.sidearmId].filter(Boolean) as string[];
    for (const id of carried) {
      actor.equipmentState[id] ??= { state: 'ready', droppedAt: null };
    }
    // Mirror the chambered flag so a dropped-and-recovered crossbow remembers its state.
    if (actor.weaponId && requiresReload(this.#lookup(actor.weaponId))) {
      const row = actor.equipmentState[actor.weaponId];
      if (row) row.loaded = actor.loaded !== false;
    }
    return actor;
  }

  /** This weapon's readiness, defaulting to ready for anything not tracked yet. */
  state(actor: IActor, weaponId: string): EquipmentSlot {
    this.ensure(actor);
    return (actor.equipmentState?.[weaponId] as EquipmentSlot | undefined) ?? { state: 'ready' };
  }

  /** Sets a weapon's readiness, keeping any fields the caller did not mention. */
  set(actor: IActor, weaponId: string, state: EquipmentSlot['state'], extra: Record<string, unknown> = {}): EquipmentSlot {
    this.ensure(actor);
    const next: EquipmentSlot = { ...this.state(actor, weaponId), state, ...clone(extra) };
    actor.equipmentState![weaponId] = next;
    return next;
  }

  /** Whether the actor can use this weapon right now. */
  usable(actor: IActor, weaponId: string): boolean {
    return !UNUSABLE.includes(this.state(actor, weaponId).state);
  }
}
