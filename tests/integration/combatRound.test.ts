import { afterEach, describe, expect, it } from 'vitest';
import { CombatFlow, Store } from '../../src/services/SimulationRuntime';

describe('full enemy phase', () => {
  afterEach(() => CombatFlow.reset());

  it('advances back to the player after every eligible enemy has resolved', async () => {
    const start = CombatFlow.start as unknown as (options: { lineup: Array<Record<string, unknown>>; situation: string }) => void;
    start({
      lineup: [{ foe: 'bear', variant: 'random', region: 'Temeria', experience: 'random', loadout: 'random', quantity: 1 }],
      situation: 'open'
    });
    const started = Store.read();
    expect(started.phase).toBe('combat');
    const startingRound = started.round;

    Store.update(draft => {
      draft.turn.side = 'enemy';
      draft.turn.enemyCursor = 0;
    }, { silent: true });

    await CombatFlow.runEnemyPhase();
    const finished = Store.read();
    if (finished.phase === 'combat' && !finished.ui.pendingSurrender) {
      expect(finished.turn.side).toBe('player');
      expect(finished.round).toBe(startingRound + 1);
    } else {
      expect(['ended', 'combat']).toContain(finished.phase);
    }
  });
});
