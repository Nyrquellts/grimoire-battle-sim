import { describe, expect, it } from 'vitest';
import { ZoneService, baseActor, defaultState } from '../../src/services/SimulationRuntime';

describe('Zone interactions', () => {
  it('applies a registered persistent zone through ZoneService', () => {
    const state = defaultState();
    const target = baseActor({ name: 'Zone Test', family: 'Human', hp: 30, stats: { BODY: 5, STUN: 5 } });
    target.pos = { x: 10, y: 8 };
    state.enemies = [target];

    const zone = ZoneService.create(state, {
      type: 'poisonCloud', center: target.pos, radius: 2, duration: 2, source: 'test'
    });
    ZoneService.applyToActor(state, target);

    expect(state.map.zones.some(item => item.id === zone.id)).toBe(true);
    expect(Boolean(target.statuses.poisoned)).toBe(true);
  });
});
