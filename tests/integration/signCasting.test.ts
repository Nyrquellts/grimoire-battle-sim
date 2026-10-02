import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActionDispatcher, CombatFlow, Store, ZoneService } from '../../src/services/SimulationRuntime';
import { Registry } from '../../src/data/witcherContent';
import { Dice } from '../../src/core/kernel';
import type { IActor, IState } from '../../src/entities/types';

/**
 * Sign casting through the real gateway, after the action moved to `src/actions/signs.ts`.
 *
 * The first group is a behavior-preservation guard: an unaugmented Sign must cost and resolve
 * exactly as it did while the action lived in the bridge. The rest cover the added rules — focus
 * discounts, augment weaving, and gate rejection.
 */

/**
 * Reseeds immediately before an action.
 *
 * Battlefield generation consumes RNG, and how much it consumes changes whenever a recipe changes.
 * Seeding only in `beforeEach` therefore made every assertion here depend on map generation — a
 * natural 1 on the casting roll would fumble the Sign and fail an unrelated test. Seeding at the
 * point of the cast pins the roll that the assertion actually cares about.
 */
function seedThen<T>(seed: number, run: () => T): T {
  Dice.seed(seed);
  return run();
}

function startFight(): IState {
  const start = CombatFlow.start as unknown as (options: { lineup: Array<Record<string, unknown>>; situation: string }) => void;
  start({ lineup: [{ foe: 'bandit', variant: 'random', region: 'Temeria', experience: 'random', loadout: 'random', quantity: 1 }], situation: 'open' });
  return Store.read();
}

/** Puts the enemy directly beside the player so short-ranged Signs are always in range. */
function placeEnemyAdjacent(): IActor {
  Store.update(draft => {
    const enemy = draft.enemies[0];
    if (!enemy) throw new Error('No enemy spawned.');
    enemy.pos = { x: draft.player.pos.x + 1, y: draft.player.pos.y };
    draft.selectedEnemyId = enemy.id;
    draft.turn.side = 'player';
    draft.turn.action = 1;
  }, { silent: true });
  const enemy = Store.read().enemies[0];
  if (!enemy) throw new Error('No enemy spawned.');
  return enemy;
}

describe('Sign casting through the gateway', () => {
  beforeEach(() => { Dice.seed(20260908); startFight(); });
  afterEach(() => CombatFlow.reset());

  it('spends exactly the invested STA when nothing modifies the cast', () => {
    const enemy = placeEnemyAdjacent();
    const before = Store.read().player.sta;

    const result = ActionDispatcher.execute('sign', { signId: 'igni', cost: 3, targetId: enemy.id });

    expect(result.ok).toBe(true);
    expect(Store.read().player.sta).toBe(before - 3);
  });

  it('burns 5 HP per point of STA above the Vigor Threshold', () => {
    const enemy = placeEnemyAdjacent();
    const before = Store.read().player;
    const vigor = Number(before.vigor);
    const invested = vigor + 2;
    const health = before.hp;

    ActionDispatcher.execute('sign', { signId: 'igni', cost: invested, targetId: enemy.id });

    // The Sign may also damage the enemy, but the caster's own loss is the overexertion charge.
    expect(before.hp - Store.read().player.hp).toBeGreaterThanOrEqual(10);
    expect(health).toBeGreaterThan(Store.read().player.hp);
  });

  it('grants Quen one block per point of STA spent', () => {
    seedThen(7, () => ActionDispatcher.execute('sign', { signId: 'quen', cost: 3 }));
    expect(Store.read().player.quenBlocks).toBe(3);
  });

  it('places Yrden as a persistent zone', () => {
    seedThen(7, () => ActionDispatcher.execute('sign', { signId: 'yrden', cost: 2 }));
    expect(Store.read().map.zones.some(zone => zone.type === 'yrden')).toBe(true);
  });

  it('raises Active Shield with 10 HP per point of STA', () => {
    seedThen(7, () => ActionDispatcher.execute('sign', { signId: 'activeShield', cost: 3 }));
    expect(Store.read().player.activeShield?.hp).toBe(30);
  });

  it('resolves Somne, the advanced sleep Sign', () => {
    const enemy = placeEnemyAdjacent();
    Store.update(draft => { const target = draft.enemies[0]; if (target) target.defenses = { ...target.defenses, magic: -50 }; }, { silent: true });

    seedThen(7, () => ActionDispatcher.execute('sign', { signId: 'somne', cost: 2, targetId: enemy.id }));

    expect(Store.read().enemies[0]?.statuses.stunned).toBeTruthy();
  });

  it('rejects a Sign the caster cannot pay for', () => {
    const enemy = placeEnemyAdjacent();
    Store.update(draft => { draft.player.sta = 1; }, { silent: true });

    const result = ActionDispatcher.execute('sign', { signId: 'igni', cost: 5, targetId: enemy.id });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/STA/);
  });
});

