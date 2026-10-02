import { GridService } from './GridService';
import type { IPosition, IState, ITile } from '../entities/types';

/**
 * Battlefield construction: turns a declarative recipe into painted tiles.
 *
 * The builder is generic. It knows about *shapes* — rivers, clusters, ruins, ridges — and nothing
 * about the Witcher; which terrain a shape is made of comes from the recipe, and what that terrain
 * costs comes from the registry. Adding "a frozen lake with a broken bridge" is a content edit.
 *
 * Two invariants the builder enforces, because a battlefield that violates them is not playable:
 *
 * 1. **The field stays connected.** A river or a ruin wall could otherwise cut the map in two and
 *    make the encounter unwinnable. After painting, the builder walks the map and carves the
 *    narrowest crossing it can find until both deployment zones are mutually reachable.
 * 2. **Deployment zones stay open.** Obstacles are never placed where combatants will stand.
 *
 * Randomness comes from an injected roll so a seeded battle rebuilds tile-for-tile.
 */

/** A terrain definition as the builder reads it. */
export interface TerrainDefinition {
  moveCost?: number;
  coverSp?: number;
  blocksMove?: boolean;
  blocksLos?: boolean;
  [field: string]: unknown;
}

export interface TerrainSource {
  get(id: string): TerrainDefinition | undefined;
}

/** One shape to paint. `type` selects the generator; the rest are its parameters. */
export interface FeatureSpec {
  type: string;
  /** Terrain id this feature paints. */
  kind?: string;
  /** Secondary terrain, e.g. a river's banks or a ruin's rubble. */
  edgeKind?: string;
  /** How many of the thing. */
  count?: number;
  /** Size of each blob/clump/building. */
  size?: number;
  /** `x` runs left-to-right, `y` runs top-to-bottom. */
  axis?: 'x' | 'y';
  /** Width in tiles for rivers and roads. */
  width?: number;
  /** How much a river or road wanders. */
  meander?: number;
  /** Crossable gaps left in an otherwise impassable feature. */
  gaps?: number;
  /** Elevation applied by a ridge. */
  height?: number;
  /** Fraction of the map's shorter side to inset from the edge. */
  inset?: number;
  [field: string]: unknown;
}

/** A battlefield definition. Content, not code. */
export interface BattlefieldRecipe {
  id?: string;
  name?: string;
  /** Terrain every tile starts as. */
  base?: string;
  features?: readonly FeatureSpec[];
  /** Attack/defense penalty from light level; see `TerrainRules`. */
  visibilityPenalty?: number;
  [field: string]: unknown;
}

export interface BattlefieldDeps {
  terrain: TerrainSource;
  /** Inclusive 1..max integer roll. Injected so the kernel RNG stays the only source. */
  roll(max: number): number;
}

/** Where each side starts. Used to keep spawn ground clear and to verify connectivity. */
export interface DeploymentZones {
  player: { x: number; y: number; w: number; h: number };
  enemy: { x: number; y: number; w: number; h: number };
}

export class BattlefieldBuilder {
  readonly #deps: BattlefieldDeps;

