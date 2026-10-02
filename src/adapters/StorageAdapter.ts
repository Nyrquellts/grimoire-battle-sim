/**
 * Storage boundary intentionally has no implementation yet.
 * Persistence remains disabled until save/import semantics are explicitly designed.
 */
export interface IStorageAdapter<TState> {
  load(): Promise<TState | null>;
  save(state: TState): Promise<void>;
}
