import type { IState } from '../entities/types';
import { DirtyTileService } from '../services/DirtyTileService';
import { GridService } from '../services/GridService';

/** Minimal persistent-grid primitive used by the browser compatibility view during migration. */
export class TacticalMapDomCache {
  readonly #nodes: HTMLButtonElement[] = [];
  readonly #dirty = new DirtyTileService();

  /** Creates the 384 tile nodes once. */
  initialize(container: HTMLElement): void {
    container.replaceChildren();
    this.#nodes.length = 0;
    this.#dirty.reset();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < GridService.SIZE; index++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tile h0';
      button.dataset.tileIndex = String(index);
      fragment.appendChild(button);
      this.#nodes.push(button);
    }
    container.appendChild(fragment);
  }

  /** Returns only nodes dirtied by the latest immutable state snapshot. */
  dirtyNodes(state: IState): ReadonlyArray<{ index: number; node: HTMLButtonElement }> {
    return [...this.#dirty.collect(state)].map(index => ({ index, node: this.#nodes[index]! }));
  }

  /** Number of persistent grid nodes. */
  get nodeCount(): number { return this.#nodes.length; }
}
