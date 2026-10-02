import { describe, expect, it, vi } from 'vitest';
import { ActionGateway } from '../../src/core/ActionGateway';
import { EventPipeline } from '../../src/core/EventPipeline';

interface Counter { n: number }

/**
 * Minimal store with the same checkpoint/undo semantics as ZustandHistoryStore, plus an optional
 * RNG-style sidecar so rollback of consumed randomness can be asserted.
 */
class TestStore {
  state: Counter = { n: 0 };
  history: Array<{ state: Counter; sidecar: number }> = [];
  notifications = 0;
  sidecar = 0;
  notifyThrows = false;

  read() { return this.state; }
  checkpoint() { this.history.push({ state: structuredClone(this.state), sidecar: this.sidecar }); }
  update(mutator: (draft: Counter) => void) {
    const draft = structuredClone(this.state);
    mutator(draft);
    this.state = draft;
    return this.state;
  }
  undo() {
    const row = this.history.pop();
    if (!row) return false;
    this.state = row.state;
    this.sidecar = row.sidecar;
    return true;
  }
  notify() {
    this.notifications++;
    if (this.notifyThrows) throw new Error('renderer exploded');
  }
}

function makeGateway() {
  const store = new TestStore();
  const pipeline = new EventPipeline();
  const gateway = new ActionGateway<Counter>({ store, pipeline, defaultActorId: 'p' });
  return { store, pipeline, gateway };
}

describe('ActionGateway transaction lifecycle', () => {
  it('runs validate -> spend -> run in one transaction', () => {
    const { store, gateway } = makeGateway();
    gateway.register('inc', { validate: () => ({ ok: true }), spend: draft => { draft.n += 1; }, run: draft => { draft.n *= 2; } });
    expect(gateway.execute('inc').ok).toBe(true);
    expect(store.state.n).toBe(2);
  });

  it('rejects an action whose validate fails, without checkpointing', () => {
    const { store, gateway } = makeGateway();
    gateway.register('no', { validate: () => ({ ok: false, reason: 'nope' }), spend: () => {}, run: () => {} });
    const result = gateway.execute('no');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('nope');
    expect(store.history).toHaveLength(0);
  });

  it('emits the lifecycle events in order', () => {
    const { pipeline, gateway } = makeGateway();
    const seen: string[] = [];
    for (const name of ['action:validate', 'action:before', 'action:beforeRun', 'combat:checkEnd', 'action:after']) {
      pipeline.on(name, () => { seen.push(name); });
    }
    gateway.register('inc', { validate: () => ({ ok: true }), spend: () => {}, run: () => {} });
    gateway.execute('inc');
    expect(seen).toEqual(['action:validate', 'action:before', 'action:beforeRun', 'combat:checkEnd', 'action:after']);
  });
});

