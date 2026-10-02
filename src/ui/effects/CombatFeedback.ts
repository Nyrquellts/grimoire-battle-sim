import { GridService } from '../../services/GridService';
import type { EventPipeline } from '../../core/EventPipeline';
import type { IActor } from '../../entities/types';

/**
 * Combat feel: floating numbers, impact flashes, screen shake, and status pops.
 *
 * Presentation only, and deliberately so. This module listens to simulation events and draws; it
 * never reads or writes combat state, never consumes the simulation RNG, and never decides
 * anything. Pull the whole file and every rule still resolves identically — the fight just stops
 * being legible at a glance.
 *
 * Two constraints shape the implementation:
 *
 * - **A frame budget.** Effects are pooled and capped, and everything animates on the compositor
 *   (`transform`/`opacity`) so a busy round of six enemies cannot drop the grid's frame rate.
 * - **Reduced motion is honoured.** With `prefers-reduced-motion`, shake is dropped entirely and
 *   floating text fades in place instead of travelling.
 */

export interface CombatFeedbackDeps {
  pipeline: EventPipeline;
  /** The tactical grid element that tile nodes live in. */
  grid(): HTMLElement | null;
  /** The element that shakes. Usually the battlefield panel. */
  shakeTarget(): HTMLElement | null;
  /** The overlay the floating text is drawn into. */
  layer(): HTMLElement | null;
}

/** Most floating elements alive at once. Beyond this the oldest is recycled. */
const MAX_FLOATERS = 24;

/** How long a floating number lives, in milliseconds. Matches the CSS animation. */
const FLOATER_MS = 1100;

export class CombatFeedback {
  readonly #deps: CombatFeedbackDeps;
  readonly #unsubscribes: Array<() => void> = [];
  readonly #live: HTMLElement[] = [];
  #shakeTimer: ReturnType<typeof setTimeout> | null = null;
  #reducedMotion = false;

