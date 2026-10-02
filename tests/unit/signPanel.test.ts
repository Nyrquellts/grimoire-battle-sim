import { beforeEach, describe, expect, it } from 'vitest';
import { handleSignChoice, renderSignPalette, selectedAugments } from '../../src/ui/panels/SignPanel';
// Importing the bridge registers the Sign actions, which is what gives the panel a live planner.
import { ActionDispatcher, CombatFlow, Store } from '../../src/services/SimulationRuntime';
import { previewSignCast } from '../../src/actions/signs';
import { Registry } from '../../src/data/witcherContent';
import type { IState } from '../../src/entities/types';

/**
 * The Signs panel renders to a string and handles clicks through plain data, so it is testable
 * without a DOM. That matters: the browser preview only repaints when its pane is on screen, so a
 * headless assertion is the reliable guard for this panel.
 */

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"]/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character);

function deps() {
  return {
    esc,
    lock: '',
    signs: Registry.signs.values(),
    focusItems: Registry.focusItems.values(),
    augments: Registry.signAugments
  };
}

/** A minimal store facade with the two methods the panel uses. */
function fakeStore(state: IState) {
  let current = state;
  return {
    read: () => current,
    update(mutator: (draft: IState) => void) {
      const draft = structuredClone(current) as IState;
      mutator(draft);
      current = draft;
      return draft;
    }
  };
}

function combatState(): IState {
  const start = CombatFlow.start as unknown as (options: { lineup: Array<Record<string, unknown>>; situation: string }) => void;
  start({ lineup: [{ foe: 'bandit', variant: 'random', region: 'Temeria', experience: 'random', loadout: 'random', quantity: 1 }], situation: 'open' });
  return Store.read();
}

describe('Sign palette rendering', () => {
  beforeEach(() => { CombatFlow.reset(); });

  it('lists every registered Sign, grouped by family', () => {
    const html = renderSignPalette(combatState(), deps());
    for (const sign of Registry.signs.values()) expect(html).toContain(String(sign.name));
  });

  it('offers the advanced Signs alongside the core five families', () => {
    const html = renderSignPalette(combatState(), deps());
    expect(html).toContain('Somne');
    expect(html).toContain('SUPIRRE'.toLowerCase());
  });

  it('shows a live cost readout for the Sign being shaped', () => {
    const state = combatState();
    const html = renderSignPalette(state, deps());
    expect(html).toContain('cast-readout');
    expect(html).toContain(`Vigor ${state.player.vigor}`);
  });

  it('offers only the augments that could shape the selected Sign', () => {
    const state = structuredClone(combatState()) as IState;
    (state.ui as Record<string, unknown>).signPreview = 'igni';
    const html = renderSignPalette(state, deps());

    expect(html).toContain('White flame');     // Fire intensity augment: applicable.
    expect(html).not.toContain('Hammer blow'); // Air augment: not applicable to Igni at all.
  });

  it('marks an augment unavailable, with its reason, rather than hiding it', () => {
    const state = structuredClone(combatState()) as IState;
    (state.ui as Record<string, unknown>).signPreview = 'igni';
    const html = renderSignPalette(state, deps());

    // Glyph ignition needs the target standing in Yrden, which is not set up here.
    expect(html).toContain('Glyph ignition');
    expect(html).toContain('unavailable');
  });

  it('warns when the chosen draw would exceed the Vigor Threshold', () => {
    const state = structuredClone(combatState()) as IState;
    (state.ui as Record<string, unknown>).signCost = 7;
    state.player.vigor = 3;
    const html = renderSignPalette(state, deps());

    expect(html).toContain('cast-warn');
    expect(html).toContain('Overexert 4');
    expect(html).toContain('20 HP');
  });

  it('shows the focus row only when the caster carries a focus', () => {
    const bare = renderSignPalette(combatState(), deps());
    expect(bare).not.toContain('attack-section focus');

    const carrying = structuredClone(combatState()) as IState;
    carrying.player.focusItems = ['gnomishStaff'];
    const html = renderSignPalette(carrying, deps());
    expect(html).toContain('Gnomish staff');
    expect(html).toContain('data-choice="focus"');
  });

  it('disables the cast button when the plan is not legal', () => {
    const state = structuredClone(combatState()) as IState;
    state.player.sta = 1;
    (state.ui as Record<string, unknown>).signCost = 6;
    const html = renderSignPalette(state, deps());

    expect(html).toContain('cast-readout illegal');
    expect(html).toMatch(/data-choice="sign"[^>]*disabled/);
  });
});

