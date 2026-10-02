import { describe, expect, it } from 'vitest';
import { ZustandHistoryStore } from '../../src/core/StateStore';

describe('ZustandHistoryStore', () => {
  it('isolates snapshots and keeps bounded undo history', () => {
    const store = new ZustandHistoryStore(() => ({ nested: { n: 1 } }), { historyLimit: 10 });
    const snapshot = store.snapshot(); snapshot.nested.n = 99;
    expect(store.read().nested.n).toBe(1);
    for (let i = 0; i < 20; i++) { store.checkpoint(); store.update(draft => { draft.nested.n += 1; }, { silent: true }); }
    expect(store.historySize()).toBe(10);
  });

  it('coalesces notifications through the injected scheduler', () => {
    const store = new ZustandHistoryStore(() => ({ n: 0 }));
    const queue: Array<() => void> = [];
    store.setNotifyScheduler(callback => queue.push(callback));
    let renders = 0; store.subscribe(() => renders++);
    store.update(draft => { draft.n++; });
    store.update(draft => { draft.n++; });
    expect(queue).toHaveLength(1);
    queue[0]!();
    expect(renders).toBe(1);
  });
});
