import { describe, expect, it } from 'vitest';
import { Dice, Store } from '../../src/services/SimulationRuntime';
import { runSelfCheck, selfChecks } from '../../src/testing/SelfChecks';

/**
 * The simulation self-checks are the project's oldest behavior contracts. They used to run only
 * inside the browser at `index.html#selftest`; this suite executes every one of them headlessly so
 * a regression fails `npm test` instead of waiting to be noticed by hand.
 */
const groups = [...new Set(selfChecks.map(check => check.group))];

describe('simulation self-checks', () => {
  it('registers the full contract set', () => {
    // Guards against checks being silently dropped during extraction; raise it when checks are added.
    expect(selfChecks.length).toBeGreaterThanOrEqual(167);
  });

  for (const group of groups) {
    describe(group, () => {
      for (const check of selfChecks.filter(item => item.group === group)) {
        it(check.name, () => {
          // Each case restores the shared singletons itself so one failure cannot cascade.
          const previousState = Store.snapshot();
          const previousSeed = Dice.snapshot();
          try {
            const result = runSelfCheck(check);
            expect(result.ok, result.detail).toBe(true);
          } finally {
            Dice.restore(previousSeed);
            Store.replace(previousState, { clearHistory: false });
          }
        });
      }
    });
  }
});
