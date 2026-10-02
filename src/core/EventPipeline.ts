export interface PipelineContext {
  cancelled?: boolean;
  reason?: string;
  [key: string]: unknown;
}

type PipelineListener<T extends PipelineContext> = (context: T) => void;
interface ListenerRow<T extends PipelineContext> { priority: number; listener: PipelineListener<T> }

/** Ordered event pipeline used for non-invasive rules modifiers and lifecycle hooks. */
export class EventPipeline {
  readonly #listeners = new Map<string, ListenerRow<PipelineContext>[]>();

  /** Registers a listener in descending priority order. */
  on<T extends PipelineContext>(eventName: string, listener: PipelineListener<T>, priority = 0): () => void {
    const rows = this.#listeners.get(eventName) ?? [];
    const row: ListenerRow<PipelineContext> = { priority, listener: listener as PipelineListener<PipelineContext> };
    rows.push(row);
    rows.sort((a, b) => b.priority - a.priority);
    this.#listeners.set(eventName, rows);
    return () => {
      const current = this.#listeners.get(eventName);
      if (!current) return;
      const index = current.indexOf(row);
      if (index >= 0) current.splice(index, 1);
    };
  }

  /** Emits an event and returns the same mutable context after all listeners run. */
  emit<T extends PipelineContext>(eventName: string, context: T): T {
    const rows = this.#listeners.get(eventName);
    if (!rows?.length) return context;
    for (const row of [...rows]) {
      row.listener(context);
      if (context.cancelled) break;
    }
    return context;
  }
}