  constructor(deps: BattlefieldDeps) { this.#deps = deps; }

  /** Deployment zones for the current grid: opposing bands down the left and right edges. */
  zones(): DeploymentZones {
    const width = GridService.W, height = GridService.H;
    const band = Math.max(2, Math.round(width * 0.1));
    return {
      player: { x: 1, y: 1, w: band, h: height - 2 },
      enemy: { x: width - band - 1, y: 1, w: band, h: height - 2 }
    };
  }

  /**
   * Paints one recipe onto `state.map.tiles`.
   *
   * The tile array must already be the right length; this rewrites its contents in place so the
   * caller's array identity (and the store's clone semantics) are preserved.
   */
  build(state: IState, recipe: BattlefieldRecipe): void {
    const zones = this.zones();
    this.#fill(state, recipe.base ?? 'ground');

    for (const feature of recipe.features ?? []) {
      const paint = FEATURES[feature.type];
      if (paint) paint(this, state, feature, zones);
    }

    this.#clearZone(state, zones.player);
    this.#clearZone(state, zones.enemy);
    this.#ensureConnected(state, zones);
    state.map.visibilityPenalty = Number(recipe.visibilityPenalty) || 0;
  }

  // -------------------------------------------------------------------------------------------
  // Painting primitives. Public so a feature generator can compose them.
  // -------------------------------------------------------------------------------------------

  /** Applies a terrain definition to one tile. Out-of-bounds writes are ignored. */
  paint(state: IState, x: number, y: number, kind: string): void {
    if (!GridService.inside(x, y)) return;
    const definition = this.#deps.terrain.get(kind);
    if (!definition) return;
    const tile = state.map.tiles[GridService.index(x, y)];
    if (!tile) return;
    tile.terrainKind = kind;
    tile.moveCost = Number(definition.moveCost) || 1;
    tile.coverSp = Number(definition.coverSp) || 0;
    tile.blocksMove = Boolean(definition.blocksMove);
    tile.blocksLos = Boolean(definition.blocksLos);
  }

  /** Raises or lowers one tile's elevation, clamped to the renderer's five bands. */
  elevate(state: IState, x: number, y: number, height: number): void {
    if (!GridService.inside(x, y)) return;
    const tile = state.map.tiles[GridService.index(x, y)];
    if (tile) tile.elevation = Math.max(0, Math.min(4, Math.round(height)));
  }

  /**
   * Scales a feature count to the actual field size.
   *
   * Recipes are written for the default grid. Without this, resizing the map would change how
   * *dense* every battlefield is rather than how *large* it is — a 4x bigger field with the same
   * eight trees is not a bigger woods, it is an empty one.
   */
  scaleCount(count: number): number {
    const scaled = count * (GridService.SIZE / REFERENCE_AREA);
    return Math.max(count > 0 ? 1 : 0, Math.round(scaled));
  }

  /** Inclusive random integer in `[min, max]`. */
  between(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.#deps.roll(max - min + 1) - 1;
  }

  /** True with the given percentage chance. */
  chance(percent: number): boolean { return this.#deps.roll(100) <= percent; }

  /** A random tile position, optionally inset from the edges. */
  randomPoint(inset = 0): IPosition {
    return {
      x: this.between(inset, GridService.W - 1 - inset),
      y: this.between(inset, GridService.H - 1 - inset)
    };
  }

  /** Paints an irregular blob centred on a point. */
  blob(state: IState, center: IPosition, radius: number, kind: string): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distance = Math.hypot(dx, dy);
        if (distance > radius) continue;
        // Feathered edge: the further out, the less likely, so blobs are not circles.
        if (distance > radius - 1 && this.chance(45)) continue;
        this.paint(state, center.x + dx, center.y + dy, kind);
      }
    }
  }

  /** True when a tile may be overwritten by scenery. */
  free(state: IState, x: number, y: number, zones: DeploymentZones): boolean {
    if (!GridService.inside(x, y)) return false;
    if (inZone(zones.player, x, y) || inZone(zones.enemy, x, y)) return false;
    const tile = state.map.tiles[GridService.index(x, y)];
    return Boolean(tile) && !tile!.blocksMove;
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  /** Resets every tile to one terrain. */
  #fill(state: IState, kind: string): void {
    for (let y = 0; y < GridService.H; y++) {
      for (let x = 0; x < GridService.W; x++) {
        const tile = state.map.tiles[GridService.index(x, y)];
        if (tile) tile.elevation = 0;
        this.paint(state, x, y, kind);
      }
    }
  }

  /** Removes obstacles from a deployment band so combatants always have somewhere to stand. */
  #clearZone(state: IState, zone: DeploymentZones['player']): void {
    for (let y = zone.y; y < zone.y + zone.h; y++) {
      for (let x = zone.x; x < zone.x + zone.w; x++) {
        const tile = state.map.tiles[GridService.index(x, y)];
        if (tile?.blocksMove) this.paint(state, x, y, 'ground');
      }
    }
  }

  /**
   * Guarantees the two deployment zones can reach each other.
   *
   * A flood fill from the player zone that never reaches the enemy zone means some feature cut the
   * map. Rather than discard the whole battlefield, the builder finds the blocked tile that is
   * closest to the frontier and clears it, repeating until the map opens. That produces a natural
   * result — a ford in a river, a collapsed section of wall — instead of a straight corridor.
   */
  #ensureConnected(state: IState, zones: DeploymentZones): void {
    for (let attempt = 0; attempt < 200; attempt++) {
      const reached = this.#floodFrom(state, zones.player);
      if (this.#zoneReached(reached, zones.enemy)) return;
      if (!this.#carveOne(state, reached, zones.enemy)) return;
    }
  }

  /** Flood fill of passable tiles from every tile in a zone. */
  #floodFrom(state: IState, zone: DeploymentZones['player']): Uint8Array {
    const seen = new Uint8Array(GridService.SIZE);
    const queue: number[] = [];
    for (let y = zone.y; y < zone.y + zone.h; y++) {
      for (let x = zone.x; x < zone.x + zone.w; x++) {
        if (!GridService.inside(x, y)) continue;
        const index = GridService.index(x, y);
        if (state.map.tiles[index]?.blocksMove || seen[index]) continue;
        seen[index] = 1;
        queue.push(index);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head]!;
      const { x, y } = GridService.pos(index);
      for (const [dx, dy] of ORTHOGONAL) {
        const nx = x + dx, ny = y + dy;
        if (!GridService.inside(nx, ny)) continue;
        const next = GridService.index(nx, ny);
        if (seen[next] || state.map.tiles[next]?.blocksMove) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    return seen;
  }

  /** Whether the flood reached any tile of a zone. */
  #zoneReached(seen: Uint8Array, zone: DeploymentZones['player']): boolean {
    for (let y = zone.y; y < zone.y + zone.h; y++) {
      for (let x = zone.x; x < zone.x + zone.w; x++) {
        if (GridService.inside(x, y) && seen[GridService.index(x, y)]) return true;
      }
    }
    return false;
  }

  /**
   * Clears the single blocked tile that best opens the map: one adjacent to the reached region and
   * nearest the far zone. Returns false when nothing can be carved.
   */
  #carveOne(state: IState, seen: Uint8Array, target: DeploymentZones['player']): boolean {
    const goal = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    let best: { index: number; score: number } | null = null;
    for (let index = 0; index < GridService.SIZE; index++) {
      if (!state.map.tiles[index]?.blocksMove) continue;
      const { x, y } = GridService.pos(index);
      const touchesReached = ORTHOGONAL.some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return GridService.inside(nx, ny) && seen[GridService.index(nx, ny)] === 1;
      });
      if (!touchesReached) continue;
      const score = Math.hypot(x - goal.x, y - goal.y);
      if (!best || score < best.score) best = { index, score };
    }
    if (!best) return false;
    const { x, y } = GridService.pos(best.index);
    this.paint(state, x, y, 'rubble');
    return true;
  }
}