describe('Magical focuses', () => {
  beforeEach(() => { Dice.seed(4242); startFight(); });
  afterEach(() => CombatFlow.reset());

  it('takes the focus value off the STA cost', () => {
    const enemy = placeEnemyAdjacent();
    Store.update(draft => { draft.player.focusItems = ['gnomishStaff']; }, { silent: true });
    const before = Store.read().player.sta;

    ActionDispatcher.execute('sign', { signId: 'igni', cost: 5, targetId: enemy.id });

    // Gnomish staff is Focus (3): 5 invested - 3 = 2 spent.
    expect(Store.read().player.sta).toBe(before - 2);
  });

  it('never lets a focus take the cost below 1', () => {
    const enemy = placeEnemyAdjacent();
    Store.update(draft => { draft.player.focusItems = ['crystalStaff']; }, { silent: true });
    const before = Store.read().player.sta;

    ActionDispatcher.execute('sign', { signId: 'igni', cost: 1, targetId: enemy.id });

    expect(Store.read().player.sta).toBe(before - 1);
  });

  it('protects the caster from overexertion by lowering the cost first', () => {
    const enemy = placeEnemyAdjacent();
    Store.update(draft => { draft.player.focusItems = ['gnomishStaff']; draft.player.vigor = 4; }, { silent: true });
    const health = Store.read().player.hp;

    seedThen(7, () => ActionDispatcher.execute('sign', { signId: 'yrden', cost: 7 }));

    // 7 invested - 3 focus = 4 spent, which is exactly the Vigor Threshold: no Health burned.
    expect(Store.read().player.hp).toBe(health);
  });
});

describe('Sign augments', () => {
  beforeEach(() => { Dice.seed(99001); startFight(); });
  afterEach(() => CombatFlow.reset());

  it('charges the augment STA on top of the investment', () => {
    const enemy = placeEnemyAdjacent();
    const before = Store.read().player.sta;

    // White flame is a 2 STA intensity augment gated at casting skill 12.
    ActionDispatcher.execute('sign', { signId: 'igni', cost: 2, targetId: enemy.id, augmentIds: ['whiteFlame'] });

    expect(Store.read().player.sta).toBe(before - 4);
  });

  it('accepts a cross-family augment only when the battlefield precondition holds', () => {
    const enemy = placeEnemyAdjacent();
    const staBefore = Store.read().player.sta;

    // Without Yrden under the target, Glyph ignition is refused and costs nothing.
    ActionDispatcher.execute('sign', { signId: 'igni', cost: 2, targetId: enemy.id, augmentIds: ['glyphIgnition'] });
    expect(Store.read().player.sta).toBe(staBefore - 2);

    // With Yrden under the target it is accepted and charged.
    Store.update(draft => {
      const target = draft.enemies[0];
      if (target) ZoneService.create(draft, { type: 'yrden', center: target.pos, radius: 3, duration: 5, power: 2, source: 'test' });
      draft.turn.action = 1;
    }, { silent: true });
    const staWithZone = Store.read().player.sta;

    ActionDispatcher.execute('sign', { signId: 'igni', cost: 2, targetId: enemy.id, augmentIds: ['glyphIgnition'] });
    expect(Store.read().player.sta).toBe(staWithZone - 4);
  });

  it('refuses to stack two augments from the same exclusive group', () => {
    const enemy = placeEnemyAdjacent();
    const before = Store.read().player.sta;

    // White flame and Piercing weave are both `intensity`; only the first is charged.
    ActionDispatcher.execute('sign', { signId: 'igni', cost: 2, targetId: enemy.id, augmentIds: ['whiteFlame', 'piercingWeave'] });

    expect(Store.read().player.sta).toBe(before - 4);
  });

  it('blocks a cast whose augmented cost the caster cannot survive', () => {
    const enemy = placeEnemyAdjacent();
    Store.update(draft => { draft.player.vigor = 1; draft.player.hp = 9; }, { silent: true });

    const result = ActionDispatcher.execute('sign', { signId: 'igni', cost: 2, targetId: enemy.id, augmentIds: ['whiteFlame'] });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Overexerting/);
  });

  it('ignores an augment whose element does not match the Sign', () => {
    const enemy = placeEnemyAdjacent();
    const before = Store.read().player.sta;

    // Hammer blow is an Air augment; Igni is Fire, so it is rejected and never charged.
    ActionDispatcher.execute('sign', { signId: 'igni', cost: 3, targetId: enemy.id, augmentIds: ['hammerBlow'] });

    expect(Store.read().player.sta).toBe(before - 3);
  });
});

describe('Magic content registration', () => {
  it('registers the elemental fumble rows', () => {
    for (const element of ['Mixed', 'Earth', 'Air', 'Fire', 'Water']) {
      expect(Registry.magicFumbles.has(element)).toBe(true);
    }
  });

  it('gives every augment a rule status and a declared cost', () => {
    for (const augment of Registry.signAugments.values()) {
      expect(typeof augment.staCost).toBe('number');
      expect(['standard', 'adapted', 'house', 'original']).toContain(augment.ruleStatus);
    }
  });

  it('gives every focus a value of at least 1', () => {
    for (const focus of Registry.focusItems.values()) expect(Number(focus.value)).toBeGreaterThanOrEqual(1);
  });
});
