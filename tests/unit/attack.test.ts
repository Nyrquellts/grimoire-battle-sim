import { describe, expect, it } from 'vitest';
import { AttackService, Dice, baseActor, defaultState } from '../../src/services/SimulationRuntime';
import type { AttackOutcome } from '../../src/services/Attack';

function makeTarget() {
  const target = baseActor({
    name: 'Attack Test', family: 'Human', hp: 35, armor: 0,
    stats: { BODY: 5, STUN: 5, REF: 5, DEX: 5 },
    defenses: { dodge: 8, block: 8, parry: 8 },
    skills: { DodgeEscape: 8, Athletics: 8 }
  });
  target.pos = { x: 11, y: 8 };
  return target;
}

function comparable(attack: AttackOutcome) {
  const result = attack.results[0];
  return {
    hit: result?.hit,
    attackTotal: result?.roll?.total,
    defenseTotal: result?.defense?.roll?.total,
    dealt: result?.damage?.dealt,
    location: result?.location?.id,
    critical: result?.critical?.tier ?? null
  };
}

describe('AttackService', () => {
  it('is deterministic for an identical seed and battle state', () => {
    Dice.seed(224466);
    const stateA = defaultState();
    const targetA = makeTarget();
    stateA.enemies = [targetA];
    const resultA = AttackService.attack(stateA, {
      actorId: stateA.player.id, targetId: targetA.id, weaponId: 'manticoreSteel', mode: 'normal', called: 'random'
    });

    Dice.seed(224466);
    const stateB = defaultState();
    const targetB = makeTarget();
    stateB.enemies = [targetB];
    const resultB = AttackService.attack(stateB, {
      actorId: stateB.player.id, targetId: targetB.id, weaponId: 'manticoreSteel', mode: 'normal', called: 'random'
    });

    expect(comparable(resultA)).toEqual(comparable(resultB));
  });

  it('swings the weapon the actor has in hand when none is named, not a fixed default', () => {
    const state = defaultState();
    state.player.weapons = ['armingSword'];
    state.player.selectedWeapon = 'armingSword';
    const target = makeTarget();
    target.pos = { x: state.player.pos.x + 1, y: state.player.pos.y };
    state.enemies = [target];

    const outcome = AttackService.attack(state, { actorId: state.player.id, targetId: target.id });
    expect(outcome.weapon.name).toBe('Arming sword');
  });
});
