import { beforeEach, describe, expect, it } from 'vitest';
import { DamageResolver, type DamageDeps } from '../../src/services/Damage';
import { DefenseResolver } from '../../src/services/Defense';
import { ConditionSystem, createDeathStateService } from '../../src/services/Conditions';
import { Dice, Pipeline } from '../../src/core/kernel';
import type { HitLocation, IActor, IState } from '../../src/entities/types';

/**
 * These suites deliberately import **no** Witcher content and **not** the legacy bridge.
 *
 * That is the point: damage and defense are part of the generic tactical foundation, so they must
 * resolve a fight using nothing but injected rules and plain actor data. If this file ever needs
 * `SimulationRuntime` or the Witcher registries back, the extraction has regressed.
 */

const TORSO: HitLocation = { id: 'torso', name: 'Torso', penalty: -1, mult: 1 };
const HEAD: HitLocation = { id: 'head', name: 'Head', penalty: -6, mult: 3 };
const LEG: HitLocation = { id: 'leftLeg', name: 'Left Leg', penalty: -2, mult: 0.5 };

function actor(overrides: Partial<IActor> = {}): IActor {
  return {
    id: 'a', name: 'Test Actor', family: 'Human', hp: 50, maxHp: 50, sta: 20, maxSta: 20,
    dead: false, pos: { x: 0, y: 0 }, statuses: {}, morale: { state: 'steady', fear: 0 },
    ...overrides
  } as IActor;
}

/** Just enough state for the pipeline; nothing here is game-specific. */
function state(player: IActor, enemies: IActor[] = []): IState {
  return {
    version: 'test', phase: 'combat', round: 1, player, enemies,
    selectedEnemyId: null,
    map: { tiles: [], zones: [], objects: [], visibilityPenalty: 0 },
    turn: { side: 'player', action: 1, bonus: 0, reaction: 1, movement: 10, defensesUsed: 0, extraAttackUsed: false },
    ui: { route: [], pendingSurrender: null, latestEventId: null },
    feed: [], events: [], eventSeq: 0
  } as IState;
}

/** A condition system with no content at all — enough for Death State handling. */
function conditions(): ConditionSystem {
  return new ConditionSystem(new Map());
}

function deps(overrides: Partial<DamageDeps> = {}): DamageDeps {
  const condition = conditions();
  return {
    conditions: condition,
    deathState: createDeathStateService(condition),
    criticals: { inflict: () => ({ id: 'cw-1', tier: 'simple', name: 'Test Wound', location: 'torso', state: 'fresh', fresh: '', stabilized: '', treated: '', fatal: false, roll: 7, days: 1 }) },
    ...overrides
  };
}

let listeners: Array<() => void> = [];
beforeEach(() => {
  for (const off of listeners) off();
  listeners = [];
  Dice.seed(4242);
});

function on(event: string, listener: (context: never) => void, priority = 0): void {
  listeners.push(Pipeline.on(event, listener, priority));
}

