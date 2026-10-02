import type { EventPipeline, PipelineContext } from './EventPipeline';

export interface GatewayStore<TState extends object> {
  read(): TState;
  checkpoint(label?: string): void;
  update(mutator: (draft: TState) => void, options?: { silent?: boolean }): TState;
  undo(options?: { silent?: boolean }): boolean;
  notify(): void;
}

export interface ActionContext<TState extends object, TPayload extends Record<string, unknown>> extends PipelineContext {
  actionName: string;
  payload: TPayload;
  actorId: string;
  state?: TState;
}

export interface ActionSpec<TState extends object, TPayload extends Record<string, unknown>> {
  validate(state: TState, payload: TPayload, context: ActionContext<TState, TPayload>): { ok: boolean; reason?: string } | void;
  spend(draft: TState, payload: TPayload, context: ActionContext<TState, TPayload>): void;
  run(draft: TState, payload: TPayload, context: ActionContext<TState, TPayload>): void;
}

/** Outcome of an `execute` request. */
export interface ActionResult {
  ok: boolean;
  reason?: string;
  error?: Error;
  /**
   * True when the request was accepted but deferred because a transaction was already open.
   * The action runs once that transaction commits; its outcome is observable through
   * `action:after`, `action:error`, or `action:blocked`.
   */
  queued?: boolean;
}

interface ActionGatewayDeps<TState extends object> {
  store: GatewayStore<TState>;
  pipeline: EventPipeline;
  /** The actor an action acts as when its payload names none. A function is read on every request. */
  defaultActorId?: string | (() => string);
}

interface QueuedAction {
  actionName: string;
  payload: Record<string, unknown>;
}

/**
 * Single transactional gate for every rules-changing action.
 *
 * Lifecycle:
 *
 * ```text
 * validate -> checkpoint -> begin transaction
 *   -> action:before -> action:beforeRun -> spend -> run -> combat:checkEnd
 * -> COMMIT -> end transaction -> action:after -> presentation notification
 * ```
 *
 * `COMMIT` is a hard boundary. Anything that fails before it rolls the transaction back exactly;
 * anything that fails after it is reported on `action:postCommitError` and leaves committed game
 * state alone, so an observer or renderer bug can never undo a legal combat action.
 *
 * Re-entering the gateway while a transaction is open is unsound — an inner action would
 * checkpoint against uncommitted state, and an outer rollback could not undo it. Such requests are
 * queued and run in request order after the current transaction commits.
 */
export class ActionGateway<TState extends object> {
  /** Upper bound on actions queued from inside one transaction, so a cycle cannot hang the game. */
  static readonly MAX_QUEUED_ACTIONS = 64;

  readonly #actions = new Map<string, ActionSpec<TState, Record<string, unknown>>>();
  readonly #store: GatewayStore<TState>;
  readonly #pipeline: EventPipeline;
  readonly #defaultActorId: string | (() => string);
  readonly #queue: QueuedAction[] = [];
  #transactionDepth = 0;
  #draining = false;

  constructor(deps: ActionGatewayDeps<TState>) {
    this.#store = deps.store;
    this.#pipeline = deps.pipeline;
    this.#defaultActorId = deps.defaultActorId ?? 'player';
  }