  constructor(deps: CombatFeedbackDeps) {
    this.#deps = deps;
    this.#reducedMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Subscribes to the simulation events worth showing. Safe to call once. */
  attach(): void {
    const { pipeline } = this.#deps;

    // Damage: the number that matters, over the body it landed on.
    this.#unsubscribes.push(pipeline.on('damage:after', context => {
      const target = context.target as IActor | undefined;
      const result = context.result as { dealt?: number; critical?: unknown; blocked?: boolean; armorAbsorbed?: number } | undefined;
      if (!target || !result) return;

      if (result.blocked) { this.float(target, 'BLOCKED', 'blocked'); return; }
      const dealt = Number(result.dealt) || 0;
      if (dealt <= 0) {
        // Armour stopped it entirely: worth showing, because it is a tactical fact, not a miss.
        if (Number(result.armorAbsorbed) > 0) this.float(target, 'ARMOUR', 'absorbed');
        return;
      }

      const severity = Math.min(1, dealt / Math.max(12, Number(target.maxHp || 40) * 0.35));
      this.float(target, `−${dealt}`, result.critical ? 'critical' : 'damage', severity);
      this.impact(target, severity);
      this.shake(result.critical ? Math.max(0.55, severity) : severity * 0.7);
    }));

    // Critical wounds get their own callout: they change how the rest of the fight plays.
    this.#unsubscribes.push(pipeline.on('critical:inflicted', context => {
      const target = context.target as IActor | undefined;
      const injury = context.injury as { name?: string } | undefined;
      if (!target) return;
      this.float(target, String(injury?.name ?? 'CRITICAL').toUpperCase(), 'wound');
      this.shake(0.9);
    }));

    // Conditions are the other thing a player must not miss.
    this.#unsubscribes.push(pipeline.on('condition:added', context => {
      const target = context.target as IActor | undefined;
      const condition = String(context.condition ?? '');
      if (!target || !condition) return;
      this.float(target, condition.toUpperCase(), 'status');
    }));

    // A passed Death State save is the most dramatic thing that can happen to a body.
    this.#unsubscribes.push(pipeline.on('deathSave:passed', context => {
      const target = context.target as IActor | undefined;
      if (target) this.float(target, 'HOLDS ON', 'save');
    }));

    // Audio is deliberately absent here: `presentation:effect` already drives the audio adapter
    // from one subscription in the presentation root. Two would double every cue.
  }

  /** Removes every listener and clears anything still on screen. */
  detach(): void {
    for (const off of this.#unsubscribes.splice(0)) off();
    for (const node of this.#live.splice(0)) node.remove();
    if (this.#shakeTimer) { clearTimeout(this.#shakeTimer); this.#shakeTimer = null; }
  }

  /**
   * Draws one piece of floating text over an actor's tile.
   *
   * Public so a panel can annotate something the simulation does not emit an event for.
   */
  float(actor: IActor, text: string, tone: string, severity = 0.5): void {
    const layer = this.#deps.layer();
    const anchor = this.#tileRect(actor);
    if (!layer || !anchor) return;

    const node = document.createElement('span');
    node.className = `floater tone-${tone}${this.#reducedMotion ? ' still' : ''}`;
    node.textContent = text;
    // A heavier hit reads bigger. Clamped so a dragon bite cannot cover the board.
    node.style.setProperty('--floater-scale', String(1 + Math.min(0.6, severity * 0.6)));
    node.style.left = `${anchor.x}px`;
    node.style.top = `${anchor.y}px`;
    // Spread simultaneous numbers so a multi-hit round does not stack them into one blur.
    node.style.setProperty('--floater-drift', `${(this.#live.length % 5 - 2) * 9}px`);

    layer.appendChild(node);
    this.#live.push(node);
    while (this.#live.length > MAX_FLOATERS) this.#live.shift()?.remove();

    setTimeout(() => {
      node.remove();
      const at = this.#live.indexOf(node);
      if (at >= 0) this.#live.splice(at, 1);
    }, FLOATER_MS);
  }

  /** Flashes the token that was hit. */
  impact(actor: IActor, severity: number): void {
    const token = this.#tokenNode(actor);
    if (!token) return;
    token.classList.remove('token-impact');
    // Forcing layout restarts the animation when the same token is hit twice in one round.
    void token.offsetWidth;
    token.style.setProperty('--impact-strength', String(Math.min(1, severity)));
    token.classList.add('token-impact');
    setTimeout(() => token.classList.remove('token-impact'), 320);
  }

  /** Shakes the battlefield. Skipped entirely under reduced motion. */
  shake(strength: number): void {
    if (this.#reducedMotion || strength <= 0.05) return;
    const target = this.#deps.shakeTarget();
    if (!target) return;
    target.style.setProperty('--shake-strength', String(Math.min(1, strength).toFixed(2)));
    target.classList.add('shaking');
    if (this.#shakeTimer) clearTimeout(this.#shakeTimer);
    this.#shakeTimer = setTimeout(() => {
      target.classList.remove('shaking');
      this.#shakeTimer = null;
    }, 260);
  }

  /** The tile node an actor stands on. */
  #tileNode(actor: IActor): HTMLElement | null {
    const grid = this.#deps.grid();
    if (!grid || !actor.pos) return null;
    const index = GridService.index(actor.pos.x, actor.pos.y);
    return grid.querySelector<HTMLElement>(`[data-tile-index="${index}"]`);
  }

  /** The token element inside an actor's tile, when the renderer has drawn one. */
  #tokenNode(actor: IActor): HTMLElement | null {
    return this.#tileNode(actor)?.querySelector<HTMLElement>('.token') ?? null;
  }

  /** Where to anchor floating text, in coordinates local to the overlay layer. */
  #tileRect(actor: IActor): { x: number; y: number } | null {
    const tile = this.#tileNode(actor);
    const layer = this.#deps.layer();
    if (!tile || !layer) return null;
    const tileBox = tile.getBoundingClientRect();
    const layerBox = layer.getBoundingClientRect();
    return {
      x: tileBox.left - layerBox.left + tileBox.width / 2,
      y: tileBox.top - layerBox.top
    };
  }
}
