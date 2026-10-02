import { afterEach, describe, expect, it } from 'vitest';
import { ActionDispatcher, CombatFlow, Store } from '../../src/services/SimulationRuntime';
import { Dice } from '../../src/core/kernel';
import { GridService } from '../../src/services/GridService';
import type { IState } from '../../src/entities/types';

/**
 * Bombs, against the standard rules.
 *
 * A bomb hits every body location for full dice each, and *everyone* in the radius is caught, not
 * just the people you were aiming at. A failed Athletics check does not make the bomb vanish — it
 * lands off target and still goes off.
 *
 * The first of those was already right, and is what makes bombs feel brutal against unarmoured
 * swarms; that is the intended design and is not tested here. What is tested is the two things that
 * made the simulator's bombs stronger than the standard rules: a free miss and an immune thrower.
 */

/** Starts a fight and puts the first enemy `distance` metres away in a straight line. */
function setUp(foe: string, distance: number, bombId: string, athletics: number | null = null): IState {
  const start = CombatFlow.start as unknown as (options: { lineup: Array<Record<string, unknown>>; situation: string }) => void;
  start({ lineup: [{ foe, quantity: 1, region: 'Temeria', experience: 'random', loadout: 'random' }], situation: 'open' });
  Store.update(draft => {
    const enemy = draft.enemies[0]!;
    enemy.pos = { x: draft.player.pos.x + distance, y: draft.player.pos.y };
    draft.player.inventory!.bombs![bombId] = 5;
    draft.selectedEnemyId = enemy.id;
    // A clumsy thrower is how the failed-check branch is reached without hunting for a seed.
    if (athletics !== null) draft.player.skills!.Athletics = athletics;
  }, { silent: true });
  return Store.read();
}

/** Throws with no Athletics at all, and reports what the first failed throw did. */
function firstMiss(bombId: string, distance: number): { player: number; enemy: number; feed: string } {
  for (let seed = 1; seed < 60; seed++) {
    Dice.seed(seed);
    const before = setUp('drowner', distance, bombId, 0);
    const playerBefore = before.player.hp;
    const enemyBefore = before.enemies[0]!.hp;
    ActionDispatcher.execute('bomb', { itemId: bombId, targetId: before.enemies[0]!.id });
    const after = Store.read();
    const wide = (after.feed ?? []).find(entry => /goes wide/i.test(String(entry?.title)));
    if (wide) {
      return {
        player: playerBefore - after.player.hp,
        enemy: enemyBefore - after.enemies[0]!.hp,
        feed: String(wide.story)
      };
    }
  }
  throw new Error('No failed throw in 60 seeds.');
}

describe('A bomb catches everyone in the radius', () => {
  afterEach(() => CombatFlow.reset());

  it('burns the thrower who stands inside their own blast', () => {
    Dice.seed(5);
    const before = setUp('drowner', 1, 'dancing-star');
    expect(GridService.distance(before.player.pos, before.enemies[0]!.pos)).toBeLessThanOrEqual(4);

    ActionDispatcher.execute('bomb', { itemId: 'dancing-star', targetId: before.enemies[0]!.id });
    const after = Store.read();

    expect(after.player.hp, 'the thrower was 1 m from a 4 m burst').toBeLessThan(before.player.hp);
    expect(after.enemies[0]!.hp).toBeLessThan(before.enemies[0]!.hp);
  });

  it('spares a thrower who is outside it', () => {
    Dice.seed(5);
    const before = setUp('drowner', 12, 'dancing-star');
    ActionDispatcher.execute('bomb', { itemId: 'dancing-star', targetId: before.enemies[0]!.id });
    expect(Store.read().player.hp).toBe(before.player.hp);
  });

  it('applies the bomb status to the thrower as well as the target', () => {
    Dice.seed(5);
    const before = setUp('drowner', 1, 'dancing-star');
    ActionDispatcher.execute('bomb', { itemId: 'dancing-star', targetId: before.enemies[0]!.id });
    expect(Store.read().player.statuses.burning, 'Dancing Star sets fire to everyone caught').toBeTruthy();
  });
});

describe('A missed throw scatters and still detonates', () => {
  afterEach(() => CombatFlow.reset());

  /** Every failed throw across a run of seeds, with what it cost each side. */
  function failedThrows(bombId: string, distance: number): Array<{ player: number; enemy: number; feed: string }> {
    const out: Array<{ player: number; enemy: number; feed: string }> = [];
    for (let seed = 1; seed < 80; seed++) {
      Dice.seed(seed);
      const before = setUp('drowner', distance, bombId, 0);
      const playerBefore = before.player.hp;
      const enemyBefore = before.enemies[0]!.hp;
      ActionDispatcher.execute('bomb', { itemId: bombId, targetId: before.enemies[0]!.id });
      const after = Store.read();
      const wide = (after.feed ?? []).find(entry => /goes wide/i.test(String(entry?.title)));
      if (wide) {
        out.push({
          player: playerBefore - after.player.hp,
          enemy: enemyBefore - after.enemies[0]!.hp,
          feed: String(wide.story)
        });
      }
      CombatFlow.reset();
    }
    return out;
  }

  it('still goes off somewhere instead of vanishing', () => {
    const missed = failedThrows('dancing-star', 3);
    expect(missed.length, 'expected some throws to fail with no Athletics').toBeGreaterThan(3);
    // A scatter can legitimately land clear of everyone — what must not happen is that *every*
    // failed throw is harmless, which is what "no target is caught" used to guarantee.
    expect(missed.some(entry => entry.player + entry.enemy > 0), 'every scattered bomb was harmless').toBe(true);
  });

  it('can drift back onto the thrower, which is the risk the rule exists for', () => {
    const missed = failedThrows('dancing-star', 3);
    expect(missed.some(entry => entry.player > 0), 'a scattered bomb never once caught the thrower').toBe(true);
  });

  it('reports where it landed rather than that nothing happened', () => {
    const missed = failedThrows('dancing-star', 3);
    expect(missed[0]!.feed).toMatch(/lands \d+ m from .* and goes off there/i);
  });
});
