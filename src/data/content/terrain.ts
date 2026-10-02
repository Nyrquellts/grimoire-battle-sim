import type { RegistryHub } from '../RegistryHub';

/**
 * Terrain: what the ground is, what it costs to cross, and what it does to a fight.
 *
 * One tile is one metre. A terrain row is pure data — movement cost, cover, whether it blocks
 * movement or sight, and a set of declarative combat effects. `Battlefield.ts` paints these onto
 * tiles and `TerrainRules.ts` applies the effects; neither names a specific terrain.
 *
 * ## Where the numbers come from
 *
 * **Cover SP** follows the standard common-cover values; each row below carries its own number.
 *
 * **Combat effects** follow the standard environmental rules:
 * - swampy or overgrown ground: a -2 penalty to Dodge/Escape and Athletics;
 * - water: melee ROF drops to 1, attacks, blocks and parries take -2, Athletics stands in for
 *   Dodge/Escape, only spears can be thrown, and bows and crossbows lose three quarters of their
 *   range and half of their damage on top of the -2;
 * - snow and ice: running or attacking calls for a DC:14 Athletics check, and failure drops you prone.
 *
 * **Movement cost in metres per tile is an adaptation.** The tabletop rules describe terrain
 * qualitatively and leave the cost to the game master; a tile grid has to put a number on it. Costs
 * here are conservative — difficult ground is 2, deep water and heavy rubble are 3 — and are
 * marked `ruleStatus: 'adapted'` rather than dressed up as standard rules.
 */

/** Declarative combat effects a tile can impose. Every field is optional. */
export interface TerrainEffects {
  /** Penalty to Dodge/Escape while standing here. */
  dodgePenalty?: number;
  /** Penalty to Athletics while standing here. */
  athleticsPenalty?: number;
  /** Penalty to melee attack, block, and parry. */
  meleePenalty?: number;
  /** Penalty to ranged attacks made from here. */
  rangedPenalty?: number;
  /** Divides the range of bows and crossbows fired from here. */
  rangedRangeDivisor?: number;
  /** Halves ranged damage dealt from here. */
  rangedDamageHalved?: boolean;
  /** Forces multi-shot weapons down to one attack. */
  meleeRofOne?: boolean;
  /** Dodging uses Athletics instead of Dodge/Escape. */
  dodgeUsesAthletics?: boolean;
  /** Thrown weapons other than spears do not function. */
  thrownDisabled?: boolean;
  /** Athletics DC to stay standing after running or attacking. */
  footingDc?: number;
  /** Halves the distance a reposition covers. */
  halfLeap?: boolean;
}

interface TerrainRow {
  [field: string]: unknown;
  name: string;
  /** Single character drawn on the tile. Empty means no glyph. */
  glyph: string;
  /** CSS class the renderer toggles. */
  cssClass: string;
  moveCost: number;
  coverSp: number;
  blocksMove: boolean;
  blocksLos: boolean;
  /** Short line for the tile tooltip. */
  description: string;
  effects?: TerrainEffects;
  ruleStatus: 'standard' | 'adapted' | 'house' | 'original';
}