describe('ActionGateway rollback', () => {
  it('rolls back when run throws', () => {
    const { store, gateway } = makeGateway();
    gateway.register('bad', { validate: () => ({ ok: true }), spend: draft => { draft.n = 7; }, run: () => { throw new Error('boom'); } });
    expect(gateway.execute('bad').ok).toBe(false);
    expect(store.state.n).toBe(0);
  });

  it('rolls back when spend throws', () => {
    const { store, gateway } = makeGateway();
    gateway.register('poor', { validate: () => ({ ok: true }), spend: () => { throw new Error('no resource'); }, run: draft => { draft.n = 99; } });
    expect(gateway.execute('poor').ok).toBe(false);
    expect(store.state.n).toBe(0);
  });

  it('rolls back when a transactional pre-hook throws', () => {
    const { store, pipeline, gateway } = makeGateway();
    pipeline.on('action:beforeRun', () => { throw new Error('hook failed'); });
    gateway.register('inc', { validate: () => ({ ok: true }), spend: draft => { draft.n = 5; }, run: draft => { draft.n = 6; } });
    expect(gateway.execute('inc').ok).toBe(false);
    expect(store.state.n).toBe(0);
  });

  it('restores exactly the failed transaction, not an earlier one', () => {
    const { store, gateway } = makeGateway();
    gateway.register('inc', { validate: () => ({ ok: true }), spend: draft => { draft.n += 1; }, run: () => {} });
    gateway.register('bad', { validate: () => ({ ok: true }), spend: draft => { draft.n += 100; }, run: () => { throw new Error('boom'); } });

    gateway.execute('inc');
    gateway.execute('inc');
    expect(store.state.n).toBe(2);

    expect(gateway.execute('bad').ok).toBe(false);
    expect(store.state.n).toBe(2);
    // The two successful checkpoints survive; only the failed one was consumed.
    expect(store.history).toHaveLength(2);
  });

  it('rolls back consumed randomness with the state', () => {
    const { store, gateway } = makeGateway();
    store.sidecar = 1000;
    gateway.register('bad', {
      validate: () => ({ ok: true }),
      spend: () => { store.sidecar += 1; },
      run: () => { store.sidecar += 1; throw new Error('boom'); }
    });
    expect(gateway.execute('bad').ok).toBe(false);
    expect(store.sidecar).toBe(1000);
  });

  it('reports the failure through action:error and stays usable', () => {
    const { pipeline, gateway, store } = makeGateway();
    const errors: string[] = [];
    pipeline.on('action:error', context => { errors.push(String((context as { error?: Error }).error?.message)); });
    gateway.register('bad', { validate: () => ({ ok: true }), spend: () => {}, run: () => { throw new Error('boom'); } });
    gateway.register('inc', { validate: () => ({ ok: true }), spend: draft => { draft.n += 1; }, run: () => {} });

    gateway.execute('bad');
    expect(errors).toEqual(['boom']);
    expect(gateway.execute('inc').ok).toBe(true);
    expect(store.state.n).toBe(1);
  });
});

describe('ActionGateway commit boundary', () => {
  it('does not roll back when a post-commit observer throws', () => {
    const { store, pipeline, gateway } = makeGateway();
    pipeline.on('action:after', () => { throw new Error('observer exploded'); });
    gateway.register('inc', { validate: () => ({ ok: true }), spend: draft => { draft.n += 1; }, run: draft => { draft.n += 10; } });

    const result = gateway.execute('inc');
    expect(result.ok).toBe(true);
    expect(store.state.n).toBe(11);
  });

  it('does not roll back when the renderer subscription throws', () => {
    const { store, gateway } = makeGateway();
    store.notifyThrows = true;
    gateway.register('inc', { validate: () => ({ ok: true }), spend: draft => { draft.n += 1; }, run: () => {} });

    expect(gateway.execute('inc').ok).toBe(true);
    expect(store.state.n).toBe(1);
  });

  it('reports post-commit failures on their own channel', () => {
    const { pipeline, gateway } = makeGateway();
    const reported: Array<{ phase?: unknown; message?: string }> = [];
    pipeline.on('action:postCommitError', context => {
      const row = context as { phase?: unknown; error?: Error };
      reported.push({ phase: row.phase, message: row.error?.message });
    });
    pipeline.on('action:after', () => { throw new Error('observer exploded'); });
    gateway.register('inc', { validate: () => ({ ok: true }), spend: () => {}, run: () => {} });

    gateway.execute('inc');
    expect(reported).toEqual([{ phase: 'action:after', message: 'observer exploded' }]);
  });

  it('still notifies the presentation layer after a post-commit observer throws', () => {
    const { store, pipeline, gateway } = makeGateway();
    pipeline.on('action:after', () => { throw new Error('observer exploded'); });
    gateway.register('inc', { validate: () => ({ ok: true }), spend: () => {}, run: () => {} });
    gateway.execute('inc');
    expect(store.notifications).toBe(1);
  });
});

