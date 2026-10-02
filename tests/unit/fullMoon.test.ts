import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActionDispatcher, Dice, EncounterFactory, Pipeline, Store, defaultState } from '../../src/services/SimulationRuntime';
import { baseMaxHealth, bonusTotal } from '../../src/services/TemporaryHealth';
import type { IActor, IState } from '../../src/entities/types';

/**
 * Regression tests for KNOWN_ISSUES B — Full Moon permanently raised maximum Health.
 *
 * Rule under test: Full Moon grants +30 temporary Health until it wears off, a second dose never
 * stacks with the first (75% toxicity), and White Honey clears toxicity and every potion effect.
 */

const FULL_MOON = 'full-moon';
const WHITE_HONEY = 'white-honey';
const BONUS = 30;

function combatState(): IState {
  const state = defaultState();
  state.phase = 'combat';
  state.round = 1;
  state.turn.side = 'player';
  state.turn.action = 1;
  state.turn.bonus = 1;
  state.turn.movement = state.player.stats!.SPD!;

  // A live hostile is required: with an empty field the victory check ends the battle and every
  // further action is rejected with "Battle is not active."
  const enemy = EncounterFactory.foe('bandit', 'standard', { region: 'Temeria', experience: 'trained', loadout: 'sword' });
  enemy.id = 'mark';
  enemy.pos = { x: 12, y: 8 };
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

/** Grants a fresh Action so several potions can be taken inside one test. */
function refreshAction(): void {
  Store.update(draft => { draft.turn.action = 1; draft.turn.extraAttackUsed = false; }, { silent: true });
}

function drink(itemId: string) {
  return ActionDispatcher.execute('potion', { actorId: 'nikhail', itemId });
}

let savedState: IState;
let savedSeed: number;

beforeEach(() => {
  savedState = Store.snapshot();
  savedSeed = Dice.snapshot();
  Dice.seed(31337);
});

afterEach(() => {
  Dice.restore(savedSeed);
  Store.replace(savedState, { silent: true, clearHistory: true });
});

describe('Full Moon temporary Health', () => {
  it('grants +30 to both current and maximum Health', () => {
    const state = combatState();
    const baseMax = state.player.maxHp;
    const baseHp = state.player.hp;
    load(state);

    expect(drink(FULL_MOON).ok).toBe(true);
    expect(player().maxHp).toBe(baseMax + BONUS);
    expect(player().hp).toBe(baseHp + BONUS);
  });

  it('leaves base maximum Health untouched', () => {
    const state = combatState();
    const baseMax = state.player.maxHp;
    load(state);

    drink(FULL_MOON);
    expect(bonusTotal(player())).toBe(BONUS);
    expect(baseMaxHealth(player())).toBe(baseMax);
  });

  it('does not stack when taken twice', () => {
    const state = combatState();
    const baseMax = state.player.maxHp;
    load(state);

    expect(drink(FULL_MOON).ok).toBe(true);
    refreshAction();
    drink(FULL_MOON);

    // Whether the second dose is refused or merely refreshes the timer, the bonus stays +30.
    expect(player().maxHp).toBe(baseMax + BONUS);
    expect(bonusTotal(player())).toBe(BONUS);
  });

  it('removes the bonus when the duration expires', () => {
    const state = combatState();
    const baseMax = state.player.maxHp;
    load(state);
    drink(FULL_MOON);

    Store.update(draft => { draft.player.activeAlchemy![FULL_MOON]!.remaining = 1; }, { silent: true });
    Store.update(draft => { Pipeline.emit('turn:end', { state: draft, side: 'player' }); }, { silent: true });

    expect(player().activeAlchemy?.[FULL_MOON]).toBeUndefined();
    expect(player().maxHp).toBe(baseMax);
    expect(bonusTotal(player())).toBe(0);
  });

  it('clamps current Health down when the bonus expires', () => {
    const state = combatState();
    const baseMax = state.player.maxHp;
    load(state);
    drink(FULL_MOON);

    // Spend into the temporary pool, then let it lapse.
    Store.update(draft => {
      draft.player.hp = baseMax + 10;
      draft.player.activeAlchemy![FULL_MOON]!.remaining = 1;
    }, { silent: true });
    Store.update(draft => { Pipeline.emit('turn:end', { state: draft, side: 'player' }); }, { silent: true });

    expect(player().maxHp).toBe(baseMax);
    expect(player().hp).toBeLessThanOrEqual(baseMax);
  });

  it('keeps current Health when it already fits under the base maximum', () => {
    const state = combatState();
    const baseMax = state.player.maxHp;
    load(state);
    drink(FULL_MOON);

    Store.update(draft => {
      draft.player.hp = 12;
      draft.player.activeAlchemy![FULL_MOON]!.remaining = 1;
    }, { silent: true });
    Store.update(draft => { Pipeline.emit('turn:end', { state: draft, side: 'player' }); }, { silent: true });

    expect(player().maxHp).toBe(baseMax);
    expect(player().hp).toBe(12);
  });

  it('is removed by White Honey along with toxicity', () => {
    const state = combatState();
    const baseMax = state.player.maxHp;
    load(state);
    drink(FULL_MOON);
    expect(player().maxHp).toBe(baseMax + BONUS);

    refreshAction();
    expect(drink(WHITE_HONEY).ok).toBe(true);

    expect(player().maxHp).toBe(baseMax);
    expect(player().toxicity).toBe(0);
    expect(player().activeAlchemy).toEqual({});
    expect(bonusTotal(player())).toBe(0);
  });

  it('does not drift across repeated grant/expire cycles', () => {
    const state = combatState();
    const baseMax = state.player.maxHp;
    state.player.inventory!.potions![FULL_MOON] = 5;
    load(state);

    for (let cycle = 0; cycle < 3; cycle++) {
      refreshAction();
      // Toxicity is not what this test is about; without clearing it the third dose is correctly
      // refused for exceeding the 150 maximum.
      Store.update(draft => { draft.player.toxicity = 0; }, { silent: true });
      expect(drink(FULL_MOON).ok).toBe(true);
      expect(player().maxHp).toBe(baseMax + BONUS);
      Store.update(draft => { draft.player.activeAlchemy![FULL_MOON]!.remaining = 1; }, { silent: true });
      Store.update(draft => { Pipeline.emit('turn:end', { state: draft, side: 'player' }); }, { silent: true });
      expect(player().maxHp).toBe(baseMax);
    }
  });
});
