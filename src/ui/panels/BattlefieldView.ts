import type { IActor, IState, ITile, RegistryEntry } from '../../entities/types';

/**
 * Painting one tactical tile.
 *
 * Extracted from the presentation bridge when terrain became content. The rule it exists to hold is
 * simple: **a tile's appearance comes from its terrain row**, so adding a terrain is a data edit and
 * never a change here. Before this, four terrain kinds were hardcoded as class toggles and anything
 * else rendered as bare ground.
 *
 * The function is deliberately imperative and mutates the nodes it is given. That is the point: the
 * grid's 1,536 nodes are mounted once and only dirty indices are touched, so this must not allocate
 * or rebuild anything.
 */

/** The child nodes each persistent tile owns. */
export interface TileRefs {
  x: number;
  y: number;
  height: HTMLElement;
  ground: HTMLElement;
  zone: HTMLElement;
  stack: HTMLElement;
  token: HTMLElement;
}

/** A tile element plus the bookkeeping the painter keeps on it. */
export interface TileNode extends HTMLElement {
  _tileRefs: TileRefs;
  _terrainClass?: string;
}

/** One zone covering a tile, as the zone service reports it. */
export interface ZoneMeta {
  def: { cssClass: string; glyph: string; name: string };
  zone: { duration: number };
}

export interface PaintContext {
  state: IState;
  tile: ITile;
  index: number;
  /** Terrain rows by id. */
  terrain: Map<string, RegistryEntry>;
  /** Every zone css class, so stale ones can be cleared. */
  zoneClasses: readonly string[];
  /** Zones covering this tile. */
  zoneMeta: ZoneMeta[];
  /** The actor standing here, if any. */
  actor: IActor | undefined;
  /** Whether the tile is inside the current reachable set. */
  reachable: boolean;
  /** Whether the tile is on the previewed route. */
  onRoute: boolean;
  /** Render version, used by tests to prove only dirty tiles were touched. */
  version: number;
  /** Whether an actor is routing off the field, for its token style. */
  isRouting(actor: IActor): boolean;
}

/** Repaints one tile in place. */
export function paintTile(tileEl: TileNode, context: PaintContext): void {
  const { tile, state } = context;
  const refs = tileEl._tileRefs;
  const elevation = tile.elevation || 0;

  for (let band = 0; band <= 4; band++) tileEl.classList.toggle(`h${band}`, band === elevation);

  // Terrain paints itself from its registry row. Swapping one class rather than toggling every
  // known terrain keeps this O(1) as the terrain table grows.
  const terrain = context.terrain.get(String(tile.terrainKind));
  const wantClass = String(terrain?.cssClass || 'terrain-ground');
  if (tileEl._terrainClass !== wantClass) {
    if (tileEl._terrainClass) tileEl.classList.remove(tileEl._terrainClass);
    tileEl.classList.add(wantClass);
    tileEl._terrainClass = wantClass;
  }
  refs.ground.hidden = !terrain?.glyph;
  refs.ground.textContent = String(terrain?.glyph || '');

  tileEl.classList.toggle('cover', Boolean(tile.coverSp));
  tileEl.classList.toggle('blocked', Boolean(tile.blocksMove));
  tileEl.classList.toggle('reachable', context.reachable);
  tileEl.classList.toggle('route', context.onRoute);
  tileEl.dataset.version = String(context.version);

  const activeZoneClasses = new Set(context.zoneMeta.map(row => row.def.cssClass));
  for (const cssClass of context.zoneClasses) tileEl.classList.toggle(cssClass, activeZoneClasses.has(cssClass));
  refs.zone.hidden = !context.zoneMeta.length;
  refs.zone.textContent = context.zoneMeta[0]?.def.glyph || '';
  refs.stack.hidden = context.zoneMeta.length <= 1;
  refs.stack.textContent = context.zoneMeta.length > 1 ? `+${context.zoneMeta.length - 1}` : '';
  refs.height.hidden = elevation <= 0;
  refs.height.textContent = elevation > 0 ? `H${elevation}` : '';

  tileEl.title = tileTooltip(tile, terrain, elevation, context.zoneMeta);
  paintToken(refs.token, context.actor, state, context.isRouting);
}

/**
 * The hover text.
 *
 * Worth getting right: movement cost and cover are the two numbers a player needs to plan a turn,
 * and on a 48x32 field they cannot all be held in the head.
 */
export function tileTooltip(
  tile: ITile,
  terrain: RegistryEntry | undefined,
  elevation: number,
  zoneMeta: readonly ZoneMeta[]
): string {
  const name = String(terrain?.name || 'Ground');
  const movement = tile.blocksMove ? ' · impassable' : ` · ${tile.moveCost} m`;
  const cover = tile.coverSp ? ` · cover ${tile.coverSp} SP` : '';
  const height = elevation ? ` · H${elevation}` : '';
  const zones = zoneMeta.length
    ? ` · ${zoneMeta.map(row => `${row.def.name} ${row.zone.duration}r`).join(' · ')}`
    : '';
  return `${name}${movement}${cover}${height}${zones}`;
}

/** Draws whoever is standing on the tile, or clears the token. */
function paintToken(
  token: HTMLElement,
  actor: IActor | undefined,
  state: IState,
  isRouting: (actor: IActor) => boolean
): void {
  if (!actor) {
    token.hidden = true;
    token.textContent = '';
    token.className = 'token';
    return;
  }
  token.hidden = false;
  if (actor.id === state.player.id) {
    token.className = 'token player';
    token.textContent = String(actor.name || 'PC').slice(0, 3).toUpperCase();
    return;
  }
  const surrendered = actor.statuses?.surrendered ? ' surrendered' : '';
  const routing = isRouting(actor) ? ' routing' : '';
  const selected = state.selectedEnemyId === actor.id ? ' selected' : '';
  token.className = `token enemy${surrendered}${routing}${selected}`;
  token.textContent = String(actor.baseName || actor.name).slice(0, 3).toUpperCase();
}
