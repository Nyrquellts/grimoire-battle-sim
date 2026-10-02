import { CombatFeedback } from './effects/CombatFeedback';
import { WebAudioAdapter } from '../adapters/AudioAdapter';
import { forgeTextFor, handleForgeAction, renderForge, type ForgeDeps, type ForgeNotice } from './panels/ForgePanel';
import {
  applyCreatorAction,
  renderCreator,
  renderCreatorSheet,
  setCreatorField,
  type CreatorDeps,
  type CreatorModel,
  type CreatorNotice
} from './panels/CharacterPanel';
import { exportHero, importHero, newDraft, type Roll } from '../services/CharacterBuilder';
import type { EventPipeline } from '../core/EventPipeline';
import type { RegistryHub } from '../data/RegistryHub';
import type { IState } from '../entities/types';
import type { HeroRoster } from '../services/PlayerCharacter';

/**
 * Presentation composition outside the legacy bridge.
 *
 * Views added after the migration began are wired here rather than in
 * `CompatibilityPresentation.ts`, which may only shrink. The bridge keeps three lines — construct,
 * route a click, render — and everything those do lives in this module.
 *
 * The shell owns view *composition*, not view content: the Forge and the character creator render
 * themselves, combat feel draws itself, and none of them writes combat state. The one thing the
 * creator does reach for is the player's seat, and only through the roster, outside a battle.
 */

export interface ShellDeps {
  pipeline: EventPipeline;
  registry: RegistryHub;
  store: { read(): IState; update(mutator: (draft: IState) => void): unknown };
  /** Builds an encounter. The same call the encounter builder makes. */
  startEncounter(options: { lineup: Array<Record<string, unknown>>; situation: string }): void;
  dispatch(action: string, payload: Record<string, unknown>): void;
  /** The premade heroes and whoever holds the player's seat. */
  heroes: Pick<HeroRoster, 'catalogue' | 'presets' | 'current' | 'draft' | 'presetDraft' | 'choose' | 'use' | 'seat'>;
  /**
   * Dice for the creator's Roll and Randomize buttons. Presentation randomness: it is deliberately
   * not the simulation's generator, so building a hero cannot move a combat roll.
   */
  random?: Roll;
  /** DOM lookup, injected so the shell holds no direct document reference of its own. */
  byId(id: string): HTMLElement | null;
  query(selector: string): HTMLElement | null;
  esc(value: unknown): string;
}

const defaultRoll: Roll = sides => 1 + Math.floor(Math.random() * Math.max(1, Math.floor(sides)));

/** The hero the creator opens with when nobody has built one yet. */
const STARTER = { race: 'human', profession: 'man-at-arms' } as const;

