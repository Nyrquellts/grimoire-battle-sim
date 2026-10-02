import { beforeEach, describe, expect, it } from 'vitest';
import { BattlefieldBuilder, createTiles, FEATURE_TYPES } from '../../src/services/Battlefield';
import { DeploymentService } from '../../src/services/Deployment';
import { GridService } from '../../src/services/GridService';
import type { IActor, IState } from '../../src/entities/types';

/**
 * The builder is part of the generic foundation, so this suite imports no Witcher content: it
 * supplies its own terrain table. What it guards is the two invariants a battlefield must hold —
 * the field stays crossable, and nobody deploys inside a wall.
 */

const TERRAIN: Record<string, Record<string, unknown>> = {
  ground: { moveCost: 1, coverSp: 0, blocksMove: false, blocksLos: false },
  rubble: { moveCost: 2, coverSp: 0, blocksMove: false, blocksLos: false },
  water: { moveCost: 3, coverSp: 0, blocksMove: false, blocksLos: false },
  shallows: { moveCost: 2, coverSp: 0, blocksMove: false, blocksLos: false },
  wall: { moveCost: 99, coverSp: 30, blocksMove: true, blocksLos: true },
  tree: { moveCost: 99, coverSp: 30, blocksMove: true, blocksLos: true }
};

/** A deterministic roll so a failure is reproducible. */
function sequenceRoll(): (max: number) => number {
  let n = 0;
  return (max: number) => { n = (n * 1103515245 + 12345) & 0x7fffffff; return (n % max) + 1; };
}

function builder(): BattlefieldBuilder {
  return new BattlefieldBuilder({ terrain: { get: id => TERRAIN[id] }, roll: sequenceRoll() });
}

function actor(id: string): IActor {
  return {
    id, name: id, family: 'Human', hp: 10, maxHp: 10, sta: 10, maxSta: 10,
    dead: false, pos: { x: 0, y: 0 }, statuses: {}, morale: { state: 'steady', fear: 0 }
  } as IActor;
}

function state(): IState {
  return {
    version: 'test', phase: 'combat', round: 1, player: actor('p'), enemies: [],
    selectedEnemyId: null,
    map: { tiles: createTiles(), zones: [], objects: [], visibilityPenalty: 0 },
    turn: { side: 'player', action: 1, bonus: 0, reaction: 1, movement: 10, defensesUsed: 0, extraAttackUsed: false },
    ui: { route: [], pendingSurrender: null, latestEventId: null }
  } as unknown as IState;
}

/** Whether a path exists between the two deployment bands. */
function crossable(current: IState, build: BattlefieldBuilder): boolean {
  const zones = build.zones();
  const from = { x: zones.player.x, y: Math.floor(zones.player.y + zones.player.h / 2) };
  const to = { x: zones.enemy.x, y: Math.floor(zones.enemy.y + zones.enemy.h / 2) };
  return GridService.path(current, from, to, null).length > 0;
}

describe('createTiles', () => {
  it('sizes the array to the configured grid', () => {
    expect(createTiles()).toHaveLength(GridService.SIZE);
  });

  it('gives every tile its own coordinates', () => {
    const tiles = createTiles();
    for (let index = 0; index < GridService.SIZE; index++) {
      expect(GridService.index(tiles[index]!.x, tiles[index]!.y)).toBe(index);
    }
  });
});

