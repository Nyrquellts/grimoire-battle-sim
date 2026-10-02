import type { RegistryHub } from '../RegistryHub';
import type { FeatureSpec } from '../../services/Battlefield';

/**
 * Battlefields: what each environment is made of.
 *
 * A battlefield is a list of shapes from `Battlefield.ts` plus the terrain each shape is made of.
 * Nothing here is code — adding "a frozen lake with a broken bridge" means adding a row, and a
 * content pack could add one without touching the engine.
 *
 * Two things the recipes deliberately do:
 *
 * - **They vary.** Features are placed with the seeded kernel RNG, so the same battlefield is a
 *   different fight each time while still replaying exactly from a seed.
 * - **They leave lanes.** Rivers get fords, walls get gaps, ruins get doorways. The builder also
 *   guarantees connectivity, but a recipe that relies on that produces ugly maps; these are built
 *   to be crossable on their own terms.
 *
 * `visibilityPenalty` is the light level from the standard environmental effects: darkness is -2
 * to attack and defense, dim light is a lesser penalty applied the same way.
 */

interface BattlefieldRow {
  [field: string]: unknown;
  name: string;
  kind: string;
  /** One line shown in the picker. */
  summary: string;
  base: string;
  features: FeatureSpec[];
  visibilityPenalty?: number;
  /** Light level label, for the cockpit and for terrain rules. */
  lighting?: 'daylight' | 'dim' | 'darkness' | 'glaring';
}

