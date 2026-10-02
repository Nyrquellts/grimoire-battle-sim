import { describe, expect, it } from 'vitest';
import {
  SpellCastingSystem,
  emptyModifiers,
  type AugmentDefinition,
  type CastableDefinition,
  type ElementalFumbleDefinition
} from '../../src/services/SpellCasting';
import type { IActor } from '../../src/entities/types';

/**
 * Like `damagePipeline.test.ts`, this suite imports **no** Witcher content and **not** the legacy
 * bridge. Cast planning is part of the generic foundation: it is handed definitions and it costs
 * them. If this file ever needs the Witcher registry back, the boundary has leaked.
 */

function caster(overrides: Partial<IActor> = {}): IActor {
  return {
    id: 'caster', name: 'Caster', family: 'Human', hp: 50, maxHp: 50, sta: 40, maxSta: 40,
    dead: false, pos: { x: 0, y: 0 }, statuses: {}, morale: { state: 'steady', fear: 0 },
    vigor: 5,
    ...overrides
  } as IActor;
}

const FIRE_CONE: CastableDefinition = { id: 'flame', name: 'Flame', family: 'Flame', element: 'Fire', shape: 'cone', range: 2, maxCost: 7 };

const AUGMENTS: Record<string, AugmentDefinition> = {
  hotter: {
    id: 'hotter', name: 'Hotter', staCost: 2, exclusiveGroup: 'intensity',
    appliesTo: { elements: ['Fire'] }, requires: { minSkill: 12 },
    effects: { bonusDamage: ['1d6'], ignitionChance: 25 }
  },
  hottest: {
    id: 'hottest', name: 'Hottest', staCost: 3, exclusiveGroup: 'intensity',
    appliesTo: { elements: ['Fire'] }, effects: { bonusDamage: ['2d6'] }
  },
  wider: {
    id: 'wider', name: 'Wider', staCost: 1, exclusiveGroup: 'shaping',
    appliesTo: { shapes: ['cone'] }, effects: { radiusDelta: 2, castBonus: -1 }
  },
  onlyEarth: {
    id: 'onlyEarth', name: 'Only Earth', staCost: 1,
    appliesTo: { elements: ['Earth'] }, effects: { castBonus: 1 }
  },
  needsZone: {
    id: 'needsZone', name: 'Needs Zone', staCost: 1,
    requires: { targetZone: 'glyphs' }, effects: { bonusDamage: ['2d6'] }
  },
  needsFocus: {
    id: 'needsFocus', name: 'Needs Focus', staCost: 1,
    requires: { focus: true }, effects: { armorPiercing: true }
  }
};

const FUMBLES: Record<string, ElementalFumbleDefinition> = {
  Fire: { name: 'Ignition', description: 'burns', condition: 'burning' },
  Mixed: { name: 'Sparks', description: 'sparks', condition: 'staggered' }
};

function system(options: { roll?: (sides: number) => number; maxAugments?: number } = {}): SpellCastingSystem {
  return new SpellCastingSystem(
    { get: (id: string) => AUGMENTS[id] },
    {
      fumbles: { get: (id: string) => FUMBLES[id] },
      maxAugments: options.maxAugments ?? 2,
      roll: options.roll ?? (() => 1)
    }
  );
}

