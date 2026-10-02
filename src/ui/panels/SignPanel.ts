import { augmentAvailability, heldFocusProfile, previewSignCast } from '../../actions/signs';
import type { AugmentAvailability, CastPlan } from '../../services/SpellCasting';
import type { IState, RegistryEntry } from '../../entities/types';

/**
 * The Signs palette: pick a Sign, set the draw, weave augments, and see what it will cost *before*
 * spending the Action.
 *
 * Presentation only. It reads `Store` state and emits buttons; every rules change still goes
 * through `ActionGateway`. The one piece of state it owns is the augment selection, which lives in
 * `state.ui.signAugments` alongside `state.ui.signCost` — a display choice, not combat truth.
 *
 * The live readout matters for playability: weaving is deliberately costed in STA, and a player
 * cannot budget against a cost they only discover after committing. `previewSignCast` runs the
 * same planner the action runs, so the number shown is the number charged.
 */

export interface SignPanelDeps {
  /** HTML-escapes interpolated content. */
  esc(value: unknown): string;
  /** The turn-lock banner the other palettes render above their body. */
  lock: string;
  /** Signs available to the caster. */
  signs: Iterable<RegistryEntry>;
  /** Focus items the caster could draw through. */
  focusItems: Iterable<RegistryEntry>;
  /** Augment rows, for names and descriptions. */
  augments: { get(id: string): RegistryEntry | undefined };
}

/** Families in the order the cockpit has always listed them, then anything else registered. */
const CORE_FAMILIES = ['Aard', 'Igni', 'Quen', 'Yrden', 'Axii'];

/** Renders the whole Signs palette. */
export function renderSignPalette(state: IState, deps: SignPanelDeps): string {
  const ui = state.ui as Record<string, unknown>;
  const selectedCost = Number(ui.signCost) || 1;
  const selected = Array.isArray(ui.signAugments) ? (ui.signAugments as string[]) : [];
  const signs = [...deps.signs];
  const focusId = typeof state.player.focusId === 'string' ? state.player.focusId : '';

  const activeSign = pickPreviewSign(signs, ui);
  const plan = activeSign
    ? previewSignCast(state, { signId: String(activeSign.id), cost: selectedCost, augmentIds: selected })
    : null;
  const availability = activeSign ? augmentAvailability(state, String(activeSign.id)) : [];

  // The wrapper lets the stylesheet give this palette more height than the others; weaving needs
  // the room, and the cost readout is pinned to the bottom so it stays visible while scrolling.
  return `${deps.lock}<div class="sign-palette">${[
    '<h3>Signs</h3>',
    renderDrawRow(selectedCost),
    renderFocusRow(state, deps, focusId),
    renderFamilies(signs, deps, activeSign),
    renderWeaveSection(deps, availability, selected, activeSign),
    `<div class="cast-dock">${renderPlanReadout(plan, deps, activeSign)}${renderExecute(plan, deps, activeSign, selectedCost, selected)}</div>`
  ].join('')}</div>`;
}

/**
 * The Sign currently being shaped.
 *
 * Weaving needs configuration before the Action is spent, so the palette selects a Sign first and
 * casts from a separate control — the same select-then-execute shape the Attack palette uses.
 * Falling back to the first registered Sign keeps the panel from ever rendering blank.
 */
function pickPreviewSign(signs: RegistryEntry[], ui: Record<string, unknown>): RegistryEntry | null {
  const preferred = typeof ui.signPreview === 'string' ? ui.signPreview : '';
  return signs.find(sign => sign.id === preferred) ?? signs[0] ?? null;
}

/** The STA investment selector. */
function renderDrawRow(selectedCost: number): string {
  const buttons = [1, 2, 3, 4, 5, 6, 7]
    .map(cost => `<button class="btn small ${selectedCost === cost ? 'primary' : ''}" data-choice="signCost" data-value="${cost}">${cost}</button>`)
    .join('');
  return `<div class="button-row sign-draw-row"><span class="muted">Draw (STA)</span>${buttons}</div>`;
}

