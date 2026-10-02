import { describe, expect, it } from 'vitest';
import { AI, ActionDispatcher, EncounterFactory, defaultState } from '../../src/services/SimulationRuntime';

describe('AI decision flow', () => {
  it('returns an action that passes the same ActionGateway validation used by players', () => {
    const state = defaultState();
    state.phase = 'combat';
    state.turn.side = 'enemy';
    const enemy = EncounterFactory.foe('bandit', 'arbalist', {
      region: 'Temeria', experience: 'trained', loadout: 'crossbow'
    });
    enemy.pos = { x: 17, y: 8 };
    state.enemies = [enemy];

    const decision = AI.Controller.decide(state, enemy);
    expect(decision).not.toBeNull();
    if (!decision) return;

    // Call through the gateway instance: `validate` is a class method and must keep `this`.
    const verdict = ActionDispatcher.validate(decision.actionName, decision.payload, state);
    expect(verdict.ok, verdict.reason).toBe(true);
  });
});
