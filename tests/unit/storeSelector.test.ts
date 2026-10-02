import { describe, expect, it } from 'vitest';
import { ZustandHistoryStore } from '../../src/core/StateStore';

describe('ZustandHistoryStore selector subscriptions', () => {
  it('notifies only when the selected slice changes', () => {
    const store = new ZustandHistoryStore(() => ({ hp: 10, round: 1 }));
    let renders = 0;
    store.subscribeSelector(state => state.hp, () => { renders++; });

    store.update(draft => { draft.round++; });
    expect(renders).toBe(0);

    store.update(draft => { draft.hp--; });
    expect(renders).toBe(1);
  });
});