describe('SpellCastingSystem.plan — cost arithmetic', () => {
  it('spends exactly the investment when nothing modifies the cast', () => {
    const plan = system().plan(FIRE_CONE, caster(), { investment: 3 }, { skill: 15 });
    expect(plan.staCost).toBe(3);
    expect(plan.augmentCost).toBe(0);
    expect(plan.focusDiscount).toBe(0);
    expect(plan.legal).toBe(true);
  });

  it('clamps the investment to the castable maxCost', () => {
    expect(system().plan(FIRE_CONE, caster(), { investment: 99 }, { skill: 15 }).investment).toBe(7);
    expect(system().plan(FIRE_CONE, caster(), { investment: 0 }, { skill: 15 }).investment).toBe(1);
  });

  it('adds augment STA on top of the investment', () => {
    const plan = system().plan(FIRE_CONE, caster(), { investment: 2, augmentIds: ['hotter'] }, { skill: 15 });
    expect(plan.augmentCost).toBe(2);
    expect(plan.staCost).toBe(4);
    expect(plan.modifiers.bonusDamage).toEqual(['1d6']);
    expect(plan.modifiers.ignitionChance).toBe(25);
  });

  it('charges 5 HP per point of STA above the Vigor Threshold', () => {
    // Vigor 5, cost 7 -> 2 over -> 10 HP.
    const plan = system().plan(FIRE_CONE, caster({ vigor: 5 }), { investment: 7 }, { skill: 15 });
    expect(plan.vigorOver).toBe(2);
    expect(plan.healthCost).toBe(10);
  });

  it('measures Vigor against the cost after the focus discount, so a focus prevents overexertion', () => {
    const plan = system().plan(
      FIRE_CONE, caster({ vigor: 5 }), { investment: 7 },
      { skill: 15, focus: { name: 'Staff', value: 3 } }
    );
    expect(plan.focusDiscount).toBe(3);
    expect(plan.staCost).toBe(4);
    expect(plan.vigorOver).toBe(0);
    expect(plan.healthCost).toBe(0);
  });

  it('never lets a focus take the STA cost below 1', () => {
    const plan = system().plan(
      FIRE_CONE, caster(), { investment: 1 },
      { skill: 15, focus: { name: 'Crystal', value: 5 } }
    );
    expect(plan.staCost).toBe(1);
    expect(plan.focusDiscount).toBe(0);
  });

  it('grants the Greater Focus casting bonus', () => {
    const plan = system().plan(
      FIRE_CONE, caster(), { investment: 3 },
      { skill: 15, focus: { name: 'Crystal staff', value: 1, greater: true } }
    );
    expect(plan.modifiers.castBonus).toBe(2);
  });

  it('lowers the Vigor Threshold by 1 per unit of nearby dimeritium', () => {
    const plan = system().plan(FIRE_CONE, caster({ vigor: 5 }), { investment: 5 }, { skill: 15, dimeritiumUnits: 2 });
    expect(plan.vigor).toBe(3);
    expect(plan.vigorOver).toBe(2);
    expect(plan.healthCost).toBe(10);
  });
});

describe('SpellCastingSystem.plan — legality', () => {
  it('rejects a cast the caster cannot pay for in STA', () => {
    const plan = system().plan(FIRE_CONE, caster({ sta: 2 }), { investment: 5 }, { skill: 15 });
    expect(plan.legal).toBe(false);
    expect(plan.reason).toMatch(/Need 5 STA/);
  });

  it('refuses overexertion that would kill the caster outright', () => {
    const plan = system().plan(FIRE_CONE, caster({ vigor: 1, hp: 8 }), { investment: 4 }, { skill: 15 });
    expect(plan.healthCost).toBe(15);
    expect(plan.legal).toBe(false);
    expect(plan.reason).toMatch(/Overexerting/);
  });

  it('allows overexertion the caster can survive', () => {
    const plan = system().plan(FIRE_CONE, caster({ vigor: 1, hp: 40 }), { investment: 4 }, { skill: 15 });
    expect(plan.healthCost).toBe(15);
    expect(plan.legal).toBe(true);
  });
});

