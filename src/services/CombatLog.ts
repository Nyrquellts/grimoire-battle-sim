import type { IFeedEntry, IState } from '../entities/types';

/**
 * The combat log: the simulation's record of what happened.
 *
 * Two views of the same events are kept deliberately:
 *
 * - `state.feed` is newest-first and capped, because it is what the player reads;
 * - `state.events` is append-only and structured, because it is what a bug report or a replay
 *   needs. It carries actor/target ids, positions, and rolls rather than prose.
 *
 * Narration *describes* results; it never decides them. Nothing in here may roll dice, consult
 * rules, or change combat state beyond the log itself.
 */

/** Newest-first entries retained for the player-facing log. */
const FEED_LIMIT = 80;
/** Structured entries retained for debugging and reproduction. */
const EVENT_LIMIT = 250;

/** One log entry as callers supply it; `id`, `seq`, and `round` are assigned here. */
export interface CombatLogInput {
  kind?: string;
  title?: string;
  story?: string;
  math?: string;
  actorId?: string | null;
  targetId?: string | null;
  action?: string | null;
  positionBefore?: unknown;
  positionAfter?: unknown;
  rolls?: unknown;
  [key: string]: unknown;
}

/**
 * Appends one entry to both views and marks it as the latest event.
 * Returns the stored feed row so callers can reference its id.
 */
export function pushFeed(state: IState, entry: CombatLogInput): IFeedEntry {
  state.eventSeq = (state.eventSeq || 0) + 1;
  const row: IFeedEntry = { id: `evt-${state.eventSeq}`, seq: state.eventSeq, round: state.round, ...entry };

  state.feed ??= [];
  state.feed.unshift(row);
  state.feed = state.feed.slice(0, FEED_LIMIT);

  state.events ??= [];
  state.events.push({
    seq: row.seq,
    round: row.round,
    kind: row.kind || 'event',
    title: row.title || 'Event',
    story: row.story || '',
    math: row.math || '',
    actorId: entry.actorId || null,
    targetId: entry.targetId || null,
    action: entry.action || null,
    positionBefore: entry.positionBefore || null,
    positionAfter: entry.positionAfter || null,
    rolls: entry.rolls || null
  });
  state.events = state.events.slice(-EVENT_LIMIT);

  state.ui.latestEventId = row.id;
  return row;
}

/** Clears both views. Used when a battle is reset, never to hide a result. */
export function clearLog(state: IState): void {
  state.feed = [];
  state.events = [];
  state.eventSeq = 0;
  state.ui.latestEventId = null;
}
