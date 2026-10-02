import { describe, expect, it } from 'vitest';
import { Rules } from '../../src/services/SimulationRuntime';

describe('Critical wound thresholds', () => {
  it('preserves the existing attack-margin tier thresholds', () => {
    expect(Rules.criticalFromMargin(6)).toBeNull();
    expect(Rules.criticalFromMargin(7)).toEqual({ tier: 'simple', bonus: 3 });
    expect(Rules.criticalFromMargin(10)).toEqual({ tier: 'complex', bonus: 5 });
    expect(Rules.criticalFromMargin(13)).toEqual({ tier: 'difficult', bonus: 8 });
    expect(Rules.criticalFromMargin(15)).toEqual({ tier: 'deadly', bonus: 10 });
  });
});
