import { describe, expect, it } from 'vitest';
import { CORE_BESTIARY_STATS } from '../../src/data/raw/coreBestiaryStats';
import { SUPPLEMENT_BESTIARY_STATS } from '../../src/data/raw/supplementBestiaryStats';
import { Registry } from '../../src/data/witcherContent';
import { baseActor } from '../../src/services/SimulationRuntime';
import { Dice } from '../../src/core/kernel';

/**
 * Guards the bestiary data.
 *
 * The stat blocks in `coreBestiaryStats.ts` and `supplementBestiaryStats.ts` are overlaid onto the
 * profiles in `witcherData.ts` at registration. This suite checks two different things:
 *
 * 1. **Spot checks**, hand-typed literals for a few creatures. If a block ever ends up in the wrong
 *    column or the wrong row, these fail. They are deliberately literal.
 * 2. **That the stat blocks actually reach the registry**, because the numbers only matter if the
 *    merge in `witcherContent.ts` puts them in front of the rules.
 *
 * Balance is not tested and does not need to be: the numbers are the contract.
 */

describe('Core stat blocks hold the expected numbers', () => {
  it('drowner', () => {
    const drowner = CORE_BESTIARY_STATS.drowner!;
    expect(drowner.stats).toMatchObject({ INT: 1, REF: 7, DEX: 7, BODY: 6, SPD: 6, EMP: 1, CRA: 1, WILL: 4, LUCK: 0, STUN: 5 });
    expect(drowner).toMatchObject({ hp: 25, sta: 25, rec: 5, vigor: 0, armor: 0, run: 18, leap: 3, enc: 60 });
    expect(drowner.skills).toMatchObject({ Brawling: 6, Athletics: 6, Awareness: 8, Endurance: 6, Courage: 8 });
    // Claws 3d6, ROF 1 — the sim previously had 2d6+2, which is where this suite came from.
    expect(drowner.attacks).toHaveLength(1);
    expect(drowner.attacks[0]).toMatchObject({ name: 'Claws', damage: '3d6', rof: 1 });
  });

  it('griffin', () => {
    const griffin = CORE_BESTIARY_STATS.griffin!;
    expect(griffin).toMatchObject({ hp: 100, sta: 50, rec: 10, armor: 8 });
    expect(griffin.attacks.map(attack => `${attack.name} ${attack.damage}`))
      .toEqual(['Claws 6d6', 'Bite 7d6+2']);
  });

  it('nekker', () => {
    expect(CORE_BESTIARY_STATS.nekker).toMatchObject({ hp: 15, sta: 15, rec: 3, armor: 0 });
  });

  it('records a construct with no Stamina rather than inventing one', () => {
    // The golem does not tire, so it has no Stamina pool at all.
    expect(CORE_BESTIARY_STATS.golem!.sta).toBeNull();
    expect(CORE_BESTIARY_STATS.golem).toMatchObject({ hp: 80, armor: 20, rec: 8 });
  });
});

