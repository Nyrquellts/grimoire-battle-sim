import { describe, expect, it } from 'vitest';
import { DirtyTileService } from '../../src/services/DirtyTileService';
import { GridService } from '../../src/services/GridService';
import { defaultState } from '../../src/services/SimulationRuntime';

describe('DirtyTileService', () => {
  it('paints the full grid only for the first snapshot', () => {
    const service = new DirtyTileService();
    const state = defaultState();
    expect(service.collect(state).size).toBe(GridService.SIZE);
    expect(service.collect(state).size).toBe(0);
  });

  it('marks only the old and new token positions for an isolated move', () => {
    const service = new DirtyTileService();
    const first = defaultState();
    service.collect(first);
    const next = structuredClone(first);
    const from = GridService.index(next.player.pos.x, next.player.pos.y);
    next.player.pos.x += 1;
    const to = GridService.index(next.player.pos.x, next.player.pos.y);
    const dirty = service.collect(next);
    expect(dirty.has(from)).toBe(true);
    expect(dirty.has(to)).toBe(true);
    expect(dirty.size).toBeLessThan(16);
  });
});
