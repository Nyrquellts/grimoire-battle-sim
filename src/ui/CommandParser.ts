import type { RegistryHub } from '../data/RegistryHub';
import type { IState } from '../entities/types';

/**
 * The optional text console: "strong silver attack head", "cast igni 3 with white flame".
 *
 * Typing is faster than clicking through four palettes when you already know the move, and it keeps a
 * solo session in flow. The parser only ever *builds a request* — the gateway still validates it,
 * so a command can never do something the buttons could not.
 *
 * Extracted from the presentation bridge. It gained one capability in the move: Sign commands may
 * name augments, so weaving is reachable without leaving the keyboard.
 */

export interface ParsedCommand {
  name: string;
  payload: Record<string, unknown>;
}

export interface CommandDeps {
  registry: RegistryHub;
  /** The actor the console drives. */
  playerId(): string;
}

/** Hit locations the console understands, longest phrase first so "left arm" wins over "arm". */
const LOCATIONS: Array<[string, string]> = [
  ['left arm', 'leftArm'], ['right arm', 'rightArm'],
  ['left leg', 'leftLeg'], ['right leg', 'rightLeg'],
  ['head', 'head'], ['torso', 'torso']
];

const BRAWL_MOVES = ['punch', 'kick', 'sweep', 'grapple', 'choke', 'throw', 'pin', 'disarm'];

/** Lower-case words of three letters or more: enough to tell "silver" from "steel" from "sipar". */
const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/).filter(word => word.length > 2);

/**
 * The melee weapon an attack line asks for: the carried weapon whose name shares the most words
 * with the line, else the one in hand, else the first carried. `null` when no melee weapon is carried.
 */
function meleeWeaponFor(query: string, state: IState, deps: CommandDeps): string | null {
  const inHand = state.player.selectedWeapon;
  const carried = (state.player.weapons ?? [])
    .flatMap(id => {
      const weapon = deps.registry.weapons.get(id);
      return weapon && weapon.range === 'melee' ? [{ id, words: wordsOf(String(weapon.name)) }] : [];
    })
    .sort((a, b) => Number(b.id === inHand) - Number(a.id === inHand));
  if (!carried.length) return null;

  const said = new Set(wordsOf(query));
  let best: { id: string; score: number } | undefined;
  for (const row of carried) {
    const score = row.words.filter(word => said.has(word)).length;
    if (score > (best?.score ?? 0)) best = { id: row.id, score };
  }
  return best?.id ?? carried[0]!.id;
}

/** Parses one command line into an action request, or `null` when nothing matches. */
export function parseCommand(text: string, state: IState, deps: CommandDeps): ParsedCommand | null {
  const query = text.toLowerCase().trim();
  if (!query) return null;
  const actorId = deps.playerId();
  const targetId = state.selectedEnemyId;

  if (/end\s*turn/.test(query)) return { name: 'endTurn', payload: { actorId } };
  if (/reload/.test(query)) return { name: 'reload', payload: { actorId } };
  if (/recover/.test(query)) return { name: 'recover', payload: { actorId } };

  const move = query.match(/^move\s+(\d+)/);
  if (move?.[1]) {
    const distance = Number(move[1]);
    const from = state.player.pos;
    return { name: 'move', payload: { actorId, to: { x: Math.min(23, from.x + distance), y: from.y } } };
  }

  if (/\bcast\b/.test(query)) {
    const sign = [...deps.registry.signs.values()].find(row => query.includes(String(row.name).toLowerCase()));
    if (sign) {
      const cost = Number(query.match(/\b([1-7])\b/)?.[1] ?? (state.ui as Record<string, unknown>).signCost ?? 1);
      const augmentIds = matchAugments(query, deps);
      return { name: 'sign', payload: { actorId, targetId, signId: sign.id, cost, augmentIds } };
    }
  }

  if (/\bhold\b|\bfocus\b/.test(query)) {
    const focus = [...deps.registry.focusItems.values()].find(row => query.includes(String(row.name).toLowerCase()));
    if (focus) return { name: 'equipFocus', payload: { actorId, focusId: focus.id } };
    if (/\b(stow|drop)\b/.test(query)) return { name: 'equipFocus', payload: { actorId, focusId: null } };
  }

  const brawl = BRAWL_MOVES.find(candidate => query.includes(candidate));
  if (brawl) {
    return {
      name: 'barehanded',
      payload: { actorId, targetId, move: brawl, mode: query.includes('strong') ? 'strong' : 'normal' }
    };
  }

  if (/attack|strike|slash|stab/.test(query)) {
    const weaponId = meleeWeaponFor(query, state, deps);
    // Nothing to swing: a hero with empty hands means a punch.
    if (!weaponId) return { name: 'barehanded', payload: { actorId, targetId, move: 'punch', mode: query.includes('strong') ? 'strong' : 'normal' } };
    const mode = query.includes('strong') ? 'strong' : query.includes('fast') ? 'fast' : 'normal';
    const called = LOCATIONS.find(([phrase]) => query.includes(phrase))?.[1] ?? 'random';
    return { name: 'melee', payload: { actorId, targetId, weaponId, mode, called } };
  }

  return null;
}

/**
 * Augment names mentioned in a Sign command.
 *
 * Matching is by full name so a partial word cannot silently spend STA the player did not intend.
 * The planner still rejects anything illegal, and the feed reports what it refused and why.
 */
function matchAugments(query: string, deps: CommandDeps): string[] {
  const found: string[] = [];
  for (const augment of deps.registry.signAugments.values()) {
    const name = String(augment.name ?? '').toLowerCase();
    if (name && query.includes(name)) found.push(String(augment.id));
  }
  return found.slice(0, 2);
}