const BATTLEFIELDS: Array<[string, BattlefieldRow]> = [
  ['open', {
    name: 'Open field', kind: 'rural',
    summary: 'Grass and a few thickets. Nowhere to hide from a crossbow.',
    base: 'grass',
    features: [
      { type: 'patches', kind: 'brush', count: 13, size: 3 },
      { type: 'scatter', kind: 'largeTree', count: 13 },
      { type: 'scatter', kind: 'rock', count: 11 },
      { type: 'ridge', axis: 'y', height: 1, width: 5, meander: 2 }
    ]
  }],

  ['woods', {
    name: 'Dense woods', kind: 'rural',
    summary: 'Close timber and undergrowth. Sightlines die at fifteen metres.',
    base: 'grass',
    features: [
      { type: 'patches', kind: 'brush', count: 31, size: 4 },
      { type: 'cluster', kind: 'largeTree', count: 35, size: 5 },
      { type: 'scatter', kind: 'deadfall', count: 22 },
      { type: 'patches', kind: 'brambles', count: 11, size: 2 }
    ]
  }],

  ['ravine', {
    name: 'Wet ravine', kind: 'rural',
    summary: 'A stream at the bottom of a cut, with high ground on both sides.',
    base: 'ground',
    features: [
      { type: 'patches', kind: 'mud', count: 14, size: 5 },
      { type: 'ridge', axis: 'y', height: 3, width: 7, meander: 1 },
      { type: 'river', axis: 'y', kind: 'water', edgeKind: 'shallows', width: 3, meander: 2, gaps: 2 },
      { type: 'scatter', kind: 'boulder', count: 31 },
      { type: 'patches', kind: 'marsh', count: 9, size: 3 }
    ]
  }],

  ['riverCrossing', {
    name: 'River crossing', kind: 'rural',
    summary: 'A wide river with one shallow ford. Whoever holds the ford holds the fight.',
    base: 'grass',
    features: [
      { type: 'river', axis: 'y', kind: 'water', edgeKind: 'shallows', width: 6, meander: 1, gaps: 1 },
      { type: 'road', axis: 'x', kind: 'road', width: 3, meander: 0 },
      { type: 'patches', kind: 'brush', count: 11, size: 3 },
      { type: 'scatter', kind: 'largeTree', count: 18 },
      { type: 'scatter', kind: 'rock', count: 13 }
    ]
  }],

  ['boulderField', {
    name: 'Boulder field', kind: 'rural',
    summary: 'Scree and standing rock. Cover everywhere, footing nowhere.',
    base: 'ground',
    features: [
      { type: 'patches', kind: 'scree', count: 18, size: 5 },
      { type: 'cluster', kind: 'boulder', count: 40, size: 4 },
      { type: 'scatter', kind: 'rock', count: 44 },
      { type: 'ridge', axis: 'x', height: 2, width: 6, meander: 2 },
      { type: 'patches', kind: 'rubble', count: 13, size: 4 }
    ]
  }],

  ['ruins', {
    name: 'Ruins / hard cover', kind: 'mixed',
    summary: 'Collapsed walls and rubble. Every angle is somebody else\'s cover.',
    base: 'ground',
    features: [
      { type: 'patches', kind: 'rubble', count: 16, size: 5 },
      { type: 'ruins', kind: 'ruinedWall', edgeKind: 'rubble', count: 11, size: 7 },
      { type: 'scatter', kind: 'pillar', count: 18 },
      { type: 'scatter', kind: 'statue', count: 7 },
      { type: 'patches', kind: 'brush', count: 11, size: 2 }
    ]
  }],

  ['abandonedCamp', {
    name: 'Abandoned camp', kind: 'rural',
    summary: 'Tents still standing, fire long cold. Whatever happened here happened fast.',
    base: 'grass',
    features: [
      { type: 'camp', count: 7 },
      { type: 'scatter', kind: 'cart', count: 7 },
      { type: 'scatter', kind: 'barrel', count: 13 },
      { type: 'scatter', kind: 'largeTree', count: 15 },
      { type: 'patches', kind: 'brush', count: 9, size: 3 }
    ]
  }],

  ['swamp', {
    name: 'Drowned marsh', kind: 'rural',
    summary: 'Bog, standing water, and dead trees. Everything here is slower than it wants to be.',
    base: 'marsh',
    features: [
      { type: 'patches', kind: 'water', count: 20, size: 4 },
      { type: 'patches', kind: 'shallows', count: 22, size: 5 },
      { type: 'scatter', kind: 'deadfall', count: 31 },
      { type: 'cluster', kind: 'largeTree', count: 13, size: 3 },
      { type: 'patches', kind: 'brambles', count: 9, size: 2 }
    ]
  }],

  ['graveyard', {
    name: 'Village graveyard', kind: 'settlement',
    summary: 'Leaning stones and soft ground. Necrophage country.',
    base: 'grass',
    features: [
      { type: 'graves', count: 48 },
      { type: 'graves', count: 35 },
      { type: 'ruins', kind: 'ruinedWall', edgeKind: 'rubble', count: 2, size: 6 },
      { type: 'scatter', kind: 'largeTree', count: 11 },
      { type: 'patches', kind: 'mud', count: 9, size: 3 }
    ]
  }],

  ['frozenLake', {
    name: 'Frozen lake', kind: 'rural',
    summary: 'Ice underfoot and snow on the banks. Run and you fall.',
    base: 'ice',
    features: [
      { type: 'patches', kind: 'snow', count: 22, size: 5 },
      { type: 'scatter', kind: 'rock', count: 18 },
      { type: 'patches', kind: 'water', count: 7, size: 2 },
      { type: 'scatter', kind: 'deadfall', count: 13 }
    ]
  }],

  ['night', {
    name: 'Night road', kind: 'road',
    summary: 'A road under a new moon. You will hear it before you see it.',
    base: 'grass',
    features: [
      { type: 'road', axis: 'x', kind: 'road', width: 4, meander: 1 },
      { type: 'cluster', kind: 'largeTree', count: 22, size: 4 },
      { type: 'patches', kind: 'brush', count: 18, size: 3 },
      { type: 'scatter', kind: 'deadfall', count: 13 }
    ],
    // Darkness: -2 to attack and defense.
    visibilityPenalty: -2, lighting: 'darkness'
  }],

  ['novigradStreet', {
    name: 'Novigrad street', kind: 'urban',
    summary: 'Brick frontages either side of a cobbled run. Nowhere to flank.',
    base: 'road',
    features: [
      { type: 'wall', axis: 'x', kind: 'brickWall', inset: 4, gaps: 3 },
      { type: 'scatter', kind: 'cart', count: 9 },
      { type: 'scatter', kind: 'barrel', count: 18 },
      { type: 'scatter', kind: 'crate', count: 13 }
    ]
  }],

  ['backAlley', {
    name: 'Urban back alley', kind: 'urban',
    summary: 'Close walls and refuse. A knife fight with architecture.',
    base: 'road',
    features: [
      { type: 'wall', axis: 'x', kind: 'brickWall', inset: 8, gaps: 2 },
      { type: 'scatter', kind: 'barrel', count: 22 },
      { type: 'scatter', kind: 'crate', count: 18 },
      { type: 'patches', kind: 'mud', count: 9, size: 2 }
    ]
  }],

  ['marketSquare', {
    name: 'Market square', kind: 'urban',
    summary: 'Stalls, carts, and a well. Plenty to put between you and a blade.',
    base: 'road',
    features: [
      { type: 'scatter', kind: 'cart', count: 18 },
      { type: 'scatter', kind: 'crate', count: 26 },
      { type: 'scatter', kind: 'barrel', count: 22 },
      { type: 'scatter', kind: 'well', count: 2 },
      { type: 'wall', axis: 'y', kind: 'brickWall', inset: 1, gaps: 4 }
    ]
  }],

  ['templeCourtyard', {
    name: 'Eternal Fire courtyard', kind: 'urban',
    summary: 'Walled stone, statues, and one way out.',
    base: 'road',
    features: [
      { type: 'wall', axis: 'x', kind: 'stoneWall', inset: 1, gaps: 2 },
      { type: 'wall', axis: 'y', kind: 'stoneWall', inset: 1, gaps: 2 },
      { type: 'scatter', kind: 'statue', count: 11 },
      { type: 'scatter', kind: 'pillar', count: 13 },
      { type: 'scatter', kind: 'barrel', count: 9 }
    ]
  }],

  ['villageLane', {
    name: 'Village lane', kind: 'settlement',
    summary: 'Wattle walls, a lane, and thatch. Everything here burns.',
    base: 'ground',
    features: [
      { type: 'road', axis: 'x', kind: 'road', width: 4, meander: 1 },
      { type: 'patches', kind: 'mud', count: 12, size: 4 },
      { type: 'ruins', kind: 'woodenWall', edgeKind: 'ground', count: 11, size: 5 },
      { type: 'scatter', kind: 'fence', count: 35 },
      { type: 'scatter', kind: 'cart', count: 7 },
      { type: 'scatter', kind: 'barrel', count: 13 }
    ]
  }],

  ['castleYard', {
    name: 'Castle / manor yard', kind: 'fortified',
    summary: 'Curtain wall and hard standing. A killing ground by design.',
    base: 'road',
    features: [
      { type: 'wall', axis: 'x', kind: 'stoneWall', inset: 0, gaps: 1 },
      { type: 'wall', axis: 'y', kind: 'stoneWall', inset: 0, gaps: 1 },
      { type: 'ruins', kind: 'stoneWall', edgeKind: 'road', count: 4, size: 6 },
      { type: 'scatter', kind: 'cart', count: 7 },
      { type: 'scatter', kind: 'crate', count: 13 },
      { type: 'scatter', kind: 'well', count: 2 }
    ]
  }]
];

/** Registers every battlefield recipe. */
export function registerBattlefieldContent(registry: RegistryHub): void {
  for (const [id, row] of BATTLEFIELDS) {
    if (!registry.battlefieldPresets.has(id)) registry.add('battlefieldPresets', id, row);
  }
}