describe('Sign palette interaction', () => {
  beforeEach(() => { CombatFlow.reset(); });

  it('toggles an augment on and off', () => {
    const store = fakeStore(structuredClone(combatState()) as IState);
    const noop = () => undefined;

    expect(handleSignChoice('signAugment', 'whiteFlame', store, noop)).toBe(true);
    expect(selectedAugments(store.read())).toEqual(['whiteFlame']);

    handleSignChoice('signAugment', 'whiteFlame', store, noop);
    expect(selectedAugments(store.read())).toEqual([]);
  });

  it('keeps at most two woven augments, dropping the oldest', () => {
    const store = fakeStore(structuredClone(combatState()) as IState);
    const noop = () => undefined;

    for (const id of ['narrowedCone', 'extendedReach', 'hammerBlow']) handleSignChoice('signAugment', id, store, noop);

    expect(selectedAugments(store.read())).toEqual(['extendedReach', 'hammerBlow']);
  });

  it('clears the weave on an empty value', () => {
    const store = fakeStore(structuredClone(combatState()) as IState);
    const noop = () => undefined;
    handleSignChoice('signAugment', 'whiteFlame', store, noop);

    handleSignChoice('signAugment', '', store, noop);

    expect(selectedAugments(store.read())).toEqual([]);
  });

  it('records the Sign being shaped without casting it', () => {
    const store = fakeStore(structuredClone(combatState()) as IState);
    const dispatched: string[] = [];

    handleSignChoice('signPreview', 'yrden', store, action => { dispatched.push(action); });

    expect((store.read().ui as Record<string, unknown>).signPreview).toBe('yrden');
    expect(dispatched).toEqual([]);
  });

  it('sets the draw investment', () => {
    const store = fakeStore(structuredClone(combatState()) as IState);
    handleSignChoice('signCost', '5', store, () => undefined);
    expect((store.read().ui as Record<string, unknown>).signCost).toBe(5);
  });

  it('dispatches an action to take a focus in hand, because that changes what casts cost', () => {
    const store = fakeStore(structuredClone(combatState()) as IState);
    const dispatched: Array<[string, Record<string, unknown>]> = [];

    handleSignChoice('focus', 'gnomishStaff', store, (action, payload) => { dispatched.push([action, payload]); });

    expect(dispatched).toEqual([['equipFocus', { focusId: 'gnomishStaff' }]]);
  });

  it('ignores choices that belong to another palette', () => {
    const store = fakeStore(structuredClone(combatState()) as IState);
    expect(handleSignChoice('weapon', 'manticoreSteel', store, () => undefined)).toBe(false);
  });
});

describe('Known Signs', () => {
  beforeEach(() => { CombatFlow.reset(); });

  it('leaves every Sign open when the hero carries no list', () => {
    const state = combatState();
    expect(state.player.knownSigns).toBeUndefined();
    expect(previewSignCast(state, { signId: 'igni', cost: 2 })?.legal).toBe(true);
  });

  it('refuses a Sign the hero has not learned, and still allows the ones they have', () => {
    const state = structuredClone(combatState()) as IState;
    state.player.knownSigns = ['aard'];

    const igni = previewSignCast(state, { signId: 'igni', cost: 2 });
    expect(igni?.legal).toBe(false);
    expect(igni?.reason).toMatch(/has not learned Igni/);
    expect(previewSignCast(state, { signId: 'aard', cost: 2 })?.legal).toBe(true);
  });

  it('treats an empty list as a hero who knows no Signs at all', () => {
    const state = structuredClone(combatState()) as IState;
    state.player.knownSigns = [];
    expect(previewSignCast(state, { signId: 'quen', cost: 1 })?.legal).toBe(false);
  });

  it('disables the cast button for an unlearned Sign', () => {
    const state = structuredClone(combatState()) as IState;
    state.player.knownSigns = ['aard'];
    (state.ui as Record<string, unknown>).signPreview = 'igni';
    expect(renderSignPalette(state, deps())).toMatch(/data-choice="sign"[^>]*disabled/);
  });

  it('is enforced by the gateway, not only by the panel', () => {
    const state = structuredClone(combatState()) as IState;
    state.player.knownSigns = ['aard'];
    const verdict = ActionDispatcher.validate('sign', { signId: 'quen', cost: 1 }, state);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/has not learned Quen/);
  });
});