/** Makes a value safe inside a double-quoted attribute selector. */
const quoted = (value: string): string => value.replace(/["\\]/g, '\\$&');

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export class PresentationShell {
  readonly #deps: ShellDeps;
  readonly #feedback: CombatFeedback;
  /**
   * Browser-only sound. It sits below the presentation boundary and never draws from the
   * simulation RNG, so muting cannot change a combat outcome.
   */
  readonly #audio = new WebAudioAdapter();
  /** Ephemeral panel feedback. Not combat truth, so it is deliberately not in the store. */
  #forgeNotice: ForgeNotice | null = null;
  /** The hero being built. Ephemeral view state: the roster holds the hero that is actually chosen. */
  #creator: CreatorModel | null = null;

  constructor(deps: ShellDeps) {
    this.#deps = deps;
    this.#feedback = new CombatFeedback({
      pipeline: deps.pipeline,
      grid: () => deps.byId('battleGrid'),
      shakeTarget: () => deps.query('.battlefield-panel .grid-wrap'),
      layer: () => deps.byId('fxLayer')
    });
  }

  /** Starts the shell's own subscriptions and paints its views once. */
  initialize(): void {
    this.#deps.pipeline.on('presentation:effect', context =>
      this.#audio.effect(String(context.kind ?? 'hit'), Number(context.intensity) || 0.5), -1000);
    this.#feedback.attach();
    this.renderForge();

    const creator = this.#deps.byId('characterRoot');
    creator?.addEventListener('input', event => this.#typed(event));
    creator?.addEventListener('change', event => this.#chosen(event));
  }

  /** Whether sound cues are playing. */
  get audioEnabled(): boolean { return this.#audio.enabled; }
  /** Flips sound cues and reports the new state. */
  toggleAudio(): boolean { this.#audio.enabled = !this.#audio.enabled; return this.#audio.enabled; }

  /** Repaints the Forge. Content can be registered while another tab is open. */
  renderForge(): void {
    const root = this.#deps.byId('forgeRoot');
    if (root) root.innerHTML = renderForge(this.#deps.store.read(), this.#forgeDeps());
  }

  /** Repaints the whole character creator, keeping the scroll position and the focused control. */
  renderCharacter(): void {
    const root = this.#deps.byId('characterRoot');
    if (!root) return;
    const scroller = root.closest('.view');
    const top = scroller?.scrollTop ?? 0;
    const focused = this.#focusSelector();

    root.innerHTML = renderCreator(this.#model(), this.#creatorDeps());

    if (scroller) scroller.scrollTop = top;
    const next = focused ? this.#deps.query(`#characterRoot ${focused}`) : null;
    if (next && !(next as HTMLButtonElement).disabled) next.focus({ preventScroll: true });
  }

  /** Called when a tab is opened, so a view can refresh on entry. */
  onViewOpened(view: string): void {
    if (view === 'forge') this.renderForge();
    if (view === 'character') this.renderCharacter();
  }

  /**
   * Handles a click the shell owns. Returns `true` when it was consumed.
   *
   * Buttons that write JSON into the pack box do so here rather than inside the panel, because
   * touching a textarea's `value` is DOM work and the panel is a pure string renderer.
   */
  handleClick(button: HTMLElement): boolean {
    const data = button.dataset as Record<string, string | undefined>;
    if (data.creator) return this.#creatorClick(data.creator, data.value ?? '');

    const action = data.forge;
    if (!action) return false;

    const deps = this.#forgeDeps();
    const text = forgeTextFor(action, deps);
    const handled = handleForgeAction(
      action,
      data.value ?? '',
      this.#deps.store.read(),
      deps,
      this.#deps.store
    );
    if (!handled) return false;

    if (text !== null) {
      const box = this.#deps.byId('forgePack') as HTMLTextAreaElement | null;
      if (box) box.value = text;
    }
    this.renderForge();
    return true;
  }

  /** Releases subscriptions. Used by tests and by a future hot-reload path. */
  dispose(): void { this.#feedback.detach(); }

  // --- character creator -------------------------------------------------------------------------

  /** The creator's model, started from the hero in the seat (or a ready starter) on first use. */
  #model(): CreatorModel {
    if (!this.#creator) {
      const { heroes } = this.#deps;
      const draft = heroes.draft() ?? newDraft(heroes.catalogue(), this.#roll, STARTER.race, STARTER.profession);
      this.#creator = { draft, notice: null, shareText: '' };
    }
    return this.#creator;
  }

  get #roll(): Roll { return this.#deps.random ?? defaultRoll; }

  #creatorDeps(): CreatorDeps {
    const { heroes, store, esc } = this.#deps;
    return {
      esc,
      catalogue: heroes.catalogue(),
      presets: heroes.presets(),
      seated: heroes.current(),
      inCombat: store.read().phase === 'combat'
    };
  }

  #notice(tone: CreatorNotice['tone'], text: string): CreatorNotice { return { tone, text }; }

  /** Puts the chosen hero in the player's seat, unless a battle is running. Returns whether it did. */
  #seat(): boolean {
    const { store, heroes } = this.#deps;
    if (store.read().phase === 'combat') return false;
    store.update(draft => { heroes.seat(draft); });
    return true;
  }

  #creatorClick(action: string, value: string): boolean {
    const model = this.#model();
    const deps = this.#creatorDeps();
    const { catalogue } = deps;
    const { heroes } = this.#deps;

    switch (action) {
      case 'play': {
        if (!heroes.choose(value)) return false;
        const name = heroes.current().name;
        const seated = this.#seat();
        this.#creator = { ...model, notice: this.#notice('ok', seated ? `${name} holds the player's seat.` : `${name} joins the next battle.`) };
        break;
      }
      case 'edit': {
        const draft = heroes.presetDraft(value);
        if (!draft) return false;
        this.#creator = { ...model, draft, notice: this.#notice('ok', `Copied ${draft.name}. Change anything you like, then use this hero.`) };
        break;
      }
      case 'use': {
        const result = heroes.use(model.draft);
        if (!result.ok) {
          const first = result.issues.find(issue => issue.level === 'error');
          this.#creator = { ...model, notice: this.#notice('bad', first?.message ?? 'This hero is not ready yet.') };
          break;
        }
        const seated = this.#seat();
        const name = result.sheet.name;
        this.#creator = {
          ...model,
          draft: result.draft,
          notice: this.#notice('ok', seated ? `${name} is your hero.` : `${name} will be your hero in the next battle.`)
        };
        break;
      }
      case 'export':
        this.#creator = { ...model, shareText: exportHero(model.draft, catalogue), notice: this.#notice('ok', 'Your hero is written below. Copy it to keep it.') };
        break;
      case 'import': {
        const box = this.#deps.byId('creatorShare') as HTMLTextAreaElement | null;
        const result = importHero(box?.value ?? model.shareText, catalogue);
        if (!result.ok) {
          this.#creator = { ...model, shareText: box?.value ?? model.shareText, notice: this.#notice('bad', result.error) };
          break;
        }
        const detail = result.notes.length ? ` ${result.notes.join(' ')}` : '';
        this.#creator = {
          ...model,
          draft: result.draft,
          shareText: box?.value ?? model.shareText,
          notice: this.#notice('ok', `Imported ${result.draft.name || 'a nameless hero'}.${detail}`)
        };
        break;
      }
      default: {
        const next = applyCreatorAction(action, value, model.draft, { catalogue, random: this.#roll });
        if (!next) return false;
        this.#creator = { ...model, draft: next, notice: null };
      }
    }

    this.renderCharacter();
    return true;
  }

  /** A text field changed: update the draft and repaint only the sheet, so the caret stays put. */
  #typed(event: Event): void {
    const field = event.target as Field | null;
    const name = field?.dataset.field;
    if (!field || !name || field.tagName === 'SELECT') return;

    const model = this.#model();
    if (name === 'share') { this.#creator = { ...model, shareText: field.value }; return; }

    const next = setCreatorField(name, field.value, model.draft, this.#creatorDeps().catalogue);
    if (!next) return;
    this.#creator = { ...model, draft: next, notice: null };
    const sheet = this.#deps.byId('creatorSheet');
    if (sheet) sheet.innerHTML = renderCreatorSheet(this.#creator, this.#creatorDeps());
  }

  /** A select changed: the choice can alter budgets elsewhere on the page, so repaint it all. */
  #chosen(event: Event): void {
    const field = event.target as Field | null;
    const name = field?.dataset.field;
    if (!field || !name || field.tagName !== 'SELECT') return;

    const model = this.#model();
    const next = setCreatorField(name, field.value, model.draft, this.#creatorDeps().catalogue);
    if (!next) return;
    this.#creator = { ...model, draft: next, notice: null };
    this.renderCharacter();
  }

  /** A selector for the creator control that has focus, so a repaint can give it back. */
  #focusSelector(): string | null {
    const active = this.#deps.query('#characterRoot :focus');
    if (!active) return null;
    const data = active.dataset;
    if (data.creator) return `[data-creator="${quoted(data.creator)}"]${data.value !== undefined ? `[data-value="${quoted(data.value)}"]` : ''}`;
    if (data.field) return `[data-field="${quoted(data.field)}"]`;
    return null;
  }

  #forgeDeps(): ForgeDeps {
    const deps = this.#deps;
    const notice = this.#forgeNotice;
    return {
      esc: deps.esc,
      registry: deps.registry,
      startEncounter: options => deps.startEncounter(options),
      dispatch: (action, payload) => deps.dispatch(action, payload),
      fieldValue: id => {
        const node = deps.byId(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        return node?.value ?? '';
      },
      notice,
      setNotice: next => { this.#forgeNotice = next; }
    };
  }
}
