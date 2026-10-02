import type { IActor, IPosition, IState, ITile } from '../entities/types';
import { isActorOnMap } from '../entities/Actor';

export interface GridNode extends IPosition { actorId?: string; cost?: number; index?: number }
export interface LosResult { clear: boolean; blockedAt?: IPosition; cover: number }

/**
 * Tactical grid dimensions.
 *
 * One tile is one metre, which is what makes the size a rules question rather than a display one:
 * a crossbow reaches 50 m and Run is SPD x 3, so a field small enough to cross in two turns erases
 * the difference between a skirmisher and a brawler. The default is deliberately larger than the
 * original 24x16.
 *
 * Held in a module-level record rather than as frozen constants so a scenario can size its own
 * field. Everything downstream reads `GridService.SIZE`, so changing it here is enough — but it
 * must be changed *before* a battlefield is built, never mid-fight.
 */
const dimensions = { width: 48, height: 32 };

/** Flat-index tactical grid. Hot paths use integer indices; boundaries use `{x, y}`. */
export const GridService = Object.freeze({
  get W(): number { return dimensions.width; },
  get H(): number { return dimensions.height; },
  get SIZE(): number { return dimensions.width * dimensions.height; },

  /**
   * Resizes the grid. Call before building a battlefield; existing tile arrays are not migrated.
   *
   * Bounds keep pathfinding and the persistent DOM grid sane: below 8 there is no room to
   * manoeuvre, and above 128 the renderer would mount more nodes than a browser should hold.
   */
  configure(next: { width?: number; height?: number }): { width: number; height: number } {
    const width = clampDimension(next.width ?? dimensions.width);
    const height = clampDimension(next.height ?? dimensions.height);
    dimensions.width = width;
    dimensions.height = height;
    return { width, height };
  },

  /** Converts a 2D coordinate to a 0-allocation flat index. */
  index(x: number, y: number): number { return (y * dimensions.width) + x; },

  /** Converts a flat index back to x/y. */
  pos(index: number): IPosition { return { x: index % dimensions.width, y: (index / dimensions.width) | 0 }; },

  /** Bounds check. */
  inside(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < dimensions.width && y < dimensions.height; },

  /** Reads a tile from the pre-sized flat array. */
  tile(state: IState, x: number, y: number): ITile | undefined {
    return this.inside(x, y) ? state.map.tiles[(y * dimensions.width) + x] : undefined;
  },

  /** Enumerates legal neighboring nodes and their movement costs. */
  neighbors(state: IState, node: GridNode): Array<IPosition & { cost: number; index: number }> {
    const out: Array<IPosition & { cost: number; index: number }> = [];
    const here = this.tile(state, node.x, node.y);
    const hereElev = here?.elevation ?? 0;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const;
    for (const [dx, dy] of dirs) {
      const x = node.x + dx, y = node.y + dy;
      if (!this.inside(x, y)) continue;
      const tile = this.tile(state, x, y);
      if (!tile || tile.blocksMove || isOccupied(state, x, y, node.actorId)) continue;
      const cost = (dx && dy ? 1.4 : 1) * (tile.moveCost || 1) + Math.max(0, (tile.elevation || 0) - hereElev);
      out.push({ x, y, cost, index: this.index(x, y) });
    }
    return out;
  },

  /** Euclidean A* heuristic. */
  heuristic(a: IPosition, b: IPosition): number { return Math.hypot(a.x - b.x, a.y - b.y); },

  /** A* path using typed arrays for scores/parents and integer node keys. */
  path(state: IState, start: IPosition, goal: IPosition, actorId: string | null = null): IPosition[] {
    if (!this.inside(start.x, start.y) || !this.inside(goal.x, goal.y)) return [];
    const startIndex = this.index(start.x, start.y), goalIndex = this.index(goal.x, goal.y);
    const came = new Int16Array(this.SIZE); came.fill(-1);
    const gScore = new Float64Array(this.SIZE); gScore.fill(Infinity); gScore[startIndex] = 0;
    const closed = new Uint8Array(this.SIZE);
    const open: Array<{ index: number; x: number; y: number; g: number; f: number }> = [
      { index: startIndex, x: start.x, y: start.y, g: 0, f: this.heuristic(start, goal) }
    ];
    // The guard scales with the field: a fixed cap would silently fail to path on a large map.
    const guardLimit = this.SIZE * 4;
    let guard = 0;
    while (open.length && guard++ < guardLimit) {
      open.sort((a, b) => a.f - b.f);
      const current = open.shift();
      if (!current) break;
      const currentIndex = current.index;
      if (closed[currentIndex]) continue;
      closed[currentIndex] = 1;
      if (currentIndex === goalIndex) {
        const path: IPosition[] = [];
        let index = currentIndex;
        while (index >= 0) {
          path.push(this.pos(index));
          if (index === startIndex) break;
          index = came[index] ?? -1;
        }
        return path.reverse();
      }
      for (const next of this.neighbors(state, { ...current, actorId: actorId ?? undefined })) {
        const nextIndex = next.index;
        const nextG = current.g + next.cost;
        if (closed[nextIndex] || nextG >= (gScore[nextIndex] ?? Infinity)) continue;
        gScore[nextIndex] = nextG;
        came[nextIndex] = currentIndex;
        open.push({ index: nextIndex, x: next.x, y: next.y, g: nextG, f: nextG + this.heuristic(next, goal) });
      }
    }
    return [];
  },

  /** Integer Bresenham line traversal. */
  bresenham(a: IPosition, b: IPosition): IPosition[] {
    let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const cells: IPosition[] = [];
    while (true) {
      cells.push({ x: x0, y: y0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return cells;
  },

  /** Resolves line of sight and directional cover intersection. */
  los(state: IState, a: IPosition, b: IPosition): LosResult {
    const line = this.bresenham(a, b);
    let cover = 0;
    const startElev = this.tile(state, a.x, a.y)?.elevation ?? 0;
    const endElev = this.tile(state, b.x, b.y)?.elevation ?? 0;
    for (let i = 1; i < line.length - 1; i++) {
      const cell = line[i];
      if (!cell) continue;
      const tile = this.tile(state, cell.x, cell.y);
      if (!tile) continue;
      if (tile.blocksLos && tile.elevation >= Math.min(startElev, endElev)) return { clear: false, blockedAt: cell, cover: tile.coverSp || 0 };
      if (tile.coverSp) cover = Math.max(cover, tile.coverSp);
    }
    return { clear: true, cover };
  },

  /** Euclidean tactical distance in map meters. */
  distance(a: IPosition, b: IPosition): number { return Math.hypot(a.x - b.x, a.y - b.y); },

  /** Dijkstra reachable-set search using flat integer keys. */
  reachable(state: IState, actor: IActor, maxMove: number): Map<number, number> {
    const start = this.index(actor.pos.x, actor.pos.y);
    const costs = new Float64Array(this.SIZE); costs.fill(Infinity); costs[start] = 0;
    const frontier: Array<{ index: number; x: number; y: number; cost: number }> = [{ index: start, x: actor.pos.x, y: actor.pos.y, cost: 0 }];
    const result = new Map<number, number>([[start, 0]]);
    while (frontier.length) {
      frontier.sort((a, b) => a.cost - b.cost);
      const current = frontier.shift();
      if (!current || current.cost > (costs[current.index] ?? Infinity)) continue;
      for (const next of this.neighbors(state, { ...current, actorId: actor.id })) {
        const cost = current.cost + next.cost;
        if (cost <= maxMove && cost < (costs[next.index] ?? Infinity)) {
          costs[next.index] = cost;
          result.set(next.index, cost);
          frontier.push({ index: next.index, x: next.x, y: next.y, cost });
        }
      }
    }
    return result;
  },

  /** Computes exact movement cost for an already-resolved path. */
  pathCost(state: IState, path: IPosition[]): number {
    let cost = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (!a || !b) continue;
      const tile = this.tile(state, b.x, b.y);
      if (!tile) continue;
      cost += (a.x !== b.x && a.y !== b.y ? 1.4 : 1) * (tile.moveCost || 1)
        + Math.max(0, tile.elevation - (this.tile(state, a.x, a.y)?.elevation ?? 0));
    }
    return cost;
  }
});

/** Returns whether a coordinate is occupied by an active actor other than exceptId. */
export function isOccupied(state: IState, x: number, y: number, exceptId: string | null = null): boolean {
  if (state.player.pos.x === x && state.player.pos.y === y && state.player.id !== exceptId && isActorOnMap(state.player)) return true;
  return state.enemies.some(actor => actor.id !== exceptId && isActorOnMap(actor) && actor.pos.x === x && actor.pos.y === y);
}

/** Keeps a configured dimension inside what pathfinding and the DOM grid can carry. */
function clampDimension(value: number): number {
  const rounded = Math.round(Number(value) || 0);
  return Math.max(8, Math.min(128, rounded));
}
