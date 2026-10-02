import type { IState } from '../entities/types';
import type { IRenderer } from './IRenderer';

/** Small browser renderer adapter; individual Views own fine-grained DOM updates. */
export class WebRenderer implements IRenderer {
  readonly #renderFrame: (state: IState) => void;
  constructor(renderFrame: (state: IState) => void) { this.#renderFrame = renderFrame; }
  /** Browser views initialize themselves once. */
  initialize(): void {}
  /** Delegates one immutable state snapshot to the view composition. */
  render(state: IState): void { this.#renderFrame(state); }
  /** No retained resources beyond view-owned DOM nodes. */
  dispose(): void {}
}