const TERRAIN: Array<[string, TerrainRow]> = [
  // ---- open ground ---------------------------------------------------------------------------
  ['ground', {
    name: 'Open ground', glyph: '', cssClass: 'terrain-ground',
    moveCost: 1, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Firm footing. Nothing helps you and nothing hinders you.',
    ruleStatus: 'adapted'
  }],
  ['road', {
    name: 'Road', glyph: '', cssClass: 'terrain-road',
    moveCost: 1, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Packed earth or cobbles. Fast, open, and watched.',
    ruleStatus: 'adapted'
  }],
  ['grass', {
    name: 'Long grass', glyph: '', cssClass: 'terrain-grass',
    moveCost: 1, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Knee-high growth. Slows nothing, hides little.',
    ruleStatus: 'adapted'
  }],

  // ---- difficult ground ----------------------------------------------------------------------
  ['brush', {
    name: 'Undergrowth', glyph: '', cssClass: 'terrain-brush',
    moveCost: 2, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Overgrown ground. You have to watch your feet as much as your opponent.',
    effects: { dodgePenalty: -2, athleticsPenalty: -2 },
    ruleStatus: 'standard'
  }],
  ['brambles', {
    name: 'Brambles', glyph: '#', cssClass: 'terrain-brambles',
    moveCost: 2, coverSp: 7, blocksMove: false, blocksLos: false,
    description: 'Thorn thicket. Cover if you crouch in it, a nuisance if you fight in it.',
    effects: { dodgePenalty: -2, athleticsPenalty: -2 },
    ruleStatus: 'standard'
  }],
  ['marsh', {
    name: 'Bog', glyph: '~', cssClass: 'terrain-marsh',
    moveCost: 2, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Soft, sucking ground. Every step is a decision.',
    effects: { dodgePenalty: -2, athleticsPenalty: -2 },
    ruleStatus: 'standard'
  }],
  ['mud', {
    name: 'Churned mud', glyph: '', cssClass: 'terrain-mud',
    moveCost: 2, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Trampled and waterlogged. Slow going.',
    effects: { athleticsPenalty: -2 },
    ruleStatus: 'adapted'
  }],
  ['rubble', {
    name: 'Rubble', glyph: '', cssClass: 'terrain-rubble',
    moveCost: 2, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Broken stone underfoot. Awkward to cross, worse to fall on.',
    ruleStatus: 'adapted'
  }],
  ['scree', {
    name: 'Scree', glyph: '', cssClass: 'terrain-scree',
    moveCost: 2, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Loose slope. It moves when you do.',
    effects: { footingDc: 14 },
    ruleStatus: 'adapted'
  }],

  // ---- water ---------------------------------------------------------------------------------
  ['shallows', {
    name: 'Shallows', glyph: '', cssClass: 'terrain-shallows',
    moveCost: 2, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Ankle to knee deep. Enough to slow you and to hide what is under it.',
    effects: { athleticsPenalty: -2 },
    ruleStatus: 'adapted'
  }],
  ['water', {
    name: 'Deep water', glyph: '', cssClass: 'terrain-water',
    moveCost: 3, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Chest deep or worse. Everything a swordsman knows works less well here.',
    effects: {
      meleePenalty: -2, rangedPenalty: -2, rangedRangeDivisor: 4, rangedDamageHalved: true,
      meleeRofOne: true, dodgeUsesAthletics: true, thrownDisabled: true, halfLeap: true
    },
    ruleStatus: 'standard'
  }],

  // ---- cold ----------------------------------------------------------------------------------
  ['snow', {
    name: 'Deep snow', glyph: '', cssClass: 'terrain-snow',
    moveCost: 2, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Knee deep and treacherous.',
    effects: { footingDc: 14 },
    ruleStatus: 'standard'
  }],
  ['ice', {
    name: 'Ice', glyph: '', cssClass: 'terrain-ice',
    moveCost: 1, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Frozen and unforgiving. Fight carefully or fight on your back.',
    effects: { footingDc: 14 },
    ruleStatus: 'standard'
  }],

  // ---- natural obstacles ---------------------------------------------------------------------
  ['largeTree', {
    name: 'Large tree', glyph: 'T', cssClass: 'terrain-tree',
    moveCost: 99, coverSp: 30, blocksMove: true, blocksLos: true,
    description: 'Old growth. Solid cover and a solid obstacle.',
    ruleStatus: 'standard'
  }],
  ['boulder', {
    name: 'Boulder', glyph: 'O', cssClass: 'terrain-boulder',
    moveCost: 99, coverSp: 30, blocksMove: true, blocksLos: true,
    description: 'A rock big enough to put a fight on the other side of.',
    ruleStatus: 'adapted'
  }],
  ['rock', {
    name: 'Low rock', glyph: 'n', cssClass: 'terrain-rock',
    moveCost: 99, coverSp: 20, blocksMove: true, blocksLos: false,
    description: 'Waist high. Cover you can shoot over.',
    ruleStatus: 'adapted'
  }],
  ['deadfall', {
    name: 'Deadfall', glyph: '=', cssClass: 'terrain-deadfall',
    moveCost: 2, coverSp: 10, blocksMove: false, blocksLos: false,
    description: 'A fallen trunk. Something to put between you and a charge.',
    ruleStatus: 'adapted'
  }],

  // ---- built ---------------------------------------------------------------------------------
  ['stoneWall', {
    name: 'Stone wall', glyph: '', cssClass: 'terrain-stone-wall',
    moveCost: 99, coverSp: 30, blocksMove: true, blocksLos: true,
    description: 'Dressed stone. It does not care what hits it.',
    ruleStatus: 'standard'
  }],
  ['brickWall', {
    name: 'Brick wall', glyph: '', cssClass: 'terrain-brick-wall',
    moveCost: 99, coverSp: 25, blocksMove: true, blocksLos: true,
    description: 'Mortared brick.',
    ruleStatus: 'standard'
  }],
  ['woodenWall', {
    name: 'Wooden wall', glyph: '', cssClass: 'terrain-wood-wall',
    moveCost: 99, coverSp: 5, blocksMove: true, blocksLos: true,
    description: 'Planking. It stops sight, not much else.',
    ruleStatus: 'standard'
  }],
  ['ruinedWall', {
    name: 'Ruined wall', glyph: '', cssClass: 'terrain-ruin-wall',
    moveCost: 99, coverSp: 25, blocksMove: true, blocksLos: false,
    description: 'Collapsed to chest height. Cover you can see and shoot over.',
    ruleStatus: 'adapted'
  }],
  ['heavyDoor', {
    name: 'Heavy wooden door', glyph: '+', cssClass: 'terrain-door',
    moveCost: 99, coverSp: 15, blocksMove: true, blocksLos: true,
    description: 'Barred, or simply stuck.',
    ruleStatus: 'standard'
  }],
  ['steelDoor', {
    name: 'Steel door', glyph: '+', cssClass: 'terrain-door',
    moveCost: 99, coverSp: 20, blocksMove: true, blocksLos: true,
    description: 'Iron-bound. Somebody wanted this shut.',
    ruleStatus: 'standard'
  }],
  ['cart', {
    name: 'Cart', glyph: 'c', cssClass: 'terrain-cart',
    moveCost: 99, coverSp: 10, blocksMove: true, blocksLos: false,
    description: 'Abandoned where its axle broke.',
    ruleStatus: 'standard'
  }],
  ['barrel', {
    name: 'Wooden barrel', glyph: 'o', cssClass: 'terrain-barrel',
    moveCost: 99, coverSp: 10, blocksMove: true, blocksLos: false,
    description: 'Salted fish, or something that used to be.',
    ruleStatus: 'standard'
  }],
  ['tent', {
    name: 'Tent', glyph: 'A', cssClass: 'terrain-tent',
    moveCost: 99, coverSp: 5, blocksMove: true, blocksLos: true,
    description: 'Canvas. It hides you and protects you from nothing.',
    ruleStatus: 'standard'
  }],
  ['crate', {
    name: 'Crates', glyph: 'x', cssClass: 'terrain-crate',
    moveCost: 99, coverSp: 10, blocksMove: true, blocksLos: false,
    description: 'Stacked and left behind.',
    ruleStatus: 'adapted'
  }],
  ['fence', {
    name: 'Fence', glyph: '', cssClass: 'terrain-fence',
    moveCost: 2, coverSp: 5, blocksMove: false, blocksLos: false,
    description: 'Low rails. Slow to cross, barely cover at all.',
    ruleStatus: 'adapted'
  }],
  ['firepit', {
    name: 'Cold firepit', glyph: '*', cssClass: 'terrain-firepit',
    moveCost: 1, coverSp: 0, blocksMove: false, blocksLos: false,
    description: 'Ash and stones. Somebody camped here and did not break camp.',
    ruleStatus: 'adapted'
  }],
  ['gravestone', {
    name: 'Gravestone', glyph: 't', cssClass: 'terrain-grave',
    moveCost: 99, coverSp: 20, blocksMove: true, blocksLos: false,
    description: 'Leaning, weathered, and older than the village.',
    ruleStatus: 'adapted'
  }],
  ['statue', {
    name: 'Broken statue', glyph: 'i', cssClass: 'terrain-statue',
    moveCost: 99, coverSp: 25, blocksMove: true, blocksLos: true,
    description: 'Nobody remembers who it was of.',
    ruleStatus: 'adapted'
  }],
  ['well', {
    name: 'Well', glyph: 'w', cssClass: 'terrain-well',
    moveCost: 99, coverSp: 15, blocksMove: true, blocksLos: false,
    description: 'Stone-ringed and very deep.',
    ruleStatus: 'adapted'
  }],
  ['pillar', {
    name: 'Fallen pillar', glyph: 'I', cssClass: 'terrain-pillar',
    moveCost: 2, coverSp: 20, blocksMove: false, blocksLos: false,
    description: 'Toppled column. Climb it or shelter behind it.',
    ruleStatus: 'adapted'
  }]
];

/** Every terrain id, for generators and tests. */
export const TERRAIN_IDS = TERRAIN.map(([id]) => id);

/** Registers the terrain table. */
export function registerTerrainContent(registry: RegistryHub): void {
  for (const [id, row] of TERRAIN) {
    if (!registry.terrain.has(id)) registry.add('terrain', id, row);
  }
}