describe('BattlefieldBuilder', () => {
  let current: IState;
  let build: BattlefieldBuilder;
  beforeEach(() => { current = state(); build = builder(); });

  it('fills every tile with the base terrain', () => {
    build.build(current, { base: 'rubble', features: [] });
    expect(current.map.tiles.every(tile => tile.terrainKind === 'rubble')).toBe(true);
    expect(current.map.tiles.every(tile => tile.moveCost === 2)).toBe(true);
  });

  it('copies movement, cover, and blocking from the terrain row', () => {
    build.build(current, { base: 'ground', features: [{ type: 'scatter', kind: 'wall', count: 40 }] });
    const walls = current.map.tiles.filter(tile => tile.terrainKind === 'wall');
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every(tile => tile.blocksMove && tile.blocksLos && tile.coverSp === 30)).toBe(true);
  });

  it('never places obstacles in a deployment zone', () => {
    build.build(current, { base: 'ground', features: [{ type: 'scatter', kind: 'wall', count: 400 }] });
    const zones = build.zones();
    for (const zone of [zones.player, zones.enemy]) {
      for (let y = zone.y; y < zone.y + zone.h; y++) {
        for (let x = zone.x; x < zone.x + zone.w; x++) {
          expect(GridService.tile(current, x, y)?.blocksMove).toBe(false);
        }
      }
    }
  });

  it('keeps the field crossable even when a wall is drawn right across it', () => {
    build.build(current, { base: 'ground', features: [{ type: 'wall', axis: 'y', kind: 'wall', inset: 20, gaps: 0 }] });
    expect(crossable(current, build)).toBe(true);
  });

  it('keeps the field crossable through a full-width river', () => {
    build.build(current, {
      base: 'ground',
      features: [{ type: 'river', axis: 'y', kind: 'water', edgeKind: 'shallows', width: 8, meander: 0, gaps: 0 }]
    });
    expect(crossable(current, build)).toBe(true);
  });

  it('runs a river along the axis it names, so it can separate the two sides', () => {
    build.build(current, {
      base: 'ground',
      features: [{ type: 'river', axis: 'y', kind: 'water', edgeKind: 'shallows', width: 4, meander: 0, gaps: 1 }]
    });
    const wet = current.map.tiles.filter(tile => tile.terrainKind === 'water');
    const rows = new Set(wet.map(tile => tile.y));
    const columns = new Set(wet.map(tile => tile.x));
    // A vertical course touches many rows and few columns.
    expect(rows.size).toBeGreaterThan(columns.size);
  });

  it('scales feature counts with the size of the field', () => {
    const small = build.scaleCount(10);
    GridService.configure({ width: 96, height: 64 });
    const large = builder().scaleCount(10);
    GridService.configure({ width: 48, height: 32 });
    expect(large).toBeGreaterThan(small);
  });

  it('ignores a feature type it does not know rather than throwing', () => {
    expect(() => build.build(current, { base: 'ground', features: [{ type: 'nonsense' }] })).not.toThrow();
  });

  it('ignores terrain that is not registered', () => {
    build.build(current, { base: 'ground', features: [{ type: 'scatter', kind: 'unobtainium', count: 20 }] });
    expect(current.map.tiles.some(tile => tile.terrainKind === 'unobtainium')).toBe(false);
  });

  it('records the light level on the map', () => {
    build.build(current, { base: 'ground', features: [], visibilityPenalty: -2 });
    expect(current.map.visibilityPenalty).toBe(-2);
  });

  it('exposes every shape a recipe may name', () => {
    for (const type of ['river', 'road', 'patches', 'scatter', 'cluster', 'ruins', 'camp', 'graves', 'ridge', 'hollow', 'wall']) {
      expect(FEATURE_TYPES).toContain(type);
    }
  });

  it('raises ground where a ridge runs', () => {
    build.build(current, { base: 'ground', features: [{ type: 'ridge', axis: 'y', height: 3, width: 4, meander: 0 }] });
    expect(current.map.tiles.some(tile => tile.elevation >= 2)).toBe(true);
    expect(current.map.tiles.every(tile => tile.elevation <= 4)).toBe(true);
  });
});