describe('SpellCastingSystem.plan — augment gates', () => {
  it('rejects an augment whose element does not match', () => {
    const plan = system().plan(FIRE_CONE, caster(), { investment: 2, augmentIds: ['onlyEarth'] }, { skill: 15 });
    expect(plan.augments).toHaveLength(0);
    expect(plan.rejected[0]?.reason).toMatch(/Earth/);
    expect(plan.staCost).toBe(2);
  });

  it('rejects an augment below the required casting skill', () => {
    const plan = system().plan(FIRE_CONE, caster(), { investment: 2, augmentIds: ['hotter'] }, { skill: 9 });
    expect(plan.augments).toHaveLength(0);
    expect(plan.rejected[0]?.reason).toMatch(/casting skill of 12/);
  });

  it('rejects a second augment from the same exclusive group', () => {
    const plan = system().plan(FIRE_CONE, caster(), { investment: 2, augmentIds: ['hotter', 'hottest'] }, { skill: 15 });
    expect(plan.augments.map(a => a.id)).toEqual(['hotter']);
    expect(plan.rejected[0]?.reason).toMatch(/Conflicts/);
  });

  it('accepts augments from different groups together', () => {
    const plan = system().plan(FIRE_CONE, caster(), { investment: 2, augmentIds: ['hotter', 'wider'] }, { skill: 15 });
    expect(plan.augments.map(a => a.id)).toEqual(['hotter', 'wider']);
    expect(plan.augmentCost).toBe(3);
    expect(plan.modifiers.castBonus).toBe(-1);
    expect(plan.modifiers.radiusDelta).toBe(2);
  });

  it('enforces the house cap on how many augments one cast may carry', () => {
    const capped = new SpellCastingSystem({ get: (id: string) => AUGMENTS[id] }, { maxAugments: 1, roll: () => 1 });
    const plan = capped.plan(FIRE_CONE, caster(), { investment: 2, augmentIds: ['hotter', 'wider'] }, { skill: 15 });
    expect(plan.augments).toHaveLength(1);
    expect(plan.rejected[0]?.reason).toMatch(/at most 1 augments/);
  });

  it('gates a battlefield augment on the target actually standing in the zone', () => {
    const without = system().plan(FIRE_CONE, caster(), { investment: 2, augmentIds: ['needsZone'] }, { skill: 15 });
    expect(without.augments).toHaveLength(0);

    const withZone = system().plan(
      FIRE_CONE, caster(), { investment: 2, augmentIds: ['needsZone'] },
      { skill: 15, targetZones: ['glyphs'] }
    );
    expect(withZone.augments.map(a => a.id)).toEqual(['needsZone']);
    expect(withZone.modifiers.bonusDamage).toEqual(['2d6']);
  });

  it('gates a focus-only augment on a held focus', () => {
    const without = system().plan(FIRE_CONE, caster(), { investment: 2, augmentIds: ['needsFocus'] }, { skill: 15 });
    expect(without.rejected[0]?.reason).toMatch(/held focus/);

    const withFocus = system().plan(
      FIRE_CONE, caster(), { investment: 2, augmentIds: ['needsFocus'] },
      { skill: 15, focus: { value: 1 } }
    );
    expect(withFocus.modifiers.armorPiercing).toBe(true);
  });

  it('reports an unknown augment rather than throwing', () => {
    const plan = system().plan(FIRE_CONE, caster(), { investment: 2, augmentIds: ['nope'] }, { skill: 15 });
    expect(plan.legal).toBe(true);
    expect(plan.rejected[0]).toMatchObject({ id: 'nope', reason: 'Unknown augment.' });
  });
});

describe('SpellCastingSystem.fumble', () => {
  it('lets the effect resolve on 1-6 but still hurts the caster', () => {
    const outcome = system({ roll: () => 4 }).fumble('Fire', 3);
    expect(outcome.spellGoesOff).toBe(true);
    expect(outcome.selfDamage).toBe(3);
    expect(outcome.elemental).toBe(false);
    expect(outcome.focusExplodes).toBe(false);
  });

  it('fails the effect and applies the elemental backlash on 7-9', () => {
    const outcome = system({ roll: () => 8 }).fumble('Fire', 2);
    expect(outcome.spellGoesOff).toBe(false);
    expect(outcome.elemental).toBe(true);
    expect(outcome.effect?.condition).toBe('burning');
  });

  it('detonates a carried focus above 9', () => {
    const outcome = system({ roll: () => 10 }).fumble('Fire', 1);
    expect(outcome.focusExplodes).toBe(true);
    expect(outcome.focusDamage).toBe('1d10');
    expect(outcome.focusRadius).toBe(2);
  });

  it('falls back to the mixed row for an element with no table entry', () => {
    const outcome = system({ roll: () => 8 }).fumble('Aether', 1);
    expect(outcome.effect?.name).toBe('Sparks');
  });

  it('always attributes at least 1 point of self damage', () => {
    expect(system({ roll: () => 4 }).fumble('Fire', 0).selfDamage).toBe(1);
  });
});

describe('emptyModifiers', () => {
  it('returns an independent set each call so merges cannot share arrays', () => {
    const first = emptyModifiers();
    first.bonusDamage.push('1d6');
    expect(emptyModifiers().bonusDamage).toEqual([]);
  });
});
