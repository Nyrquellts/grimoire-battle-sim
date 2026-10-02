import type { IState } from '../entities/types';

/** Rendering boundary implemented by browser and headless adapters. */
export interface IRenderer {
  /** Initializes persistent renderer resources. */
  initialize(): void;
  /** Renders the latest immutable simulation snapshot. */
  render(state: IState): void;
  /** Releases renderer resources. */
  dispose(): void;
}
