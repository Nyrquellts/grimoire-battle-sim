import type { IPosition, IState, ITile, IZone } from '../entities/types';
import { isActorOnMap } from '../entities/Actor';
import { GridService } from './GridService';

/** Presentation-side dirty-index tracker. It never mutates simulation state. */
export class DirtyTileService {
  #previous: IState | null = null;
  /**
   * Per-tile render versions.
   *
   * Allocated lazily and regrown when the grid is reconfigured, because the buffer must match
   * `GridService.SIZE` and the grid can be resized before a battlefield is built.
   */
  #versions = new Uint32Array(GridService.SIZE);

  /** Resets dirty history, causing the next render to paint all tiles once. */
  reset(): void {
    this.#previous = null;
    if (this.#versions.length !== GridService.SIZE) this.#versions = new Uint32Array(GridService.SIZE);
    else this.#versions.fill(0);
  }

  /** Returns the current render version of one tile. */
  version(index: number): number { return this.#versions[index] ?? 0; }

  /** Computes only the tiles whose DOM representation can have changed. */
  collect(state: IState): Set<number> {
    const dirty = new Set<number>();
    // A resize invalidates every cached index, so treat it as a first paint.
    if (this.#versions.length !== GridService.SIZE) { this.#versions = new Uint32Array(GridService.SIZE); this.#previous = null; }
    const previous = this.#previous;
    if (!previous) {
      for (let i = 0; i < GridService.SIZE; i++) dirty.add(i);
    } else {
      for (let i = 0; i < GridService.SIZE; i++) if (tileSignature(previous.map.tiles[i]) !== tileSignature(state.map.tiles[i])) dirty.add(i);
      const beforeActors = actorMap(previous), afterActors = actorMap(state);
      const ids = new Set([...beforeActors.keys(), ...afterActors.keys()]);
      for (const id of ids) {
        const before = beforeActors.get(id), after = afterActors.get(id);
        if (before !== after) { addIndex(dirty, before); addIndex(dirty, after); }
      }
      const beforeSelected = previous.selectedEnemyId ? beforeActors.get(previous.selectedEnemyId) : undefined;
      const afterSelected = state.selectedEnemyId ? afterActors.get(state.selectedEnemyId) : undefined;
      if (beforeSelected !== afterSelected) { addIndex(dirty, beforeSelected); addIndex(dirty, afterSelected); }
      if (routeKey(previous.ui.route) !== routeKey(state.ui.route)) {
        for (const point of previous.ui.route) addPos(dirty, point);
        for (const point of state.ui.route) addPos(dirty, point);
      }
      if (reachableKey(previous) !== reachableKey(state)) {
        addReachable(dirty, previous); addReachable(dirty, state);
      }
      if (zoneKey(previous.map.zones) !== zoneKey(state.map.zones)) {
        addZones(dirty, previous.map.zones); addZones(dirty, state.map.zones);
      }
      const oldEnemies = new Map(previous.enemies.map(actor => [actor.id, actor] as const));
      const newEnemies = new Map(state.enemies.map(actor => [actor.id, actor] as const));
      for (const id of new Set([...oldEnemies.keys(), ...newEnemies.keys()])) {
        const before = oldEnemies.get(id), after = newEnemies.get(id);
        if (tokenStateKey(before) !== tokenStateKey(after)) { addPos(dirty, before?.pos); addPos(dirty, after?.pos); }
      }
    }
    for (const index of dirty) this.#versions[index] = (this.#versions[index] ?? 0) + 1;
    this.#previous = state;
    return dirty;
  }
}

function addIndex(set: Set<number>, index: number | undefined): void {
  if (Number.isInteger(index) && index !== undefined && index >= 0 && index < GridService.SIZE) set.add(index);
}
function addPos(set: Set<number>, pos: IPosition | undefined): void { if (pos && GridService.inside(pos.x, pos.y)) set.add(GridService.index(pos.x, pos.y)); }
function tileSignature(tile: ITile | undefined): number {
  if (!tile) return 0;
  let hash = tile.elevation & 7;
  hash = (hash * 31 + Math.round(tile.moveCost * 10)) | 0;
  hash = (hash * 31 + tile.coverSp) | 0;
  hash = (hash * 31 + (tile.blocksMove ? 1 : 0)) | 0;
  hash = (hash * 31 + (tile.blocksLos ? 1 : 0)) | 0;
  const kind = tile.terrainKind ?? '';
  for (let i = 0; i < kind.length; i++) hash = ((hash * 33) ^ kind.charCodeAt(i)) | 0;
  return hash >>> 0;
}
function actorMap(state: IState): Map<string, number> {
  const map = new Map<string, number>();
  if (isActorOnMap(state.player)) map.set(state.player.id, GridService.index(state.player.pos.x, state.player.pos.y));
  for (const actor of state.enemies) if (isActorOnMap(actor)) map.set(actor.id, GridService.index(actor.pos.x, actor.pos.y));
  return map;
}
function routeKey(route: IPosition[]): string { return route.map(point => GridService.index(point.x, point.y)).join(','); }
function reachableKey(state: IState): string { return `${state.phase}|${state.turn.side}|${state.turn.movement}|${state.player.pos.x},${state.player.pos.y}|${state.ui.pendingSurrender ?? ''}`; }
function addReachable(set: Set<number>, state: IState): void {
  if (state.phase !== 'combat' || state.turn.side !== 'player') return;
  for (const index of GridService.reachable(state, state.player, state.turn.movement).keys()) set.add(index);
}
function zoneKey(zones: IZone[]): string { return zones.map(zone => `${zone.id ?? zone.type}:${zone.type}:${zone.x},${zone.y}:${zone.radius}:${zone.duration}`).join('|'); }
function addZones(set: Set<number>, zones: IZone[]): void {
  for (const zone of zones) {
    const radius = Math.ceil(zone.radius);
    for (let y = Math.max(0, zone.y - radius); y <= Math.min(GridService.H - 1, zone.y + radius); y++) {
      for (let x = Math.max(0, zone.x - radius); x <= Math.min(GridService.W - 1, zone.x + radius); x++) {
        if (GridService.distance(zone, { x, y }) <= zone.radius + 0.001) set.add(GridService.index(x, y));
      }
    }
  }
}

function tokenStateKey(actor: import('../entities/types').IActor | undefined): string {
  if (!actor) return 'missing';
  return JSON.stringify([actor.dead, actor.fled, actor.removed, actor.statuses?.surrendered ?? false, actor.morale?.state ?? '', actor.retreat ?? null]);
}
