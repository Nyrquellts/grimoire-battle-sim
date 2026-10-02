import { describe, expect, it } from 'vitest';
import { abilityActionName, actorCapabilities, averageRoll, spellCandidate, tacticalInsight, terrainAffinity, zoneRisk, type InsightContext, type SpellContext, type SpellOption } from '../../src/services/AiTactics';
import type { ITile } from '../../src/entities/types';

/**
 * The tactical layer, tested on its own.
 *
 * Like `damagePipeline.test.ts` and `spellCasting.test.ts`, this suite imports no Witcher content
 * and no bridge module: terrain affinity and tactical insight are part of the generic foundation
 * and take everything they need as arguments.
 *
 * What it guards is the thing that makes enemies feel different from each other — that a mindless
 * creature is *unable* to reach these conclusions, and a clever one reaches all of them.
 */

const TERRAIN: Record<string, { effects?: Record<string, unknown> }> = {
  ground: {},
  bog: { effects: { dodgePenalty: -2, athleticsPenalty: -2 } },
  water: { effects: { dodgeUsesAthletics: true, meleePenalty: -2 } },
  rubble: { effects: {} }
};

function tile(kind: string, moveCost = 1): ITile {
  return { x: 0, y: 0, elevation: 0, moveCost, coverSp: 0, blocksMove: false, blocksLos: false, terrainKind: kind };
}

function context(overrides: Partial<InsightContext> = {}): InsightContext {
  return {
    tier: 5, distance: 3, health: 1, targetHealth: 1,
    targetWard: 0, targetShield: 0, targetStamina: 1, targetOpen: false,
    standingIn: [], elevation: 0, hasLineOfSight: true, allies: 0,
    ...overrides
  };
}

const labels = (insights: Array<{ label: string }>): string[] => insights.map(entry => entry.label);
const valueOf = (insights: Array<{ label: string; value: number }>, label: string): number =>
  insights.find(entry => entry.label === label)?.value ?? 0;

describe('terrainAffinity', () => {
  const source = { get: (id: string) => TERRAIN[id] };

  it('is neutral about open ground', () => {
    expect(terrainAffinity(tile('ground'), source)).toBe(0);
  });

  it('dislikes ground that penalises defense', () => {
    expect(terrainAffinity(tile('bog', 2), source)).toBeLessThan(0);
  });

  it('dislikes ground that costs movement', () => {
    expect(terrainAffinity(tile('rubble', 2), source)).toBeLessThan(terrainAffinity(tile('rubble', 1), source));
  });

  it('makes deep water attractive to something at home in it', () => {
    const native = terrainAffinity(tile('water', 3), source, { waterNative: true });
    const stranger = terrainAffinity(tile('water', 3), source);
    expect(native).toBeGreaterThan(0);
    expect(native).toBeGreaterThan(stranger);
  });

  it('returns zero for a tile that does not exist', () => {
    expect(terrainAffinity(undefined, source)).toBe(0);
  });
});

describe('tacticalInsight — what a mindless creature cannot work out', () => {
  const dumb = (overrides: Partial<InsightContext>) => tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 1, ...overrides }));

  it('ignores a ward it cannot reason about', () => {
    expect(dumb({ targetWard: 3 })).toEqual([]);
  });

  it('ignores an opening', () => {
    expect(dumb({ targetOpen: true })).toEqual([]);
  });

  it('keeps fighting while badly hurt', () => {
    expect(tacticalInsight({ name: 'reposition', tags: ['movement'] }, context({ tier: 1, health: 0.2 }))).toEqual([]);
  });
});

