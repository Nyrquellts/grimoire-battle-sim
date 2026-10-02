import type { IActor, IPosition } from './types';

/** Creates a battle-local actor clone without retaining registry object references. */
export function createBattleActor(definition: IActor, id: string, position: IPosition): IActor {
  return structuredClone({ ...definition, id, pos: { ...position } });
}