describe('Every core stat block is complete and self-consistent', () => {
  const entries = Object.entries(CORE_BESTIARY_STATS);

  it('covers the core bestiary', () => {
    expect(entries.length).toBeGreaterThanOrEqual(18);
  });

  it('carries all ten statistics', () => {
    for (const [id, block] of entries) {
      for (const stat of ['INT', 'REF', 'DEX', 'BODY', 'SPD', 'EMP', 'CRA', 'WILL', 'LUCK', 'STUN']) {
        expect(block.stats[stat], `${id}.${stat}`).toBeTypeOf('number');
      }
    }
  });

  it('carries the derived values', () => {
    for (const [id, block] of entries) {
      expect(block.hp, `${id}.hp`).toBeGreaterThan(0);
      expect(block.rec, `${id}.rec`).toBeGreaterThan(0);
      expect(block.run, `${id}.run`).toBeGreaterThan(0);
      expect(block.armor, `${id}.armor`).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives every creature a skill list and at least one attack', () => {
    for (const [id, block] of entries) {
      expect(Object.keys(block.skills).length, `${id} skills`).toBeGreaterThan(0);
      expect(block.attacks.length, `${id} attacks`).toBeGreaterThan(0);
    }
  });

  it('writes attacks in dice notation with a real damage type', () => {
    for (const [id, block] of entries) {
      for (const attack of block.attacks) {
        expect(attack.damage, `${id}/${attack.name}`).toMatch(/^\d+d\d+([+-]\d+)?$/);
        expect(['S', 'P', 'B'], `${id}/${attack.name}`).toContain(attack.type);
        expect(attack.rof, `${id}/${attack.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('derives defenses from the stats and skills, never from a flat guess', () => {
    for (const [id, block] of entries) {
      const ref = block.stats.REF ?? 0;
      const will = block.stats.WILL ?? 0;
      const dodge = skill(block.skills, 'Dodge');
      const resist = skill(block.skills, 'Resist Magic');
      expect(block.dodgeDefense, `${id} dodge`).toBe(ref + dodge);
      expect(block.magicDefense, `${id} magic`).toBe(will + resist);
    }
  });
});

describe('Stat blocks reach the rules', () => {
  it('registers the stat block numbers, not the old approximations', () => {
    const drowner = Registry.bestiary.get('drowner')!;
    expect(drowner.hp).toBe(25);
    expect(drowner.sta).toBe(25);
    expect(drowner.rec).toBe(5);
    expect(drowner.attacks[0].damage).toBe('3d6');
    expect(drowner.defenses.dodge).toBe(12);
    expect(Object.keys(drowner.skills).length).toBeGreaterThan(5);
  });

  it('keeps the project-only fields a stat block does not carry', () => {
    const drowner = Registry.bestiary.get('drowner')!;
    expect(drowner.family).toBe('Necrophage');
    expect(drowner.silver).toBe(true);
    expect(drowner.vulnerabilities).toContain('Fire');
  });

  it('carries no provenance bookkeeping on registered creatures', () => {
    for (const row of Registry.bestiary.values()) {
      expect(row, String(row.id)).not.toHaveProperty('sourcePage');
      expect(row, String(row.id)).not.toHaveProperty('transcribed');
    }
  });

  it('composes a construct without a broken Stamina pool', () => {
    // `baseActor` draws from the shared kernel RNG. Restoring it keeps this suite from shifting
    // the dice stream that later suites — the simulation self-checks especially — depend on.
    const seed = Dice.snapshot();
    try {
      const golem = baseActor({ ...Registry.bestiary.get('golem') });
      expect(Number.isNaN(Number(golem.sta))).toBe(false);
      expect(Number.isNaN(Number(golem.maxSta))).toBe(false);
    } finally {
      Dice.restore(seed);
    }
  });
});

/** Skills are written as `Dodge/Escape`; names vary slightly between entries. */
function skill(skills: Record<string, number>, prefix: string): number {
  const key = Object.keys(skills).find(name => name.toLowerCase().startsWith(prefix.toLowerCase().slice(0, 6)));
  return key ? skills[key]! : 0;
}

describe('Supplement stat blocks', () => {
  it('covers the supplement bestiaries', () => {
    expect(Object.keys(SUPPLEMENT_BESTIARY_STATS).length).toBeGreaterThanOrEqual(35);
  });

  it('gives defense bases rather than deriving them', () => {
    for (const [id, block] of Object.entries(SUPPLEMENT_BESTIARY_STATS)) {
      expect(block.dodgeDefense, `${id} dodge`).toBeTypeOf('number');
      expect(block.blockDefense, `${id} block`).toBeTypeOf('number');
    }
  });

  it('gives every attack an ATK base', () => {
    for (const [id, block] of Object.entries(SUPPLEMENT_BESTIARY_STATS)) {
      for (const attack of block.attacks) {
        expect(attack.attack, `${id}/${attack.name}`).toBeGreaterThan(0);
        expect(attack.damage, `${id}/${attack.name}`).toMatch(/^\d+d\d+([+-]\d+)?$/);
      }
    }
  });

  it('reaches the registry, replacing the engine approximations', () => {
    const bruxa = Registry.bestiary.get('bruxa')!;
    expect(bruxa.sta).toBe(SUPPLEMENT_BESTIARY_STATS.bruxa!.sta);
    expect(bruxa.attacks[0].attack).toBe(SUPPLEMENT_BESTIARY_STATS.bruxa!.attacks[0]!.attack);
  });
});

describe('Stat block coverage', () => {
  /**
   * Two profiles are authored rather than overlaid, and that is deliberate.
   *
   * The True Dragon and the Higher Vampire carry hand-built attack definitions the encounter,
   * variant, and defeat-narration systems key on. Their numbers already match the supplement block
   * exactly — HP 150/STA 80/REC 16/armour 25 and HP 100/STA 60/REC 12/armour 8 — so overlaying a
   * block would have replaced working behaviour to change nothing. The spot check below is what
   * holds them honest.
   */
  const AUTHORED = new Set(['truedragon', 'highervampire']);

  it('gives every creature a stat block except the two authored exceptional ones', () => {
    const covered = new Set([...Object.keys(CORE_BESTIARY_STATS), ...Object.keys(SUPPLEMENT_BESTIARY_STATS)]);
    const missing = [...Registry.bestiary.values()]
      .map(row => String(row.id))
      .filter(id => !covered.has(id) && !AUTHORED.has(id));
    expect(missing).toEqual([]);
  });

  it('holds the authored creatures to the reference numbers anyway', () => {
    expect(Registry.bestiary.get('truedragon')).toMatchObject({ hp: 150, sta: 80, rec: 16, armor: 25 });
    expect(Registry.bestiary.get('highervampire')).toMatchObject({ hp: 100, sta: 60, rec: 12, armor: 8 });
  });

  it('gives everything a Stamina pool except constructs, which do not tire', () => {
    // A construct's stat block has no Stamina at all. Reading that back off the stat blocks is
    // better than naming the creatures here.
    const tireless = new Set([
      ...Object.entries(CORE_BESTIARY_STATS).filter(([, block]) => block.sta === null).map(([id]) => id),
      ...Object.entries(SUPPLEMENT_BESTIARY_STATS).filter(([, block]) => block.sta === null).map(([id]) => id)
    ]);
    expect(tireless.size).toBeGreaterThan(0);

    const noStamina = [...Registry.bestiary.values()]
      .filter(row => row.sta === undefined || row.sta === null)
      .map(row => String(row.id))
      .filter(id => !tireless.has(id));
    expect(noStamina).toEqual([]);
  });

  /**
   * Known limitation, recorded rather than hidden.
   *
   * `bear` and `greatbear` carry identical profiles: one bear-shaped block (80/REF 7/BODY 12)
   * serves both, so the pair has stats but is not distinguished. Separating them needs the second
   * block (35/5/8) assigned to the right creature; guessing would put the wrong numbers on a real
   * creature, which is worse than leaving them equal.
   */
  it('has bear and great bear on the same profile, which is a known limitation', () => {
    const bear = Registry.bestiary.get('bear')!;
    const great = Registry.bestiary.get('greatbear')!;
    expect(bear.hp).toBe(great.hp);
  });
});
