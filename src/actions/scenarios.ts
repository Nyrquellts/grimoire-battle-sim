import { pushFeed } from '../services/CombatLog';
import type { IState, RegistryEntry } from '../entities/types';
import type { ActionGateway } from '../core/ActionGateway';
import type { EventPipeline } from '../core/EventPipeline';

/**
 * Scenario openings.
 *
 * Starting a scenario is two steps. Presentation asks `CombatFlow` to build the encounter — the
 * same path the encounter builder already uses — and then dispatches `scenarioOpening`, which is
 * where every state change lives: the hazards the scenario begins with, the focus the character is
 * holding, and the briefing text that frames the fight.
 *
 * Keeping the opening in an action rather than in the panel is what stops presentation owning
 * combat truth. A scenario cannot place a zone the rules would not allow, because it goes through
 * the same `ZoneService` a Sign does.
 */

export interface ScenarioActionDeps {
  gateway: ActionGateway<IState>;
  pipeline: EventPipeline;
  scenarios: { get(id: string): RegistryEntry | undefined };
  focusItems: { get(id: string): RegistryEntry | undefined };
  zones: { create(draft: IState, request: Record<string, unknown>): unknown };
}

/** Registers `scenarioOpening` on the gateway. */
export function registerScenarioActions(deps: ScenarioActionDeps): void {
  /**
   * Every encounter starts without a scenario until one claims it.
   *
   * This module writes `state.scenario`, so it is also responsible for clearing it. Without this,
   * starting a plain encounter after a scenario left the previous briefing attached to the new
   * fight — the field simply persisted because nothing owned resetting it.
   */
  deps.pipeline.on('combat:beforeStart', context => {
    const draft = context.state as IState | undefined;
    if (draft) draft.scenario = null;
  });

  deps.gateway.register('scenarioOpening', {
    validate(state, payload) {
      if (state.phase !== 'combat') return { ok: false, reason: 'The encounter has not started.' };
      if (!deps.scenarios.get(String(payload.scenarioId))) return { ok: false, reason: 'Unknown scenario.' };
      return { ok: true };
    },

    spend() { /* An opening is scenario setup, not a turn action. */ },

    run(draft, payload) {
      const scenario = deps.scenarios.get(String(payload.scenarioId));
      if (!scenario) throw new Error('Unknown scenario.');

      for (const zone of scenario.zones ?? []) {
        deps.zones.create(draft, {
          type: String(zone.type),
          center: { x: Number(zone.x), y: Number(zone.y) },
          radius: Number(zone.radius) || 2,
          duration: Number(zone.duration) || 5,
          power: Number(zone.power) || 0,
          source: String(scenario.name)
        });
      }

      const opening = scenario.player as Record<string, unknown> | undefined;
      if (opening) {
        const focusId = typeof opening.focusId === 'string' ? opening.focusId : null;
        if (focusId && deps.focusItems.get(focusId)) draft.player.focusId = focusId;
        const position = opening.position as { x: number; y: number } | undefined;
        if (position) draft.player.pos = { x: Number(position.x), y: Number(position.y) };
      }

      draft.scenario = { id: String(scenario.id), name: String(scenario.name), briefing: String(scenario.briefing ?? '') };

      pushFeed(draft, {
        kind: 'scenario',
        title: String(scenario.name),
        story: String(scenario.briefing ?? scenario.summary ?? ''),
        math: `Scenario · ${String(scenario.situation)} · ${(scenario.lineup as unknown[])?.length ?? 0} group(s).`
      });
    }
  });
}

/** Start options for `CombatFlow.start`, derived from a scenario row. */
export function scenarioStartOptions(scenario: RegistryEntry): { lineup: Array<Record<string, unknown>>; situation: string } {
  return {
    lineup: (scenario.lineup as Array<Record<string, unknown>>).map(entry => ({ ...entry })),
    situation: String(scenario.situation ?? 'open')
  };
}
