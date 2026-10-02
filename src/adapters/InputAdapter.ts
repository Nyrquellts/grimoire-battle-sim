/** User-input adapter emits semantic commands rather than mutating state. */
export interface IInputAdapter {
  bind(): void;
  unbind(): void;
}
