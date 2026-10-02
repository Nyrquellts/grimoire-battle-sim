import { describe, expect, it } from 'vitest';
import { parseExternalState } from '../../src/data/Schemas';
import { defaultState } from '../../src/services/SimulationRuntime';

describe('external state boundary', () => {
  it('accepts a valid current state shape and rejects a malformed grid', () => {
    const state = defaultState();
    expect(parseExternalState(state).version).toBe(state.version);
    // The grid is configurable, so tile count is no longer a fixed contract. What the boundary
    // still guarantees is tile *shape*: a malformed tile must not reach the kernel.
    const malformed = structuredClone(state);
    malformed.map.tiles[0]!.moveCost = -3;
    expect(() => parseExternalState(malformed)).toThrow();

    const tooSmall = structuredClone(state);
    tooSmall.map.tiles = tooSmall.map.tiles.slice(0, 8);
    expect(() => parseExternalState(tooSmall)).toThrow();
  });
});