describe('tacticalInsight — reading the target', () => {
  it('devalues attacking through a standing ward', () => {
    const insights = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 2, targetWard: 3 }));
    expect(labels(insights)).toContain('target is warded');
    expect(valueOf(insights, 'target is warded')).toBeLessThan(0);
  });

  it('treats an Active Shield as a ward too', () => {
    const insights = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 2, targetShield: 30 }));
    expect(labels(insights)).toContain('target is warded');
  });

  it('commits hard to an opening', () => {
    const insights = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 2, targetOpen: true }));
    expect(valueOf(insights, 'target is open')).toBeGreaterThan(0);
  });

  it('does not spend a control action on an already-controlled target', () => {
    const insights = tacticalInsight({ name: 'control', tags: ['control'] }, context({ tier: 2, targetOpen: true }));
    expect(valueOf(insights, 'already controlled')).toBeLessThan(0);
  });

  it('presses a target who has run out of Stamina', () => {
    const insights = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 4, targetStamina: 0.1 }));
    expect(valueOf(insights, 'target is out of Stamina')).toBeGreaterThan(0);
  });

  it('closes on a target still holding enough Stamina to cast', () => {
    const insights = tacticalInsight({ name: 'reposition', tags: ['movement'] }, context({ tier: 4, targetStamina: 0.9, distance: 12 }));
    expect(valueOf(insights, 'close before they can cast')).toBeGreaterThan(0);
  });

  it('finishes a wounded opponent', () => {
    const insights = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 4, targetHealth: 0.2 }));
    expect(valueOf(insights, 'finishing a wounded opponent')).toBeGreaterThan(0);
  });
});

describe('tacticalInsight — using the ground', () => {
  it('values height for a ranged attack', () => {
    const insights = tacticalInsight({ name: 'shoot', tags: ['ranged'] }, context({ tier: 3, elevation: 2 }));
    expect(valueOf(insights, 'shooting from height')).toBeGreaterThan(0);
  });

  it('avoids standing in a hazard', () => {
    const insights = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 3, standingIn: ['yrden'] }));
    expect(valueOf(insights, 'standing in a hazard')).toBeLessThan(0);
  });

  it('will not swing at something it cannot see', () => {
    const insights = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 3, hasLineOfSight: false }));
    expect(valueOf(insights, 'no clear line')).toBeLessThan(0);
  });

  it('breaks off rather than trading to death', () => {
    const move = tacticalInsight({ name: 'reposition', tags: ['movement'] }, context({ tier: 3, health: 0.2 }));
    const swing = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 3, health: 0.2 }));
    expect(valueOf(move, 'breaking off while hurt')).toBeGreaterThan(0);
    expect(valueOf(swing, 'bad trade while hurt')).toBeLessThan(0);
  });
});

describe('tacticalInsight — reading the whole engagement', () => {
  it('keeps its distance when outnumbered and the target is fresh', () => {
    const insights = tacticalInsight({ name: 'reposition', tags: ['movement'] }, context({ tier: 5, allies: 0, targetHealth: 0.9 }));
    expect(valueOf(insights, 'outnumbered: keep the distance')).toBeGreaterThan(0);
  });

  it('presses the advantage with a pack behind it', () => {
    const insights = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 5, allies: 3 }));
    expect(valueOf(insights, 'pack advantage')).toBeGreaterThan(0);
  });

  it('gives every adjustment a label, because the AI must stay explainable', () => {
    const insights = tacticalInsight({ name: 'attack', tags: ['attack'] }, context({ tier: 5, targetOpen: true, targetHealth: 0.2, allies: 2 }));
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.label).toBeTruthy();
      expect(insight.value).not.toBe(0);
    }
  });
});

describe('abilityActionName', () => {
  const option = (tags: string[]) => ({ id: 'x', ability: { tags }, utility: 1 });

  it('scores an ability as the kind of thing it is', () => {
    expect(abilityActionName(option(['attack', 'movement']))).toBe('attack');
    expect(abilityActionName(option(['movement']))).toBe('reposition');
    expect(abilityActionName(option(['defense']))).toBe('defend');
    expect(abilityActionName(option(['support']))).toBe('support');
    expect(abilityActionName(option(['control']))).toBe('control');
    expect(abilityActionName(option([]))).toBe('control');
  });
});

