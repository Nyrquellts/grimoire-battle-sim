import type { IState } from '../entities/types';
import type { IRenderer } from './IRenderer';

export interface ConsoleLike { log(...values: unknown[]): void }

/** Headless renderer for Node debugging and CI smoke tests. */
export class ConsoleRenderer implements IRenderer {
  constructor(readonly output: ConsoleLike = console) {}
  /** No initialization required. */
  initialize(): void {}
  /** Prints only stable combat summary fields. */
  render(state: IState): void {
    this.output.log({ version: state.version, phase: state.phase, round: state.round, playerHp: state.player.hp, hostiles: state.enemies.filter(enemy => !enemy.dead && !enemy.fled).length });
  }
  /** No resources to release. */
  dispose(): void {}
}
