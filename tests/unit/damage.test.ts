import { describe, expect, it } from 'vitest';
import { DamageService, Rules, baseActor, defaultState } from '../../src/services/SimulationRuntime';

describe('DamageService', () => {
  it('preserves the existing penetration, location multiplier, and armor ablation math', () => {
    const state = defaultState();
    const target = baseActor({
      name: 'Armor Test', family: 'Human', hp: 30, armor: 5,
      stats: { BODY: 5, STUN: 5 }, defenses: { dodge: 8, block: 8, parry: 8 }
    });
    const location = Rules.location('human', 'torso');
    const beforeHp = target.hp;
    const result = DamageService.resolve(state, {
      attacker: state.player,
      target,
      raw: 10,
      type: 'S',
      location,
      source: 'test'
    });

    expect(result.dealt).toBe(5);
    expect(target.hp).toBe(beforeHp - 5);
    expect(target.armor).toBe(4);
  });
});

describe('natural stopping power', () => {
  const hit = (target: ReturnType<typeof baseActor>, raw: number, effects: string[] = []) => {
    const state = defaultState();
    return DamageService.resolve(state, {
      attacker: state.player, target, raw, type: 'S', location: Rules.location('human', 'torso'),
      weapon: effects.length ? ({ effects } as never) : null, source: 'test'
    });
  };
  const body = (armor: number, naturalSp?: number) => {
    const actor = baseActor({
      name: 'Stout', family: 'Human', hp: 40, armor,
      stats: { BODY: 6, STUN: 6 }, defenses: { dodge: 8, block: 8, parry: 8 }
    });
    if (naturalSp !== undefined) actor.naturalSp = naturalSp;
    return actor;
  };

  it('adds to worn armour when the hit is resolved', () => {
    const result = hit(body(5, 2), 10);
    expect(result.effectiveSp).toBe(7);
    expect(result.dealt).toBe(3);
  });

  it('never wears down: only the worn armour ablates', () => {
    const target = body(5, 2);
    hit(target, 10);
    expect(target.armor).toBe(4);
    expect(target.naturalSp).toBe(2);
  });

  it('still protects a body with no armour at all, and ablates nothing', () => {
    const target = body(0, 2);
    const result = hit(target, 6);
    expect(result.dealt).toBe(4);
    expect(target.armor).toBe(0);
    expect(target.naturalSp).toBe(2);
  });

  it('is halved with the rest of the armour by an armour-piercing weapon', () => {
    const result = hit(body(6, 2), 10, ['ArmorPiercing']);
    expect(result.effectiveSp).toBe(4);
    expect(result.dealt).toBe(6);
  });

  it('changes nothing for an actor that has none', () => {
    const result = hit(body(5), 10);
    expect(result.effectiveSp).toBe(5);
    expect(result.dealt).toBe(5);
  });
});