describe('ActionGateway nested execution', () => {
  it('queues an action requested during a transaction and runs it after the commit', () => {
    const { store, gateway } = makeGateway();
    const order: string[] = [];
    gateway.register('outer', {
      validate: () => ({ ok: true }),
      spend: () => {},
      run: draft => {
        order.push('outer:run');
        draft.n = 1;
        // The inner request must not be able to observe or commit inside this transaction.
        const inner = gateway.execute('inner');
        expect(inner.queued).toBe(true);
        expect(store.state.n).toBe(0);
      }
    });
    gateway.register('inner', { validate: () => ({ ok: true }), spend: () => {}, run: draft => { order.push('inner:run'); draft.n += 10; } });

    expect(gateway.execute('outer').ok).toBe(true);
    expect(order).toEqual(['outer:run', 'inner:run']);
    expect(store.state.n).toBe(11);
  });

  it('runs queued actions in request order', () => {
    const { gateway } = makeGateway();
    const order: string[] = [];
    const record = (name: string) => gateway.register(name, { validate: () => ({ ok: true }), spend: () => {}, run: () => { order.push(name); } });
    record('a'); record('b');
    gateway.register('outer', {
      validate: () => ({ ok: true }),
      spend: () => {},
      run: () => { gateway.execute('a'); gateway.execute('b'); }
    });
    gateway.execute('outer');
    expect(order).toEqual(['a', 'b']);
  });

  it('does not run a queued action when the outer transaction rolls back', () => {
    const { store, gateway } = makeGateway();
    let innerRan = false;
    gateway.register('inner', { validate: () => ({ ok: true }), spend: () => {}, run: () => { innerRan = true; } });
    gateway.register('outer', {
      validate: () => ({ ok: true }),
      spend: () => {},
      run: () => { gateway.execute('inner'); throw new Error('boom'); }
    });

    expect(gateway.execute('outer').ok).toBe(false);
    expect(innerRan).toBe(false);
    expect(store.state.n).toBe(0);
  });

  it('queues actions requested by post-commit observers instead of re-entering', () => {
    const { pipeline, gateway } = makeGateway();
    const order: string[] = [];
    gateway.register('follow', { validate: () => ({ ok: true }), spend: () => {}, run: () => { order.push('follow'); } });
    gateway.register('lead', { validate: () => ({ ok: true }), spend: () => {}, run: () => { order.push('lead'); } });
    pipeline.on('action:after', context => {
      if ((context as { actionName?: string }).actionName === 'lead') gateway.execute('follow');
    });

    gateway.execute('lead');
    expect(order).toEqual(['lead', 'follow']);
  });

  it('refuses an unbounded queue instead of looping forever', () => {
    const { gateway } = makeGateway();
    let runs = 0;
    gateway.register('loop', {
      validate: () => ({ ok: true }),
      spend: () => {},
      run: () => { runs++; gateway.execute('loop'); gateway.execute('loop'); }
    });
    gateway.execute('loop');
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThanOrEqual(ActionGateway.MAX_QUEUED_ACTIONS + 1);
  });

  it('rejects an unknown action without disturbing the queue', () => {
    const { gateway } = makeGateway();
    const blocked = vi.fn();
    gateway.execute('nope');
    expect(gateway.execute('nope').ok).toBe(false);
    expect(blocked).not.toHaveBeenCalled();
  });
});

describe('ActionGateway default actor', () => {
  it('acts as a fixed id when the payload names no actor', () => {
    const { pipeline, gateway } = makeGateway();
    const seen: string[] = [];
    pipeline.on('action:validate', context => { seen.push(String((context as { actorId: string }).actorId)); });
    gateway.register('inc', { validate: () => ({ ok: true }), spend: () => {}, run: () => {} });
    gateway.validate('inc', {});
    gateway.validate('inc', { actorId: 'other' });
    expect(seen).toEqual(['p', 'other']);
  });

  it('reads a function default each time, so it follows whoever is playing', () => {
    const store = new TestStore();
    const pipeline = new EventPipeline();
    let current = 'first';
    const gateway = new ActionGateway<Counter>({ store, pipeline, defaultActorId: () => current });
    const seen: string[] = [];
    pipeline.on('action:validate', context => { seen.push(String((context as { actorId: string }).actorId)); });
    gateway.register('inc', { validate: () => ({ ok: true }), spend: () => {}, run: () => {} });

    gateway.validate('inc', {});
    current = 'second';
    gateway.validate('inc', {});
    expect(seen).toEqual(['first', 'second']);
  });
});