/** The held-focus selector. Choosing one is a rules change, so it dispatches an action. */
function renderFocusRow(state: IState, deps: SignPanelDeps, focusId: string): string {
  const carried = Array.isArray(state.player.focusItems) ? (state.player.focusItems as string[]) : [];
  if (!carried.length) return '';
  const held = heldFocusProfile(state);
  const options = carried.map(id => {
    const row = [...deps.focusItems].find(item => item.id === id);
    if (!row) return '';
    const active = focusId === id;
    return `<button class="choice focus-choice ${active ? 'active' : ''}" data-choice="focus" data-value="${deps.esc(id)}" title="${deps.esc(row.description)}"><b>${deps.esc(row.name)}</b><small>Focus ${row.value}${row.greater ? ' · Greater' : ''}</small></button>`;
  }).join('');
  return `<section class="attack-section focus"><div class="section-title"><b>Focus</b><small>${held ? `−${held.value} STA${held.greater ? ' · +2 to land' : ''}` : 'none held'}</small></div><div class="compact-choice-grid"><button class="choice focus-choice ${focusId ? '' : 'active'}" data-choice="focus" data-value=""><b>Bare hands</b><small>no discount</small></button>${options}</div></section>`;
}

/** The Sign grid, grouped by family with the basic form beside its alternate. Selects, never casts. */
function renderFamilies(signs: RegistryEntry[], deps: SignPanelDeps, activeSign: RegistryEntry | null): string {
  const extra = [...new Set(signs.map(sign => String(sign.family)).filter(family => !CORE_FAMILIES.includes(family)))];
  const families = [...CORE_FAMILIES, ...extra];

  const rows = families.map(family => {
    const list = signs.filter(sign => sign.family === family);
    if (!list.length) return '';
    const basic = list.find(sign => !sign.alternate);
    const alternate = list.find(sign => sign.alternate);
    const button = (sign: RegistryEntry | undefined): string => {
      if (!sign) return '<span></span>';
      const active = activeSign?.id === sign.id ? ' active' : '';
      return `<button class="choice sign-${family.toLowerCase()}${active}" data-choice="signPreview" data-value="${deps.esc(sign.id)}" title="${deps.esc(sign.description)}"><b>${deps.esc(sign.name)}</b><small>${sign.alternate ? 'alternate' : 'basic'}</small></button>`;
    };
    return `<div class="sign-family-row ${family.toLowerCase()}"><span>${deps.esc(family)}</span>${button(basic)}${button(alternate)}</div>`;
  }).join('');

  return `<div class="sign-family-list" style="margin-top:6px">${rows}</div>`;
}

/** The commit control. Disabled with the planner's own reason when the cast is not legal. */
function renderExecute(
  plan: CastPlan | null,
  deps: SignPanelDeps,
  activeSign: RegistryEntry | null,
  cost: number,
  selected: string[]
): string {
  if (!activeSign) return '';
  const augments = selected.length ? ` data-augments="${deps.esc(selected.join(','))}"` : '';
  const disabled = plan && !plan.legal ? 'disabled' : '';
  // No section header here: the readout directly above already states the cost, and the dock has
  // to stay short enough not to cover the weave controls it sits beneath.
  return `<button class="btn primary cast-button" data-choice="sign" data-value="${deps.esc(activeSign.id)}" data-cost="${cost}"${augments} ${disabled}>Cast ${deps.esc(activeSign.name)}${plan ? ` · ${plan.staCost} STA` : ''}</button>`;
}

