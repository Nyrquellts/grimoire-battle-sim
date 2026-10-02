import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ActionDispatcher, Dice, EncounterFactory, Registry, Store, defaultState
} from '../../src/services/SimulationRuntime';
import type { IActor, IState } from '../../src/entities/types';

/**
 * Regression tests for KNOWN_ISSUES A — a shot plus a reload consumed two bolts.
 *
 * Ammunition model (docs/KNOWN_ISSUES.md, and the enemy path which already implemented it):
 *   `ammo` counts carried *unfired* bolts.
 *   FIRE   -> ammo -= 1, loaded = false
 *   RELOAD -> loaded = true, ammo unchanged
 *
 * Rules basis: a Slow Reload weapon takes one action to reload. Only crossbows carry that
 * effect; bows do not. Ammunition types are discrete carried items (Standard, Blunt,
 * Broadhead, Bodkin).
 */

type AmmoPools = Record<string, number>;

function ammoOf(actor: IActor): AmmoPools {
  return actor.ammo as AmmoPools;
}

function totalAmmo(actor: IActor): number {
  return Object.values(ammoOf(actor)).reduce((sum, count) => sum + count, 0);
}

/** Combat state with one hostile standing in clear crossbow range. */
function combatState(): IState {
  const state = defaultState();
  state.phase = 'combat';
  state.round = 1;
  state.turn.side = 'player';
  state.turn.action = 1;
  state.turn.bonus = 1;
  state.turn.reaction = 1;
  state.turn.movement = state.player.stats!.SPD!;
  state.player.pos = { x: 4, y: 8 };

  const enemy = EncounterFactory.foe('bandit', 'standard', { region: 'Temeria', experience: 'trained', loadout: 'sword' });
  enemy.id = 'mark';
  enemy.pos = { x: 9, y: 8 };
  state.enemies = [enemy];
  state.selectedEnemyId = 'mark';
  return state;
}

function load(state: IState): void {
  Store.replace(state, { silent: true, clearHistory: true });
}

function player(): IActor {
  return Store.read().player;
}

let savedState: IState;
let savedSeed: number;

beforeEach(() => {
  savedState = Store.snapshot();
  savedSeed = Dice.snapshot();
  Dice.seed(90210);
});

afterEach(() => {
  Dice.restore(savedSeed);
  Store.replace(savedState, { silent: true, clearHistory: true });
});

describe('crossbow ammunition accounting', () => {
  it('spends exactly one bolt across a fire-and-reload cycle', () => {
    load(combatState());
    const before = totalAmmo(player());
    expect(player().crossbowLoaded).toBe(true);

    const shot = ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'zerrikanianCrossbow' });
    expect(shot.ok, shot.reason).toBe(true);
    expect(totalAmmo(player())).toBe(before - 1);
    expect(player().crossbowLoaded).toBe(false);

    Store.update(draft => { draft.turn.action = 1; draft.turn.extraAttackUsed = false; }, { silent: true });

    const reload = ActionDispatcher.execute('reload', { actorId: 'nikhail' });
    expect(reload.ok, reload.reason).toBe(true);
    expect(player().crossbowLoaded).toBe(true);
    // The reload readies the already-paid-for bolt; it must not take a second one.
    expect(totalAmmo(player())).toBe(before - 1);
  });

  it('cannot fire an unloaded crossbow', () => {
    const state = combatState();
    state.player.crossbowLoaded = false;
    load(state);
    const shot = ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'zerrikanianCrossbow' });
    expect(shot.ok).toBe(false);
    expect(shot.reason).toMatch(/not loaded/i);
  });

  it('cannot fire when loaded but out of bolts', () => {
    const state = combatState();
    state.player.crossbowLoaded = true;
    state.player.ammo = { standard: 0, bodkin: 0, broadhead: 0 };
    load(state);
    const shot = ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'zerrikanianCrossbow' });
    expect(shot.ok).toBe(false);
    expect(shot.reason).toMatch(/bolt/i);
  });

  it('cannot reload with no bolts left', () => {
    const state = combatState();
    state.player.crossbowLoaded = false;
    state.player.ammo = { standard: 0, bodkin: 0, broadhead: 0 };
    load(state);
    const reload = ActionDispatcher.execute('reload', { actorId: 'nikhail' });
    expect(reload.ok).toBe(false);
    expect(reload.reason).toMatch(/bolt/i);
  });

  it('cannot reload a weapon that is already loaded', () => {
    load(combatState());
    const reload = ActionDispatcher.execute('reload', { actorId: 'nikhail' });
    expect(reload.ok).toBe(false);
    expect(reload.reason).toMatch(/already loaded/i);
  });

  it('spends the last bolt and then refuses to reload', () => {
    const state = combatState();
    state.player.ammo = { standard: 1, bodkin: 0, broadhead: 0 };
    load(state);

    expect(ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'zerrikanianCrossbow' }).ok).toBe(true);
    expect(totalAmmo(player())).toBe(0);

    Store.update(draft => { draft.turn.action = 1; draft.turn.extraAttackUsed = false; }, { silent: true });
    const reload = ActionDispatcher.execute('reload', { actorId: 'nikhail' });
    expect(reload.ok).toBe(false);
  });

  it('spends the requested ammunition type', () => {
    const state = combatState();
    state.player.ammo = { standard: 5, bodkin: 5, broadhead: 5 };
    load(state);

    const shot = ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'zerrikanianCrossbow', ammoType: 'bodkin' });
    expect(shot.ok, shot.reason).toBe(true);
    expect(ammoOf(player())).toEqual({ standard: 5, bodkin: 4, broadhead: 5 });
  });

  it('refuses a requested ammunition type that is empty', () => {
    const state = combatState();
    state.player.ammo = { standard: 5, bodkin: 0, broadhead: 5 };
    load(state);

    const shot = ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'zerrikanianCrossbow', ammoType: 'bodkin' });
    expect(shot.ok).toBe(false);
    expect(shot.reason).toMatch(/bodkin/i);
  });

  it('falls back to the standard pool when no type is requested', () => {
    const state = combatState();
    state.player.ammo = { standard: 5, bodkin: 5, broadhead: 5 };
    load(state);

    ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'zerrikanianCrossbow' });
    expect(ammoOf(player())).toEqual({ standard: 4, bodkin: 5, broadhead: 5 });
  });
});

