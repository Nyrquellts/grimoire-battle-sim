/** Centralized browser DOM lookup adapter. */
export const DomBindings = Object.freeze({
  /** Returns an element by id or null. */
  id(id: string): HTMLElement | null { return document.getElementById(id); },
  /** Returns the first matching element or null. */
  one<T extends Element = HTMLElement>(selector: string): T | null { return document.querySelector<T>(selector); },
  /** Returns all matching elements as a stable array. */
  all<T extends Element = HTMLElement>(selector: string): T[] { return [...document.querySelectorAll<T>(selector)]; }
});
