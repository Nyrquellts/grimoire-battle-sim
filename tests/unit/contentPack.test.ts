import { describe, expect, it } from 'vitest';
import { RegistryHub, RegistrySchemas } from '../../src/data/RegistryHub';
import { exportContentPack, loadContentPack, parseContentPack } from '../../src/data/ContentPack';

/**
 * Content packs are the untrusted-input boundary: a pack can be hand-written or pasted in, so the
 * schemas are the only thing standing between a typo and a malformed row in front of the rules.
 *
 * These suites use a fresh `RegistryHub` rather than the live Witcher registry, so a failure here
 * is about the pack format and never about content that happens to be registered.
 */

function hub(): RegistryHub { return new RegistryHub(RegistrySchemas); }

const CHARACTER = {
  id: 'test-blade',
  name: 'Test Blade',
  identity: { gender: 'Female', age: 30, region: 'Kaedwen' },
  raceSpecies: 'Human',
  derived: { maxHp: 40, maxSta: 30, rec: 6, vigor: 0 }
};

const SCENARIO = {
  id: 'test-fight',
  name: 'Test Fight',
  situation: 'open',
  lineup: [{ foe: 'bandit', quantity: 2 }]
};

const AUGMENT = {
  id: 'testWeave',
  name: 'Test Weave',
  description: 'Adds a die.',
  staCost: 1,
  effects: { bonusDamage: ['1d6'] }
};

describe('parseContentPack', () => {
  it('accepts a minimal pack and fills defaults', () => {
    const parsed = parseContentPack({ characters: [CHARACTER] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack.formatVersion).toBe(1);
    expect(parsed.pack.characters[0]?.source.status).toBe('custom');
    expect(parsed.pack.characters[0]?.equipment.weapons).toEqual([]);
  });

  it('accepts a JSON string as readily as an object', () => {
    const parsed = parseContentPack(JSON.stringify({ scenarios: [SCENARIO] }));
    expect(parsed.ok).toBe(true);
  });

  it('reports unparseable JSON without throwing', () => {
    const parsed = parseContentPack('{ not json');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0]).toMatch(/Not valid JSON/);
  });

  it('names the offending field when a value is out of range', () => {
    const parsed = parseContentPack({ characters: [{ ...CHARACTER, derived: { maxHp: 0, maxSta: 30, rec: 6, vigor: 0 } }] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(' ')).toMatch(/maxHp/);
  });

  it('rejects an id that would not be safe as a registry key', () => {
    const parsed = parseContentPack({ characters: [{ ...CHARACTER, id: 'has spaces!' }] });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a scenario with no opposition', () => {
    const parsed = parseContentPack({ scenarios: [{ ...SCENARIO, lineup: [] }] });
    expect(parsed.ok).toBe(false);
  });

  it('rejects augment damage that is not dice notation', () => {
    const parsed = parseContentPack({ signAugments: [{ ...AUGMENT, effects: { bonusDamage: ['lots'] } }] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(' ')).toMatch(/dice notation/);
  });

  it('bounds what an authored augment may grant, so a pack cannot outrun the rules', () => {
    const tooStrong = parseContentPack({ signAugments: [{ ...AUGMENT, effects: { damageDicePerSta: 9 } }] });
    expect(tooStrong.ok).toBe(false);

    const freeCast = parseContentPack({ signAugments: [{ ...AUGMENT, staCost: -3 }] });
    expect(freeCast.ok).toBe(false);
  });

  it('marks authored augments as house rules, never standard', () => {
    const parsed = parseContentPack({ signAugments: [{ ...AUGMENT, ruleStatus: 'standard' }] });
    expect(parsed.ok).toBe(false);
  });
});

describe('loadContentPack', () => {
  it('registers every section', () => {
    const registry = hub();
    const result = loadContentPack(registry, { characters: [CHARACTER], scenarios: [SCENARIO], signAugments: [AUGMENT] });

    expect(result.ok).toBe(true);
    expect(result.added).toEqual({ characters: ['test-blade'], scenarios: ['test-fight'], signAugments: ['testWeave'] });
    expect(registry.characters.has('test-blade')).toBe(true);
    expect(registry.scenarios.has('test-fight')).toBe(true);
    expect(registry.signAugments.has('testWeave')).toBe(true);
  });

  it('skips an id that is already registered rather than overwriting it', () => {
    const registry = hub();
    loadContentPack(registry, { characters: [CHARACTER] });
    const second = loadContentPack(registry, { characters: [{ ...CHARACTER, name: 'Impostor' }] });

    expect(second.added.characters).toEqual([]);
    expect(second.skipped).toContain('character:test-blade');
    expect(registry.characters.get('test-blade')?.name).toBe('Test Blade');
  });

  it('registers nothing when the pack fails validation', () => {
    const registry = hub();
    const result = loadContentPack(registry, { characters: [{ ...CHARACTER, id: '' }] });

    expect(result.ok).toBe(false);
    expect(registry.characters.size).toBe(0);
  });

  it('loads the sections that are valid even when one row is rejected by the registry schema', () => {
    const registry = hub();
    const result = loadContentPack(registry, { characters: [CHARACTER], scenarios: [SCENARIO] });
    expect(result.added.characters).toHaveLength(1);
    expect(result.added.scenarios).toHaveLength(1);
  });
});

describe('exportContentPack', () => {
  it('round-trips through parse and load', () => {
    const source = hub();
    loadContentPack(source, { characters: [CHARACTER], scenarios: [SCENARIO], signAugments: [AUGMENT] });

    const exported = exportContentPack(source, {
      characters: ['test-blade'], scenarios: ['test-fight'], signAugments: ['testWeave']
    }, { name: 'Round trip' });

    const target = hub();
    const result = loadContentPack(target, JSON.parse(JSON.stringify(exported)));

    expect(result.ok).toBe(true);
    expect(target.characters.get('test-blade')?.name).toBe('Test Blade');
    expect(target.scenarios.get('test-fight')?.situation).toBe('open');
    expect(target.signAugments.get('testWeave')?.staCost).toBe(1);
  });

  it('ignores ids that are not registered instead of emitting holes', () => {
    const registry = hub();
    const exported = exportContentPack(registry, { characters: ['missing'] });
    expect(exported.characters).toEqual([]);
  });
});