describe('reloading is driven by the Slow Reload effect, not by weapon identity', () => {
  it('marks every crossbow in the registry Slow Reload and no bow', () => {
    const slowReload = (id: string) => Boolean(Registry.weapons.get(id)?.effects?.includes('SlowReload'));
    for (const id of ['handCrossbow', 'crossbow', 'monsterCrossbow', 'zerrikanianCrossbow']) {
      expect(slowReload(id), `${id} should be Slow Reload`).toBe(true);
    }
    for (const id of ['shortBow', 'longBow', 'warBow']) {
      expect(slowReload(id), `${id} should not be Slow Reload`).toBe(false);
    }
  });

  it('does not require reloading for a bow', () => {
    const state = combatState();
    state.player.weapons = [...(state.player.weapons ?? []), 'longBow'];
    state.player.crossbowLoaded = false;
    load(state);

    const shot = ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'longBow' });
    expect(shot.ok, shot.reason).toBe(true);
    // A bow still consumes an arrow, but has no loaded/unloaded state to clear.
    expect(totalAmmo(player())).toBe(29);
  });

  it('refuses a second crossbow shot before reloading', () => {
    load(combatState());
    expect(ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'zerrikanianCrossbow' }).ok).toBe(true);
    Store.update(draft => { draft.turn.action = 1; draft.turn.extraAttackUsed = false; }, { silent: true });
    const second = ActionDispatcher.execute('ranged', { actorId: 'nikhail', targetId: 'mark', weaponId: 'zerrikanianCrossbow' });
    expect(second.ok).toBe(false);
  });
});

describe('enemy ammunition accounting stays correct', () => {
  it('spends one bolt per shot and none on reload', () => {
    const state = combatState();
    const arbalist = EncounterFactory.foe('bandit', 'arbalist', { region: 'Temeria', experience: 'trained', loadout: 'crossbow' });
    arbalist.id = 'arb';
    arbalist.pos = { x: 12, y: 8 };
    arbalist.ammo = 10;
    arbalist.loaded = true;
    state.enemies = [arbalist];
    load(state);

    expect(ActionDispatcher.execute('enemyRanged', { actorId: 'arb' }).ok).toBe(true);
    let enemy = Store.read().enemies[0]!;
    expect(enemy.ammo).toBe(9);
    expect(enemy.loaded).toBe(false);

    expect(ActionDispatcher.execute('enemyReload', { actorId: 'arb' }).ok).toBe(true);
    enemy = Store.read().enemies[0]!;
    expect(enemy.ammo).toBe(9);
    expect(enemy.loaded).toBe(true);
  });
});