describe('DeploymentService', () => {
  let current: IState;
  let build: BattlefieldBuilder;
  let deploy: DeploymentService;

  beforeEach(() => {
    current = state();
    build = builder();
    deploy = new DeploymentService({ roll: sequenceRoll() });
    build.build(current, { base: 'ground', features: [{ type: 'cluster', kind: 'tree', count: 30, size: 4 }] });
  });

  it('puts the player inside their own band', () => {
    const zones = build.zones();
    deploy.placeOne(current, current.player, zones.player);
    expect(current.player.pos.x).toBeGreaterThanOrEqual(zones.player.x);
    expect(current.player.pos.x).toBeLessThan(zones.player.x + zones.player.w);
  });

  it('places a whole side without stacking anyone', () => {
    const zones = build.zones();
    current.enemies = Array.from({ length: 8 }, (_, index) => actor(`e${index}`));
    deploy.placeGroup(current, current.enemies, zones.enemy);

    const seen = new Set(current.enemies.map(enemy => `${enemy.pos.x},${enemy.pos.y}`));
    expect(seen.size).toBe(current.enemies.length);
  });

  it('never places anyone on impassable ground', () => {
    const zones = build.zones();
    current.enemies = Array.from({ length: 6 }, (_, index) => actor(`e${index}`));
    deploy.placeGroup(current, current.enemies, zones.enemy);
    for (const enemy of current.enemies) {
      expect(GridService.tile(current, enemy.pos.x, enemy.pos.y)?.blocksMove).toBe(false);
    }
  });

  it('starts the two sides far enough apart to matter', () => {
    const zones = build.zones();
    deploy.placeOne(current, current.player, zones.player);
    current.enemies = [actor('e0')];
    deploy.placeGroup(current, current.enemies, zones.enemy);

    const gap = GridService.distance(current.player.pos, current.enemies[0]!.pos);
    // Run is SPD x 3, so a 10 SPD combatant covers 30 m in a full-turn run. The field must be
    // wide enough that closing is a decision rather than a formality.
    expect(gap).toBeGreaterThan(GridService.W * 0.6);
  });
});

describe('DeploymentService — a side deploys within its reach', () => {
  let current: IState;
  let build: BattlefieldBuilder;
  let deploy: DeploymentService;

  beforeEach(() => {
    current = state();
    build = builder();
    deploy = new DeploymentService({ roll: sequenceRoll() });
    build.build(current, { base: 'ground', features: [] });
    deploy.placeOne(current, current.player, build.zones().player);
  });

  /** The horizontal gap between the player and the nearest deployed enemy. */
  function openingGap(reach: number, count = 3): number {
    current.enemies = Array.from({ length: count }, (_, index) => {
      const one = actor(`e${index}`);
      one.preferredRange = reach;
      return one;
    });
    deploy.placeGroup(current, current.enemies, build.zones().enemy);
    return Math.min(...current.enemies.map(enemy => enemy.pos.x - current.player.pos.x));
  }

  /**
   * The complaint this exists for: a bow, a crossbow and a spellbook all fall short of the far
   * edge of the field, so anyone who came to shoot spent four rounds walking before the fight
   * started at all.
   */
  it('brings a side that can shoot inside its own reach', () => {
    const archers = openingGap(16);
    const casters = openingGap(12);
    expect(archers).toBeLessThan(30);
    expect(casters).toBeLessThan(archers);
  });

  it('leaves a side with no reach the whole field to cross', () => {
    const far = build.zones().enemy.x - current.player.pos.x;
    expect(openingGap(2)).toBe(far);
    expect(openingGap(6)).toBe(far);
  });

  it('deploys a mixed warband together, at the reach of its longest arm', () => {
    // A shield wall that starts 26 m behind its own mage is not a warband.
    current.enemies = [actor('mage'), actor('sword'), actor('spear')];
    current.enemies[0]!.preferredRange = 12;
    current.enemies[1]!.preferredRange = 2;
    current.enemies[2]!.preferredRange = 2;
    deploy.placeGroup(current, current.enemies, build.zones().enemy);

    const gaps = current.enemies.map(enemy => enemy.pos.x - current.player.pos.x);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(build.zones().enemy.w);
    expect(Math.max(...gaps)).toBeLessThan(build.zones().enemy.x - current.player.pos.x);
  });

  it('never opens a fight at point blank even for a huge reach', () => {
    expect(openingGap(200)).toBeGreaterThanOrEqual(12);
  });

  it('keeps everyone on the map and off each other', () => {
    openingGap(16, 6);
    const seen = new Set(current.enemies.map(enemy => `${enemy.pos.x},${enemy.pos.y}`));
    expect(seen.size).toBe(current.enemies.length);
    for (const enemy of current.enemies) expect(GridService.inside(enemy.pos.x, enemy.pos.y)).toBe(true);
  });
});
