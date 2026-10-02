import { describe, expect, it } from 'vitest';
import { GridService } from '../../src/services/GridService';
import type { IActor, IState, ITile } from '../../src/entities/types';

function actor(id: string, x: number, y: number): IActor {
  return { id, name: id, family: 'Human', hp: 10, maxHp: 10, sta: 10, maxSta: 10, dead: false, pos: { x, y }, statuses: {}, morale: { state: 'steady', fear: 0 } };
}
function state(): IState {
  const tiles: ITile[] = Array.from({ length: GridService.SIZE }, (_, index) => ({ ...GridService.pos(index), elevation: 0, moveCost: 1, coverSp: 0, blocksMove: false, blocksLos: false }));
  return { version: 'test', phase: 'combat', round: 1, player: actor('p', 0, 0), enemies: [], selectedEnemyId: null, map: { tiles, zones: [], objects: [], visibilityPenalty: 0 }, turn: { side: 'player', action: 1, bonus: 0, reaction: 1, movement: 10, defensesUsed: 0, extraAttackUsed: false }, ui: { route: [], pendingSurrender: null, latestEventId: null } };
}

describe('GridService', () => {
  it('round-trips every integer coordinate on the configured grid', () => {
    for (let i = 0; i < GridService.SIZE; i++) expect(GridService.index(GridService.pos(i).x, GridService.pos(i).y)).toBe(i);
  });

  it('routes around a blocking wall without string coordinate keys', () => {
    const s = state();
    for (let y = 0; y < 4; y++) s.map.tiles[GridService.index(2, y)]!.blocksMove = true;
    const path = GridService.path(s, { x: 0, y: 0 }, { x: 4, y: 0 }, 'p');
    expect(path.length).toBeGreaterThan(0);
    expect(path.some(point => point.x === 2 && point.y < 4)).toBe(false);
  });
});