describe('zoneRisk — hazards threaten what they declare, not who the engine recognises', () => {
  const caps = (overrides: Partial<{ capabilities: string[]; susceptibilities: string[]; immunities: string[] }> = {}) => ({
    capabilities: new Set(overrides.capabilities ?? []),
    susceptibilities: new Set(overrides.susceptibilities ?? []),
    immunities: new Set(overrides.immunities ?? [])
  });
  const zone = (threat: Record<string, unknown>) => [{ def: { threat }, zone: { type: 'x' } }];

  it('is zero on a tile with no hazard', () => {
    expect(zoneRisk([], caps())).toBe(0);
  });

  it('threatens everyone when the zone names no condition', () => {
    expect(zoneRisk(zone({ risk: 28 }), caps())).toBe(28);
  });

  it('spares an actor immune to what the zone inflicts', () => {
    expect(zoneRisk(zone({ risk: 28, negatedBy: 'ordinaryFire' }), caps({ immunities: ['ordinaryFire'] }))).toBe(0);
    expect(zoneRisk(zone({ risk: 28, negatedBy: 'ordinaryFire' }), caps())).toBe(28);
  });

  it('threatens only actors with the capability it targets', () => {
    const threat = { risk: 24, threatens: ['magic'] };
    expect(zoneRisk(zone(threat), caps({ capabilities: ['magic'] }))).toBe(24);
    expect(zoneRisk(zone(threat), caps())).toBe(0);
  });

  it('also threatens actors whose own stat block lists the weakness', () => {
    const threat = { risk: 22, threatens: ['incorporeal'], susceptibleTo: ['Yrden'] };
    expect(zoneRisk(zone(threat), caps({ susceptibilities: ['Yrden'] }))).toBe(22);
    expect(zoneRisk(zone(threat), caps({ capabilities: ['incorporeal'] }))).toBe(22);
    expect(zoneRisk(zone(threat), caps())).toBe(0);
  });

  it('adds up overlapping hazards', () => {
    const stacked = [...zone({ risk: 28 }), ...zone({ risk: 18 })];
    expect(zoneRisk(stacked, caps())).toBe(46);
  });

  it('ignores a zone that declares no threat', () => {
    expect(zoneRisk([{ def: {}, zone: { type: 'x' } }], caps())).toBe(0);
  });
});

describe('actorCapabilities — read from the actor, never from its species', () => {
  const noTags = () => false;
  const actor = (fields: Record<string, unknown>) => fields as never;

  it('marks a declared caster as a magic user', () => {
    expect(actorCapabilities(actor({ mage: { school: 'fire', spells: [] } }), noTags).capabilities.has('magic')).toBe(true);
  });

  it('marks anything with the Spell Casting skill as a magic user', () => {
    expect(actorCapabilities(actor({ skills: { 'Spell Casting': 7 } }), noTags).capabilities.has('magic')).toBe(true);
  });

  it('marks a creature whose abilities cast as a magic user', () => {
    const hasTag = (_: unknown, tag: string) => tag === 'usesMagic';
    expect(actorCapabilities(actor({}), hasTag).capabilities.has('magic')).toBe(true);
  });

  it('leaves a beast with no capabilities', () => {
    expect(actorCapabilities(actor({ family: 'Beast' }), noTags).capabilities.size).toBe(0);
  });

  it('reads susceptibilities from both places they can be recorded', () => {
    const found = actorCapabilities(actor({ vulnerabilities: ['Fire'], abilities: ['Yrden'] }), noTags);
    expect(found.susceptibilities.has('Fire')).toBe(true);
    expect(found.susceptibilities.has('Yrden')).toBe(true);
  });
});

