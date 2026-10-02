export interface IActionDispatcher {
  execute(actionName: string, payload?: Record<string, unknown>): { ok: boolean; reason?: string };
}

/** UI controller that can dispatch actions but has no authority to mutate simulation state. */
export class AppController {
  constructor(readonly actions: IActionDispatcher) {}
  /** Dispatches one semantic UI action through the action gateway. */
  dispatch(actionName: string, payload: Record<string, unknown> = {}): { ok: boolean; reason?: string } {
    return this.actions.execute(actionName, payload);
  }
}
