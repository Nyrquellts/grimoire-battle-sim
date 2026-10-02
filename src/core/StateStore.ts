import { createStore, type StoreApi } from 'zustand/vanilla';
import { clone, deepFreeze, invariant } from './utils';

interface SnapshotBox<TState> { state: TState }
interface HistoryRow<TState, TSidecar> { label: string; state: TState; sidecar?: TSidecar }

export interface Sidecar<TSidecar> {
  capture(): TSidecar;
  restore(snapshot: TSidecar | undefined): void;
}

export interface HistoryStoreOptions<TState, TSidecar> {
  historyLimit?: number;
  validate?: ((state: TState) => void) | null;
  sidecar?: Sidecar<TSidecar> | null;
}

/**
 * Zustand-backed immutable state facade with bounded checkpoint/undo history.
 * It intentionally preserves the old Store API so gameplay code can migrate without rule changes.
 */
export class ZustandHistoryStore<TState extends object, TSidecar = never> {
  readonly #store: StoreApi<SnapshotBox<TState>>;
  readonly #factory: () => TState;
  readonly #history: HistoryRow<TState, TSidecar>[] = [];
  readonly #listeners = new Set<(state: TState) => void>();
  readonly #limit: number;
  readonly #validate: ((state: TState) => void) | null;
  readonly #sidecar: Sidecar<TSidecar> | null;
  #notifyScheduler: (callback: () => void) => void = callback => callback();
  #renderQueued = false;

  constructor(factory: () => TState, options: HistoryStoreOptions<TState, TSidecar> = {}) {
    invariant(typeof factory === 'function', 'Store factory must be a function.');
    this.#factory = factory;
    this.#limit = Math.max(10, Math.min(15, options.historyLimit ?? 12));
    this.#validate = options.validate ?? null;
    this.#sidecar = options.sidecar ?? null;
    const initial = deepFreeze(clone(factory()));
    this.#assert(initial);
    this.#store = createStore<SnapshotBox<TState>>()(() => ({ state: initial }));
  }

  /** Returns the current immutable simulation state. */
  read(): TState { return this.#store.getState().state; }
  /** Returns an isolated mutable snapshot. */
  snapshot(): TState { return clone(this.read()); }

  /** Saves a bounded undo checkpoint before an action transaction. */
  checkpoint(label = 'action'): void {
    const row: HistoryRow<TState, TSidecar> = { label, state: clone(this.read()) };
    if (this.#sidecar) row.sidecar = this.#sidecar.capture();
    this.#history.push(row);
    while (this.#history.length > this.#limit) this.#history.shift();
  }

  /** Applies one immutable state transaction. */
  update(mutator: (draft: TState) => TState | void, options: { checkpoint?: boolean; label?: string; silent?: boolean } = {}): TState {
    invariant(typeof mutator === 'function', 'Store update requires a mutator.');
    if (options.checkpoint) this.checkpoint(options.label ?? 'update');
    const draft = clone(this.read());
    const result = mutator(draft);
    const next = deepFreeze(result && typeof result === 'object' ? result : draft);
    this.#assert(next);
    this.#store.setState({ state: next }, true);
    if (!options.silent) this.notify();
    return next;
  }

  /** Replaces state without exposing mutable references. */
  replace(nextState: TState, options: { silent?: boolean; clearHistory?: boolean } = {}): void {
    const next = deepFreeze(clone(nextState));
    this.#assert(next);
    this.#store.setState({ state: next }, true);
    if (options.clearHistory) this.#history.length = 0;
    if (!options.silent) this.notify();
  }

  /** Restores the latest checkpoint. */
  undo(options: { silent?: boolean } = {}): boolean {
    const previous = this.#history.pop();
    if (!previous) return false;
    const state = deepFreeze(previous.state);
    this.#assert(state);
    this.#store.setState({ state }, true);
    this.#sidecar?.restore(previous.sidecar);
    if (!options.silent) this.notify();
    return true;
  }

  /** Restores a fresh factory state and clears undo history. */
  reset(): void {
    this.#history.length = 0;
    const state = deepFreeze(clone(this.#factory()));
    this.#assert(state);
    this.#store.setState({ state }, true);
    this.notify();
  }

  /** Subscribes the presentation/controller layer to coalesced state notifications. */
  subscribe(listener: (state: TState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Subscribes to a derived slice while preserving the store's coalesced notify boundary.
   * This is the preferred API for new views that do not need the complete battle state.
   */
  subscribeSelector<TSlice>(
    selector: (state: TState) => TSlice,
    listener: (slice: TSlice, previous: TSlice) => void,
    equals: (left: TSlice, right: TSlice) => boolean = Object.is
  ): () => void {
    let previous = selector(this.read());
    return this.subscribe(state => {
      const next = selector(state);
      if (equals(previous, next)) return;
      const before = previous;
      previous = next;
      listener(next, before);
    });
  }

  /** Number of stored undo checkpoints. */
  historySize(): number { return this.#history.length; }

  /** Injects requestAnimationFrame or a deterministic test scheduler. */
  setNotifyScheduler(scheduler: (callback: () => void) => void): void {
    invariant(typeof scheduler === 'function', 'Store notify scheduler must be a function.');
    this.#notifyScheduler = scheduler;
  }

  /** Coalesces state notifications to one scheduled presentation pass. */
  notify(): void {
    if (this.#renderQueued) return;
    this.#renderQueued = true;
    this.#notifyScheduler(() => {
      this.#renderQueued = false;
      const state = this.read();
      for (const listener of [...this.#listeners]) listener(state);
    });
  }

  #assert(state: TState): void { this.#validate?.(state); }
}
