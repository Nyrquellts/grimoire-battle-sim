import { afterEach, describe, expect, it } from 'vitest';
import { ActionDispatcher, CombatFlow, Store } from '../../src/services/SimulationRuntime';
import { scenarioStartOptions } from '../../src/actions/scenarios';
import { loadContentPack } from '../../src/data/ContentPack';
import { Registry } from '../../src/data/witcherContent';
import type { IState } from '../../src/entities/types';

/**
 * A scenario is two steps: `CombatFlow` builds the encounter, then `scenarioOpening` applies
 * everything else through the gateway. These tests run both and assert the state that results.
 */

function run(scenarioId: string): IState {
  const scenario = Registry.scenarios.get(scenarioId);
  if (!scenario) throw new Error(`No scenario ${scenarioId}`);
  const start = CombatFlow.start as unknown as (options: { lineup: Array<Record<string, unknown>>; situation: string }) => void;
  start(scenarioStartOptions(scenario));
  ActionDispatcher.execute('scenarioOpening', { scenarioId });
  return Store.read();
}

describe('Shipped scenarios', () => {
  afterEach(() => CombatFlow.reset());

  it('registers every shipped set piece with a briefing', () => {
    expect(Registry.scenarios.size).toBeGreaterThanOrEqual(10);
    for (const scenario of Registry.scenarios.values()) {
      expect(String(scenario.name).length).toBeGreaterThan(0);
      expect(String(scenario.briefing).length).toBeGreaterThan(20);
      expect((scenario.lineup as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('builds the opposition the scenario asks for', () => {
    const state = run('nekker-warren');
    expect(state.phase).toBe('combat');
    expect(state.enemies.length).toBe(7);
  });

  it('puts the briefing in front of the player', () => {
    const state = run('the-thing-in-the-crypt');
    const entry = (state.feed ?? []).find(row => row.title === 'The Thing in the Crypt');
    expect(entry).toBeDefined();
    expect(String(entry?.story)).toMatch(/katakan|silver|invisible/i);
  });

  it('records which scenario is being played', () => {
    const state = run('griffin-above-the-crags');
    expect(state.scenario).toMatchObject({ id: 'griffin-above-the-crags', name: 'Griffin Above the Crags' });
  });

  it('builds a multi-group lineup as genuinely different opponents', () => {
    const state = run('the-mage-and-her-guard');
    expect(state.enemies.length).toBe(4);

    // A mage and a soldier are both `family: 'Human'`, so the meaningful difference is what they
    // can do: one has a spell list and a caster AI profile, the others do not.
    const casters = state.enemies.filter(enemy => Boolean(enemy.mage));
    expect(casters).toHaveLength(1);
    expect(casters[0]?.ai?.profileId).toMatch(/mage/i);
    expect(state.enemies.filter(enemy => !enemy.mage)).toHaveLength(3);
  });

  it('refuses an opening for a scenario that is not registered', () => {
    const start = CombatFlow.start as unknown as (options: { lineup: Array<Record<string, unknown>>; situation: string }) => void;
    start({ lineup: [{ foe: 'bandit', quantity: 1 }], situation: 'open' });

    const result = ActionDispatcher.execute('scenarioOpening', { scenarioId: 'not-a-scenario' });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Unknown scenario/);
  });

  /**
   * Regression: starting a plain encounter after a scenario used to leave the old scenario's name
   * and briefing attached to the new fight, because nothing cleared the field.
   */
  it('drops the scenario label when a plain encounter starts', () => {
    expect(run('roadside-toll').scenario?.id).toBe('roadside-toll');

    const start = CombatFlow.start as unknown as (options: { lineup: Array<Record<string, unknown>>; situation: string }) => void;
    start({ lineup: [{ foe: 'bandit', quantity: 1 }], situation: 'open' });

    expect(Store.read().scenario ?? null).toBeNull();
  });

  it('refuses an opening before the encounter exists', () => {
    CombatFlow.reset();
    const result = ActionDispatcher.execute('scenarioOpening', { scenarioId: 'roadside-toll' });
    expect(result.ok).toBe(false);
  });
});

describe('Authored scenarios', () => {
  afterEach(() => CombatFlow.reset());

  it('runs a scenario loaded from a pack exactly like a shipped one', () => {
    loadContentPack(Registry, {
      name: 'Integration pack',
      scenarios: [{
        id: 'authored-standoff',
        name: 'Authored Standoff',
        summary: 'Two ghouls.',
        briefing: 'Something has been at the chapel yard, and it has not been going far to eat.',
        situation: 'ruins',
        lineup: [{ foe: 'ghoul', quantity: 2, region: 'Temeria' }],
        zones: [{ type: 'poisonCloud', x: 10, y: 8, radius: 2, duration: 4 }]
      }]
    });

    const state = run('authored-standoff');

    expect(state.enemies.length).toBe(2);
    expect(state.map.zones.some(zone => zone.type === 'poisonCloud')).toBe(true);
    expect(state.scenario?.name).toBe('Authored Standoff');
  });

  it('places a scenario hazard through the same zone service a Sign uses', () => {
    loadContentPack(Registry, {
      name: 'Hazard pack',
      scenarios: [{
        id: 'authored-glyphs',
        name: 'Authored Glyphs',
        situation: 'open',
        lineup: [{ foe: 'drowner', quantity: 1 }],
        zones: [{ type: 'yrden', x: 6, y: 6, radius: 3, duration: 5, power: 2 }]
      }]
    });

    const zone = run('authored-glyphs').map.zones.find(row => row.type === 'yrden');

    expect(zone).toBeDefined();
    expect(zone?.radius).toBe(3);
    expect(zone?.power).toBe(2);
    expect(zone?.source).toBe('Authored Glyphs');
  });
});
