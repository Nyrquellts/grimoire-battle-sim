import { afterEach, describe, expect, it } from 'vitest';
import { AI, ActionDispatcher, CombatFlow, Registry, Store } from '../../src/services/SimulationRuntime';
import { Dice } from '../../src/core/kernel';
import { effectiveSkill } from '../../src/services/Skills';
import { averageRoll } from '../../src/services/AiTactics';

/**
 * Mages, as opponents.
 *
 * Five mages could be beaten without taking a scratch. Three separate reasons, all guarded here:
 * they had no Spell Casting skill at all and rolled raw statistics instead; roughly a third of them
 * carried no offensive spell of any kind; and every damaging spell scored the same, so they threw
 * cantrips that could not get through armour while an 8d6 spell sat unused.
 */

function fightMages(quantity: number, seed: number) {
  Dice.seed(seed);
  const start = CombatFlow.start as unknown as (options: { lineup: Array<Record<string, unknown>>; situation: string }) => void;
  start({ lineup: [{ foe: 'mage', quantity, region: 'Temeria', experience: 'random', loadout: 'random' }], situation: 'open' });
  return Store.read();
}

describe('A mage is equipped to be a mage', () => {
  afterEach(() => CombatFlow.reset());

  it('carries the Spell Casting skill its whole threat depends on', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const mage of fightMages(3, seed).enemies) {
        expect(effectiveSkill(mage, 'Spell Casting'), mage.name).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('rolls Spell Casting to land a spell', () => {
    // A spell resolves as a Spell Casting roll the target defends against. A mage whose
    // casting is crippled must therefore miss more, which raw WILL+INT could never express.
    const state = fightMages(1, 4);
    const mage = state.enemies[0]!;
    const damaging = [...Registry.spells.values()].find(s => averageRoll((s as { damage?: string }).damage) > 0)!;
    Store.update(draft => {
      const e = draft.enemies[0]!;
      e.pos = { x: draft.player.pos.x + 2, y: draft.player.pos.y };
      e.mage!.spells = [String(damaging.name)];
      e.skills!['Spell Casting'] = 1;
      e.sta = e.maxSta;
    }, { silent: true });

    let hits = 0;
    for (let trial = 0; trial < 30; trial++) {
      Dice.seed(500 + trial);
      const before = Store.read().player.hp;
      ActionDispatcher.execute('enemyCast', { actorId: mage.id, spellId: String(damaging.id) });
      if (Store.read().player.hp < before) hits++;
      Store.update(draft => { draft.enemies[0]!.sta = draft.enemies[0]!.maxSta; }, { silent: true });
    }
    expect(hits, 'a mage that cannot cast should rarely land anything').toBeLessThan(8);
  });

  it('gives every school something it can hurt someone with', () => {
    const schools = new Map<string, boolean>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const mage of fightMages(5, seed).enemies) {
        const sheet = mage.mage as { school?: string; spells?: string[] } | undefined;
        const school = String(sheet?.school ?? '?');
        const armed = (sheet?.spells ?? []).some(name => {
          const spell = [...Registry.spells.values()].find(s => (s as { name?: string }).name === name);
          return averageRoll((spell as { damage?: string } | undefined)?.damage) > 0;
        });
        schools.set(school, (schools.get(school) ?? false) || armed);
      }
    }
    expect(schools.size).toBeGreaterThan(4);
    const harmless = [...schools.entries()].filter(entry => !entry[1]).map(entry => entry[0]);
    expect(harmless, 'these schools cannot hurt anybody').toEqual([]);
  });
});

describe('A mage reaches for the spell that will do something', () => {
  afterEach(() => CombatFlow.reset());

  it('picks its heaviest affordable spell over a cantrip', () => {
    // Terrain can sit between the two of them, and a spell with no line is not offered at all, so
    // the search is for a placement where the mage genuinely has the choice.
    for (let seed = 1; seed <= 40; seed++) {
      fightMages(1, seed);
      Store.update(draft => {
        const e = draft.enemies[0]!;
        e.pos = { x: draft.player.pos.x + 8, y: draft.player.pos.y };
        e.mage!.spells = ['Tanio Ilchar', 'Thunderbolt'];
        e.sta = e.maxSta;
      }, { silent: true });
      const live = Store.read();
      const casts = AI.LegalActions.build(live, live.enemies[0]!)
        .filter(candidate => candidate.name === 'cast')
        .sort((a, b) => b.base - a.base);
      CombatFlow.reset();
      if (casts.length < 2) continue;
      expect(String(casts[0]!.payload.spellId), 'the thunderbolt should outscore the cantrip').toBe('thunderbolt');
      return;
    }
    throw new Error('No placement in 40 seeds gave the mage a clear line to both spells.');
  });

  it('does not spend the whole fight teleporting away at full health', () => {
    const state = fightMages(1, 9);
    Store.update(draft => {
      const e = draft.enemies[0]!;
      e.pos = { x: draft.player.pos.x + 2, y: draft.player.pos.y };
      e.mage!.spells = ['Teleportation', 'Aenye'];
      e.hp = e.maxHp;
      e.sta = e.maxSta;
    }, { silent: true });
    const healthy = Store.read();
    const first = AI.Controller.decide(healthy, healthy.enemies[0]!) as unknown as { payload?: { spellId?: string } };
    expect(String(first.payload?.spellId), 'a healthy mage should fight, not blink').not.toBe('teleportation');

    Store.update(draft => { draft.enemies[0]!.hp = Math.max(1, Math.round(draft.enemies[0]!.maxHp * 0.12)); }, { silent: true });
    const hurt = Store.read();
    const second = AI.Controller.decide(hurt, hurt.enemies[0]!) as unknown as { payload?: { spellId?: string } };
    expect(String(second.payload?.spellId), 'a dying mage should get out').toBe('teleportation');
  });
});