/** The augment toggles for the previewed Sign. */
function renderWeaveSection(
  deps: SignPanelDeps,
  availability: AugmentAvailability[],
  selected: string[],
  activeSign: RegistryEntry | null
): string {
  if (!activeSign) return '';
  if (!availability.length) {
    return `<section class="attack-section weave"><div class="section-title"><b>Weave</b><small>nothing shapes ${deps.esc(activeSign.name)}</small></div></section>`;
  }

  const chips = availability.map(entry => {
    const row = deps.augments.get(entry.id);
    const name = String(row?.name ?? entry.id);
    const active = selected.includes(entry.id);
    const title = entry.legal ? String(row?.description ?? '') : String(entry.reason ?? '');
    const cost = Number(row?.staCost) || 0;
    return `<button class="choice augment-choice ${active ? 'active' : ''} ${entry.legal ? '' : 'blocked'}" data-choice="signAugment" data-value="${deps.esc(entry.id)}" ${entry.legal ? '' : 'disabled'} title="${deps.esc(title)}"><b>${deps.esc(name)}</b><small>+${cost} STA${entry.legal ? '' : ' · unavailable'}</small></button>`;
  }).join('');

  const clear = selected.length ? '<button class="btn small" data-choice="signAugment" data-value="">Clear weave</button>' : '';
  return `<section class="attack-section weave"><div class="section-title"><b>Weave into ${deps.esc(activeSign.name)}</b><small>max 2 · each costs STA</small>${clear}</div><div class="compact-choice-grid">${chips}</div></section>`;
}

/** The live cost readout: exactly what the cast will spend. */
function renderPlanReadout(plan: CastPlan | null, deps: SignPanelDeps, activeSign: RegistryEntry | null): string {
  if (!plan || !activeSign) return '';
  const overexertion = plan.vigorOver > 0
    ? `<span class="cast-warn">Overexert ${plan.vigorOver} · −${plan.healthCost} HP</span>`
    : '<span class="cast-safe">Within Vigor</span>';
  const focus = plan.focusDiscount > 0 ? `<span class="cast-focus">focus −${plan.focusDiscount}</span>` : '';
  const blocked = plan.legal ? '' : `<div class="cast-blocked">${deps.esc(plan.reason)}</div>`;

  return `<div class="cast-readout ${plan.legal ? '' : 'illegal'}">
    <div class="cast-line"><b>${deps.esc(activeSign.name)}</b> <span class="cast-total">${plan.staCost} STA</span> ${focus} ${overexertion}</div>
    <div class="cast-math">draw ${plan.investment}${plan.augmentCost ? ` + weave ${plan.augmentCost}` : ''}${plan.focusDiscount ? ` − focus ${plan.focusDiscount}` : ''} · Vigor ${plan.vigor}</div>
    ${blocked}
  </div>`;
}

/**
 * Handles a palette click that belongs to this panel.
 *
 * Returns `true` when the click was consumed. Toggling an augment or previewing a Sign is display
 * state; holding a focus is a rules change and is dispatched as an action.
 */
export function handleSignChoice(
  kind: string,
  value: string,
  store: { read(): IState; update(mutator: (draft: IState) => void): unknown },
  dispatch: (action: string, payload: Record<string, unknown>) => unknown
): boolean {
  if (kind === 'signCost') {
    store.update(draft => { (draft.ui as Record<string, unknown>).signCost = Number(value) || 1; });
    return true;
  }

  if (kind === 'signAugment') {
    store.update(draft => {
      const ui = draft.ui as Record<string, unknown>;
      const current = Array.isArray(ui.signAugments) ? [...(ui.signAugments as string[])] : [];
      if (!value) { ui.signAugments = []; return; }
      const at = current.indexOf(value);
      if (at >= 0) current.splice(at, 1);
      else current.push(value);
      // The planner enforces the real cap; trimming here keeps the UI honest about what will apply.
      ui.signAugments = current.slice(-2);
    });
    return true;
  }

  if (kind === 'signPreview') {
    store.update(draft => { (draft.ui as Record<string, unknown>).signPreview = value; });
    return true;
  }

  if (kind === 'focus') {
    dispatch('equipFocus', { focusId: value || null });
    return true;
  }

  return false;
}

/** The augment ids a Sign button should carry into its dispatch. */
export function selectedAugments(state: IState): string[] {
  const ui = state.ui as Record<string, unknown>;
  return Array.isArray(ui.signAugments) ? [...(ui.signAugments as string[])] : [];
}