/** The grid size feature counts are written against: the default 48x32 field. */
const REFERENCE_AREA = 48 * 32;

const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function inZone(zone: DeploymentZones['player'], x: number, y: number): boolean {
  return x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h;
}

/** One feature generator. */
type FeatureGenerator = (
  builder: BattlefieldBuilder,
  state: IState,
  spec: FeatureSpec,
  zones: DeploymentZones
) => void;

/**
 * The shape library.
 *
 * Each entry is deliberately small and composable. A battlefield is a list of these, so a new
 * environment is written as content rather than as code.
 */
const FEATURES: Record<string, FeatureGenerator> = {
  /** A meandering watercourse with shallow banks and crossable fords. */
  river(builder, state, spec) {
    const kind = spec.kind ?? 'water';
    const edge = spec.edgeKind ?? 'shallows';
    // `axis` names the direction the course runs, matching `road`, `ridge`, and `wall`.
    const axis = spec.axis ?? 'y';
    const along = axis === 'x' ? GridService.W : GridService.H;
    const across = axis === 'x' ? GridService.H : GridService.W;
    const width = Math.max(1, Number(spec.width) || 3);
    const meander = Math.max(0, Number(spec.meander) ?? 1);

    // Fords are carved after the course is drawn, at positions spread along its length.
    const fordCount = Math.max(0, Number(spec.gaps) ?? 1);
    const fords = new Set<number>();
    for (let i = 0; i < fordCount; i++) fords.add(builder.between(2, along - 3));

    let center = Math.round(across / 2) + builder.between(-2, 2);
    for (let step = 0; step < along; step++) {
      center += builder.between(-meander, meander);
      center = Math.max(width + 1, Math.min(across - width - 2, center));
      const isFord = [...fords].some(position => Math.abs(position - step) <= 1);
      const half = width / 2;
      for (let offset = -half - 1; offset <= half + 1; offset++) {
        const deep = Math.abs(offset) <= half - 0.5;
        const target = Math.round(center + offset);
        const x = axis === 'x' ? step : target;
        const y = axis === 'x' ? target : step;
        // A ford is shallow all the way across: that is what makes it a crossing.
        builder.paint(state, x, y, isFord ? edge : (deep ? kind : edge));
      }
    }
  },

  /** A track of easier going across the field. */
  road(builder, state, spec) {
    const kind = spec.kind ?? 'road';
    const axis = spec.axis ?? 'x';
    const along = axis === 'x' ? GridService.W : GridService.H;
    const across = axis === 'x' ? GridService.H : GridService.W;
    const width = Math.max(1, Number(spec.width) || 3);
    const meander = Math.max(0, Number(spec.meander) ?? 1);

    let center = Math.round(across / 2) + builder.between(-3, 3);
    for (let step = 0; step < along; step++) {
      center += builder.between(-meander, meander);
      center = Math.max(1, Math.min(across - 2, center));
      for (let offset = 0; offset < width; offset++) {
        const target = center + offset - Math.floor(width / 2);
        const x = axis === 'x' ? step : target;
        const y = axis === 'x' ? target : step;
        builder.paint(state, x, y, kind);
      }
    }
  },

  /** Irregular areas of a terrain: bog, snowfield, undergrowth. */
  patches(builder, state, spec, zones) {
    const kind = spec.kind ?? 'brush';
    const count = builder.scaleCount(Math.max(1, Number(spec.count) || 4));
    const size = Math.max(1, Number(spec.size) || 3);
    for (let i = 0; i < count; i++) {
      const center = builder.randomPoint(2);
      if (!builder.free(state, center.x, center.y, zones)) continue;
      builder.blob(state, center, builder.between(Math.max(1, size - 1), size + 1), kind);
    }
  },

  /** Individual obstacles dropped across the field. */
  scatter(builder, state, spec, zones) {
    const kind = spec.kind ?? 'boulder';
    const count = builder.scaleCount(Math.max(0, Number(spec.count) || 6));
    for (let i = 0; i < count; i++) {
      const point = builder.randomPoint(1);
      if (!builder.free(state, point.x, point.y, zones)) continue;
      builder.paint(state, point.x, point.y, kind);
    }
  },

  /** Obstacles in groups — a boulder field, a copse of trees. */
  cluster(builder, state, spec, zones) {
    const kind = spec.kind ?? 'largeTree';
    const groups = builder.scaleCount(Math.max(1, Number(spec.count) || 5));
    const size = Math.max(1, Number(spec.size) || 4);
    for (let group = 0; group < groups; group++) {
      const center = builder.randomPoint(2);
      const members = builder.between(Math.max(1, size - 2), size + 1);
      for (let member = 0; member < members; member++) {
        const x = center.x + builder.between(-2, 2);
        const y = center.y + builder.between(-2, 2);
        if (!builder.free(state, x, y, zones)) continue;
        builder.paint(state, x, y, kind);
      }
    }
  },

  /**
   * Ruined buildings: a wall outline with collapsed gaps, rubble inside, and the occasional
   * surviving pillar. Gaps are what make a ruin fightable rather than a box.
   */
  ruins(builder, state, spec, zones) {
    const wall = spec.kind ?? 'ruinedWall';
    const floor = spec.edgeKind ?? 'rubble';
    const buildings = builder.scaleCount(Math.max(1, Number(spec.count) || 3));
    const size = Math.max(3, Number(spec.size) || 6);

    for (let building = 0; building < buildings; building++) {
      const w = builder.between(size - 1, size + 3);
      const h = builder.between(size - 2, size + 1);
      const origin = {
        x: builder.between(2, Math.max(2, GridService.W - w - 3)),
        y: builder.between(2, Math.max(2, GridService.H - h - 3))
      };

      for (let y = origin.y; y < origin.y + h; y++) {
        for (let x = origin.x; x < origin.x + w; x++) {
          if (!builder.free(state, x, y, zones)) continue;
          const onEdge = x === origin.x || y === origin.y || x === origin.x + w - 1 || y === origin.y + h - 1;
          // A third of the wall has fallen; what is left is cover you can shoot over.
          if (onEdge) { if (!builder.chance(32)) builder.paint(state, x, y, wall); }
          else builder.paint(state, x, y, floor);
        }
      }
      // A doorway on a random side guarantees at least one clean way in.
      const doorSide = builder.between(1, 4);
      const door = doorSide === 1 ? { x: origin.x + Math.floor(w / 2), y: origin.y }
        : doorSide === 2 ? { x: origin.x + Math.floor(w / 2), y: origin.y + h - 1 }
        : doorSide === 3 ? { x: origin.x, y: origin.y + Math.floor(h / 2) }
        : { x: origin.x + w - 1, y: origin.y + Math.floor(h / 2) };
      builder.paint(state, door.x, door.y, floor);
      if (builder.chance(45)) builder.paint(state, origin.x + 1, origin.y + 1, 'pillar');
    }
  },

  /** An abandoned camp: tents, a cold firepit, carts and barrels left where they stood. */
  camp(builder, state, spec, zones) {
    const camps = builder.scaleCount(Math.max(1, Number(spec.count) || 1));
    for (let camp = 0; camp < camps; camp++) {
      const center = builder.randomPoint(4);
      builder.paint(state, center.x, center.y, 'firepit');
      const props = ['tent', 'tent', 'cart', 'barrel', 'barrel', 'crate'];
      for (const prop of props) {
        if (!builder.chance(72)) continue;
        const x = center.x + builder.between(-3, 3);
        const y = center.y + builder.between(-3, 3);
        if (!builder.free(state, x, y, zones)) continue;
        if (x === center.x && y === center.y) continue;
        builder.paint(state, x, y, prop);
      }
      // Trampled ground around a camp that was lived in.
      builder.blob(state, center, 2, 'mud');
      builder.paint(state, center.x, center.y, 'firepit');
    }
  },

  /** A graveyard: stones in rough rows, with the odd broken statue. */
  graves(builder, state, spec, zones) {
    const count = builder.scaleCount(Math.max(1, Number(spec.count) || 12));
    const origin = builder.randomPoint(4);
    for (let i = 0; i < count; i++) {
      const x = origin.x + (i % 4) * 2 + builder.between(-1, 1);
      const y = origin.y + Math.floor(i / 4) * 2 + builder.between(-1, 1);
      if (!builder.free(state, x, y, zones)) continue;
      builder.paint(state, x, y, builder.chance(15) ? 'statue' : 'gravestone');
    }
  },

  /** A ridge or gully: a band of raised (or, with negative height, framing) ground. */
  ridge(builder, state, spec) {
    const axis = spec.axis ?? 'y';
    const along = axis === 'y' ? GridService.H : GridService.W;
    const across = axis === 'y' ? GridService.W : GridService.H;
    const height = Math.max(1, Number(spec.height) || 2);
    const width = Math.max(1, Number(spec.width) || 4);
    const meander = Math.max(0, Number(spec.meander) ?? 1);

    let center = Math.round(across / 2) + builder.between(-4, 4);
    for (let step = 0; step < along; step++) {
      center += builder.between(-meander, meander);
      center = Math.max(width, Math.min(across - width - 1, center));
      for (let offset = -width; offset <= width; offset++) {
        // Terraced sides so the slope costs movement rather than being a cliff.
        const band = Math.max(0, height - Math.abs(offset));
        if (band <= 0) continue;
        const x = axis === 'y' ? center + offset : step;
        const y = axis === 'y' ? step : center + offset;
        builder.elevate(state, x, y, band);
      }
    }
  },

  /** A pit or hollow: the inverse of a ridge, cut into the base ground. */
  hollow(builder, state, spec, zones) {
    const count = builder.scaleCount(Math.max(1, Number(spec.count) || 2));
    const kind = spec.kind ?? 'mud';
    for (let i = 0; i < count; i++) {
      const center = builder.randomPoint(3);
      if (!builder.free(state, center.x, center.y, zones)) continue;
      builder.blob(state, center, builder.between(2, Number(spec.size) || 3), kind);
    }
  },

  /** A straight run of built wall, for courtyards and streets. */
  wall(builder, state, spec) {
    const kind = spec.kind ?? 'stoneWall';
    const axis = spec.axis ?? 'x';
    const inset = Math.max(0, Math.round(Number(spec.inset) || 1));
    const gaps = Math.max(0, Number(spec.gaps) ?? 2);
    const length = axis === 'x' ? GridService.W : GridService.H;
    const across = axis === 'x' ? GridService.H : GridService.W;
    const openings = new Set<number>();
    for (let i = 0; i < gaps; i++) openings.add(builder.between(2, length - 3));

    for (const line of [inset, across - 1 - inset]) {
      for (let step = 0; step < length; step++) {
        if ([...openings].some(position => Math.abs(position - step) <= 1)) continue;
        const x = axis === 'x' ? step : line;
        const y = axis === 'x' ? line : step;
        builder.paint(state, x, y, kind);
      }
    }
  }
};

/** Feature type names the builder understands, for validation and tests. */
export const FEATURE_TYPES = Object.keys(FEATURES);

/** A blank tile array sized to the current grid. */
export function createTiles(): ITile[] {
  const tiles = new Array<ITile>(GridService.SIZE);
  for (let index = 0; index < GridService.SIZE; index++) {
    const { x, y } = GridService.pos(index);
    tiles[index] = { x, y, elevation: 0, moveCost: 1, coverSp: 0, blocksMove: false, blocksLos: false, terrainKind: 'ground' };
  }
  return tiles;
}