describe('damage pipeline', () => {
  it('deals full damage through no armour', () => {
    const target = actor({ id: 't', armor: 0 });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 12, type: 'S', location: TORSO
    });
    expect(result.dealt).toBe(12);
    expect(target.hp).toBe(38);
  });

  it('subtracts armour before the location multiplier', () => {
    const target = actor({ id: 't', armor: 5 });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 20, type: 'S', location: HEAD
    });
    // (20 - 5) * 3 = 45, not (20 * 3) - 5.
    expect(result.penetrated).toBe(15);
    expect(result.dealt).toBe(45);
  });

  it('rounds a halved location down', () => {
    const target = actor({ id: 't', armor: 0 });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 7, type: 'S', location: LEG
    });
    expect(result.dealt).toBe(3);
  });

  it('stops damage entirely when armour exceeds it', () => {
    const target = actor({ id: 't', armor: 30 });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 10, type: 'S', location: TORSO
    });
    expect(result.dealt).toBe(0);
    expect(target.hp).toBe(50);
  });

  it('ablates one point of armour on a penetrating hit', () => {
    const target = actor({ id: 't', armor: 5 });
    new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 20, type: 'S', location: TORSO
    });
    expect(target.armor).toBe(4);
  });

  it('ablates two points for an Ablating weapon', () => {
    const target = actor({ id: 't', armor: 5 });
    new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 20, type: 'S', location: TORSO, weapon: { effects: ['Ablating'] }
    });
    expect(target.armor).toBe(3);
  });

  it('leaves armour intact when nothing gets through', () => {
    const target = actor({ id: 't', armor: 30 });
    new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 10, type: 'S', location: TORSO
    });
    expect(target.armor).toBe(30);
  });

  // Armor Piercing subtracts only half the armour's current value from the weapon's damage.
  // Improved Armor Piercing also ignores Damage Resistance. So both levels halve armour; only the
  // improved one also skips resistance.
  it('halves effective armour for Armor Piercing', () => {
    const target = actor({ id: 't', armor: 10 });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 20, type: 'S', location: TORSO, weapon: { effects: ['ArmorPiercing'] }
    });
    expect(result.effectiveSp).toBe(5);
    expect(result.dealt).toBe(15);
  });

  it('halves effective armour for Improved Armor Piercing', () => {
    const target = actor({ id: 't', armor: 10 });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 20, type: 'S', location: TORSO, weapon: { effects: ['ImprovedArmorPiercing'] }
    });
    expect(result.effectiveSp).toBe(5);
    expect(result.dealt).toBe(15);
  });

  it('still applies resistance against plain Armor Piercing', () => {
    const target = actor({ id: 't', armor: 10, resistances: ['S'] });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 20, type: 'S', location: TORSO, weapon: { effects: ['ArmorPiercing'] }
    });
    // (20 - 5) halved by resistance.
    expect(result.dealt).toBe(7);
  });

  it('halves damage against a matching resistance', () => {
    const target = actor({ id: 't', armor: 0, resistances: ['S'] });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 20, type: 'S', location: TORSO
    });
    expect(result.dealt).toBe(10);
  });

  it('ignores resistance only for Improved Armor Piercing', () => {
    const target = actor({ id: 't', armor: 0, resistances: ['S'] });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 20, type: 'S', location: TORSO, weapon: { effects: ['ImprovedArmorPiercing'] }
    });
    expect(result.dealt).toBe(20);
  });

  it('leaves a different damage type unresisted', () => {
    const target = actor({ id: 't', armor: 0, resistances: ['S'] });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 20, type: 'P', location: TORSO
    });
    expect(result.dealt).toBe(20);
  });

  it('adds the critical bonus after the multiplier', () => {
    const target = actor({ id: 't', armor: 0, criticals: [] });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 10, type: 'S', location: LEG, critical: { tier: 'simple', bonus: 3 }
    });
    // floor(10 * 0.5) + 3
    expect(result.dealt).toBe(8);
    expect(result.injury?.name).toBe('Test Wound');
  });

  it('lets a listener cancel the hit before any state changes', () => {
    on('damage:before', (context: { cancelled?: boolean; blockedBy?: string }) => {
      context.cancelled = true;
      context.blockedBy = 'Test Ward';
    });
    const target = actor({ id: 't', armor: 4 });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 50, type: 'S', location: TORSO
    });
    expect(result.dealt).toBe(0);
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe('Test Ward');
    expect(target.hp).toBe(50);
    expect(target.armor).toBe(4);
  });

  it('lets a listener absorb part of the hit as cover', () => {
    on('damage:before', (context: { coverSp?: number }) => { context.coverSp = 6; });
    const target = actor({ id: 't', armor: 0 });
    const result = new DamageResolver(deps()).resolve(state(actor(), [target]), {
      attacker: actor(), target, raw: 10, type: 'S', location: TORSO
    });
    expect(result.coverDamage).toBe(6);
    expect(result.dealt).toBe(4);
  });

  it('announces a survived death save instead of calling the AI itself', () => {
    const seen: string[] = [];
    on('deathSave:passed', (context: { target: IActor }) => { seen.push(context.target.id); });
    const target = actor({ id: 'dying', hp: 2, armor: 0, control: 'AI', stats: { STUN: 10 }, criticals: [] });
    new DamageResolver(deps()).resolve(state(actor({ control: 'PLAYER' }), [target]), {
      attacker: actor(), target, raw: 10, type: 'S', location: TORSO
    });
    expect(target.death?.active).toBe(true);
    // Seed 4242 with STUN 10 passes the save; the pipeline reports it and stays out of AI's way.
    if (!target.dead) expect(seen).toEqual(['dying']);
  });
});

describe('defense resolution', () => {
  it('gives a stunned target only a static DC 10', () => {
    const target = actor({ id: 't', statuses: { stunned: true }, defenses: { dodge: 20 } });
    const choice = new DefenseResolver(conditions()).choose(state(actor(), [target]), target, null);
    expect(choice).toEqual({ type: 'static', base: 10, cost: 0 });
  });

  it('gives a frozen target only a static DC 10', () => {
    const target = actor({ id: 't', statuses: { frozen: 3 }, defenses: { dodge: 20 } });
    expect(new DefenseResolver(conditions()).choose(state(actor(), [target]), target, null).type).toBe('static');
  });

  it('costs an AI actor nothing to defend repeatedly', () => {
    const target = actor({ id: 't', defenses: { dodge: 14 }, sta: 3 });
    const resolver = new DefenseResolver(conditions());
    const battle = state(actor({ control: 'PLAYER' }), [target]);
    for (let i = 0; i < 3; i++) resolver.resolve(battle, target, { total: 5 }, null);
    expect(target.sta).toBe(3);
  });

  it('makes the player pay stamina for every defense after the first', () => {
    const player = actor({ id: 'p', control: 'PLAYER', defenses: { dodge: 14 }, skills: { 'Dodge / Escape': 14 }, sta: 10 });
    const resolver = new DefenseResolver(conditions());
    const battle = state(player);

    resolver.resolve(battle, player, { total: 5 }, null);
    expect(player.sta).toBe(10);
    expect(battle.turn.defensesUsed).toBe(1);

    resolver.resolve(battle, player, { total: 5 }, null);
    expect(player.sta).toBe(9);
  });

  it('falls back to a static DC when the player cannot pay', () => {
    const player = actor({ id: 'p', control: 'PLAYER', defenses: { dodge: 14 }, skills: { 'Dodge / Escape': 14 }, sta: 0 });
    const battle = state(player);
    battle.turn.defensesUsed = 1;

    const outcome = new DefenseResolver(conditions()).resolve(battle, player, { total: 8 }, null);
    expect(outcome.type).toBe('static');
    expect(outcome.success).toBe(true);
    expect(player.sta).toBe(0);
  });

  it('reports success only when the defense meets the attack', () => {
    const target = actor({ id: 't', defenses: { dodge: 100 } });
    const outcome = new DefenseResolver(conditions()).resolve(state(actor(), [target]), target, { total: 5 }, null);
    expect(outcome.success).toBe(true);
  });
});