describe('spellCandidate — a caster weighs its own spellbook', () => {
  const spell = (over: Partial<SpellOption> = {}): SpellOption =>
    ({ id: 's', cost: 5, range: 12, damage: '4d6', tags: ['damage'], ...over });
  const at = (over: Partial<SpellContext> = {}): SpellContext =>
    ({ distance: 6, health: 1, woundedAlly: null, hasLineOfSight: true, tier: 3, ...over });

  it('reads the average off a dice notation', () => {
    expect(averageRoll('4d6')).toBe(14);
    expect(averageRoll('8d6')).toBe(28);
    expect(averageRoll('2d6+2')).toBe(9);
    expect(averageRoll('0')).toBe(0);
    expect(averageRoll(null)).toBe(0);
  });

  /**
   * The defect this function exists for: every damaging spell used to score a flat 82 with a flat
   * expected damage of 16, so a mage was as happy to throw a 1d6 cantrip as an 8d6 thunderbolt —
   * and a cantrip cannot get through armour at all.
   */
  it('prefers the heavier spell', () => {
    const cantrip = spellCandidate(spell({ damage: '1d6' }), at())!;
    const thunder = spellCandidate(spell({ damage: '8d6' }), at())!;
    expect(thunder.base).toBeGreaterThan(cantrip.base);
    expect(thunder.expectedDamage).toBeGreaterThan(cantrip.expectedDamage);
  });

  it('reports real expected damage rather than a flat guess', () => {
    expect(spellCandidate(spell({ damage: '5d6' }), at())!.expectedDamage).toBe(17.5);
  });

  it('will not offer a spell that cannot reach, or that has nothing to aim at', () => {
    expect(spellCandidate(spell({ range: 5 }), at({ distance: 9 }))).toBeNull();
    expect(spellCandidate(spell(), at({ hasLineOfSight: false }))).toBeNull();
  });

  it('offers a heal only when somebody is hurt, and values it by the wound', () => {
    const healing = spell({ damage: '0', tags: ['heal'] });
    expect(spellCandidate(healing, at())).toBeNull();
    const light = spellCandidate(healing, at({ woundedAlly: 0.7 }))!;
    const grave = spellCandidate(healing, at({ woundedAlly: 0.1 }))!;
    expect(grave.base).toBeGreaterThan(light.base);
  });

  /**
   * A healthy mage used to blink away every single round the moment anything came within 4 m, then
   * walk back in and do it again — five mages could spend a whole fight teleporting.
   */
  it('blinks away because it is hurt, not because something is close', () => {
    const escape = spell({ damage: '0', tags: ['escape'] });
    expect(spellCandidate(escape, at({ distance: 10 })), 'nothing to escape from').toBeNull();

    const healthy = spellCandidate(escape, at({ distance: 2, health: 1 }))!;
    const dying = spellCandidate(escape, at({ distance: 2, health: 0.1 }))!;
    expect(dying.base).toBeGreaterThan(healthy.base);

    // At full health, standing and casting must beat running away.
    const attack = spellCandidate(spell({ damage: '4d6' }), at({ distance: 2 }))!;
    expect(healthy.base).toBeLessThan(attack.base);
    // Nearly dead, it goes.
    expect(dying.base).toBeGreaterThan(attack.base);
  });

  /**
   * Magic Screen and Mirror Ward deal nothing and inflict nothing, so resolving them changes
   * nothing — and three mages once spent an entire fight casting Magic Screen every round.
   */
  it('will not offer a spell that does nothing when it resolves', () => {
    expect(spellCandidate(spell({ damage: '0', tags: ['defense'], effects: [] }), at())).toBeNull();
    expect(spellCandidate(spell({ damage: '0', range: 0, tags: ['defense'] }), at())).toBeNull();
  });

  it('offers a no-damage spell that does inflict something', () => {
    const slick = spellCandidate(spell({ damage: '0', tags: ['control'], effects: ['KnockDown50'] }), at());
    expect(slick).not.toBeNull();
  });

  it('still values a control spell that does no damage', () => {
    const control = spellCandidate(spell({ damage: '0', tags: ['control'], effects: ['Freeze100'] }), at())!;
    expect(control.controlValue).toBeGreaterThan(0);
    expect(control.tags).toContain('control');
  });

  it('lets a sharper mind reach further up its list', () => {
    const dull = spellCandidate(spell({ damage: '8d6' }), at({ tier: 1 }))!;
    const sharp = spellCandidate(spell({ damage: '8d6' }), at({ tier: 5 }))!;
    expect(sharp.base).toBeGreaterThan(dull.base);
  });
});