  /** Registers an immutable validate/spend/run action specification. */
  register<TPayload extends Record<string, unknown>>(name: string, spec: ActionSpec<TState, TPayload>): this {
    if (!name) throw new Error('Action needs a name.');
    if (this.#actions.has(name)) throw new Error(`Duplicate action: ${name}`);
    this.#actions.set(name, Object.freeze(spec) as ActionSpec<TState, Record<string, unknown>>);
    return this;
  }

  /** Returns all registered action identifiers. */
  list(): string[] { return [...this.#actions.keys()]; }
  /** Returns a registered specification for diagnostics. */
  describe(name: string): ActionSpec<TState, Record<string, unknown>> | null { return this.#actions.get(name) ?? null; }
  /** True while a transaction is open. Requests made now are queued, not executed. */
  get busy(): boolean { return this.#transactionDepth > 0; }

  #actingId(): string {
    return typeof this.#defaultActorId === 'function' ? this.#defaultActorId() : this.#defaultActorId;
  }

  /** Validates an action without mutating state. */
  validate(actionName: string, payload: Record<string, unknown> = {}, state: TState = this.#store.read()): ActionResult {
    const action = this.#actions.get(actionName);
    if (!action) return { ok: false, reason: `Unknown action: ${actionName}` };
    const actorId = typeof payload.actorId === 'string' ? payload.actorId : this.#actingId();
    const context: ActionContext<TState, Record<string, unknown>> = { actionName, payload, state, actorId };
    const piped = this.#pipeline.emit('action:validate', context);
    if (piped.cancelled) return { ok: false, reason: piped.reason || 'Action cancelled.' };
    try { return action.validate(state, payload, context) || { ok: true }; }
    catch (cause) {
      const error = toError(cause);
      return { ok: false, reason: `Validation error: ${error.message}`, error };
    }
  }

  /**
   * Executes one action transaction, then drains anything queued during it.
   * A request made while a transaction is open is queued rather than executed.
   */
  execute(actionName: string, payload: Record<string, unknown> = {}): ActionResult {
    if (this.#transactionDepth > 0) return this.#enqueue(actionName, payload);
    const result = this.#runTransaction(actionName, payload);
    this.#drainQueue();
    return result;
  }

  #enqueue(actionName: string, payload: Record<string, unknown>): ActionResult {
    if (!this.#actions.has(actionName)) return this.#reject(actionName, `Unknown action: ${actionName}`);
    if (this.#queue.length >= ActionGateway.MAX_QUEUED_ACTIONS) {
      return this.#reject(actionName, `Action queue is full (${ActionGateway.MAX_QUEUED_ACTIONS}); an action chain is looping.`);
    }
    this.#queue.push({ actionName, payload });
    return { ok: true, queued: true };
  }

  /**
   * Runs everything queued during the transaction that just committed, in request order.
   *
   * The budget bounds total drained actions, not queue length: a queued action may itself queue
   * more, so length alone cannot terminate a cycle. Exceeding it abandons the rest and reports
   * each one through `action:blocked` rather than hanging the game.
   */
  #drainQueue(): void {
    if (this.#draining) return;
    this.#draining = true;
    try {
      let drained = 0;
      while (this.#queue.length) {
        const next = this.#queue.shift();
        if (!next) break;
        if (drained >= ActionGateway.MAX_QUEUED_ACTIONS) {
          this.#reject(next.actionName, `Action chain exceeded ${ActionGateway.MAX_QUEUED_ACTIONS} queued actions; it is looping.`);
          continue;
        }
        drained++;
        this.#runTransaction(next.actionName, next.payload);
      }
    } finally {
      this.#draining = false;
      this.#queue.length = 0;
    }
  }

  #runTransaction(actionName: string, payload: Record<string, unknown>): ActionResult {
    const verdict = this.validate(actionName, payload, this.#store.read());
    if (!verdict.ok) return this.#reject(actionName, verdict.reason || 'Action is not legal.');
    const action = this.#actions.get(actionName);
    if (!action) return this.#reject(actionName, `Unknown action: ${actionName}`);

    const actorId = typeof payload.actorId === 'string' ? payload.actorId : this.#actingId();
    const context: ActionContext<TState, Record<string, unknown>> = { actionName, payload, actorId };
    const queuedBefore = this.#queue.length;

    this.#store.checkpoint(actionName);
    this.#transactionDepth++;
    try {
      try {
        this.#pipeline.emit('action:before', { ...context, state: this.#store.read() });
        this.#store.update(draft => {
          this.#pipeline.emit('action:beforeRun', { ...context, state: draft });
          action.spend(draft, payload, context);
          action.run(draft, payload, context);
          this.#pipeline.emit('combat:checkEnd', { state: draft });
        }, { silent: true });
      } catch (cause) {
        const error = toError(cause);
        this.#store.undo({ silent: true });
        // Work this transaction requested never happened, so it must not run either.
        this.#queue.length = queuedBefore;
        this.#emitGuarded('action:error', { ...context, error, state: this.#store.read() });
        this.#notifyGuarded();
        return { ok: false, reason: error.message, error };
      }

      // ---- COMMIT BOUNDARY. Game state is committed; nothing below may roll it back. ----
      this.#emitGuarded('action:after', { ...context, state: this.#store.read() });
      this.#notifyGuarded();
      return { ok: true };
    } finally {
      this.#transactionDepth--;
    }
  }

  /** Emits an event without letting a listener failure escape into the transaction result. */
  #emitGuarded(eventName: string, context: PipelineContext): void {
    try { this.#pipeline.emit(eventName, context); }
    catch (cause) { this.#reportPostCommit(eventName, toError(cause)); }
  }

  /** Notifies subscribers without letting a rendering failure escape. */
  #notifyGuarded(): void {
    try { this.#store.notify(); }
    catch (cause) { this.#reportPostCommit('store:notify', toError(cause)); }
  }

  #reportPostCommit(phase: string, error: Error): void {
    try { this.#pipeline.emit('action:postCommitError', { phase, error }); }
    catch { /* A failing error reporter must not take the simulation down. */ }
  }

  #reject(actionName: string, reason: string): ActionResult {
    this.#emitGuarded('action:blocked', { actionName, reason, state: this.#store.read() });
    return { ok: false, reason };
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
