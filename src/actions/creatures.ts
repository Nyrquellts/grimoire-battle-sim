import { Dice } from '../core/kernel';
import { pushFeed } from '../services/CombatLog';
import { GridService } from '../services/GridService';
import { effectiveSkill } from '../services/Skills';
import { isHostile } from '../services/ActorState';
import type { AbilityDefinition, CreatureAbilitySystem } from '../services/CreatureAbilities';
import type { IActor, IState } from '../entities/types';
import type { ActionGateway } from '../core/ActionGateway';

/**
 * `enemyAbility` — one action that resolves every creature ability.
 *
 * Each ability row names a `kind`; each kind is a small resolver below. Adding "a chort that gores
 * on a charge" is a content row, not a new action, because the charge resolver already exists.
 *
 * The action is deliberately narrow: it validates that the ability is still legal, marks the
 * cooldown, and dispatches to the resolver. Everything that decides *whether* to use it lives in
 * the AI, and everything about *what it does* lives in content.
 */

export interface CreatureActionDeps {
  gateway: ActionGateway<IState>;
  abilities: CreatureAbilitySystem;
  conditions: { add(actor: IActor, id: string, duration?: number): unknown };
  damage: { resolve(draft: IState, request: Record<string, unknown>): { dealt?: number;[field: string]: unknown } };
  location(model: string, called: string): { id: string; name: string; penalty: number; mult: number };
  findActor(state: IState, id: string | null | undefined): IActor | undefined;
  presentationEffect(kind: string, intensity?: number): void;
  /** Moves an actor, ignoring ground cost. Used by flight. */
  teleport(draft: IState, actor: IActor, to: { x: number; y: number }): void;
}

/** Registers `enemyAbility`. */
export function registerCreatureActions(deps: CreatureActionDeps): void {
  deps.gateway.register('enemyAbility', {
    validate(state, payload) {
      const actor = deps.findActor(state, String(payload.actorId));
      if (!actor || !isHostile(actor)) return { ok: false, reason: 'Not a hostile combatant.' };
      if (actor.dead) return { ok: false, reason: 'The creature cannot act.' };
      const abilityId = String(payload.abilityId);
      const legal = deps.abilities.available(state, actor, state.player).some(option => option.id === abilityId);
      return legal ? { ok: true } : { ok: false, reason: 'That ability is not available right now.' };
    },

    spend(draft, payload) {
      const actor = deps.findActor(draft, String(payload.actorId));
      if (!actor) return;
      deps.abilities.markUsed(actor, String(payload.abilityId), draft.round);
      const ability = abilityOf(deps, actor, String(payload.abilityId));
      const cost = Number(ability?.requires?.staCost) || 0;
      if (cost) actor.sta = Math.max(0, (Number(actor.sta) || 0) - cost);
    },

    run(draft, payload) {
      const actor = deps.findActor(draft, String(payload.actorId));
      if (!actor) throw new Error('Missing actor.');
      const abilityId = String(payload.abilityId);
      const ability = abilityOf(deps, actor, abilityId);
      if (!ability) throw new Error(`Unknown ability ${abilityId}.`);

      const resolver = RESOLVERS[String(ability.kind)];
      if (!resolver) {
        pushFeed(draft, { title: String(ability.name), story: `${actor.name} uses ${ability.name}.`, math: 'No battlefield effect.' });
        return;
      }
      resolver({ deps, draft, actor, target: draft.player, ability, params: ability.params ?? {} });
    }
  });
}

/**
 * The ability kinds that actually resolve.
 *
 * Exported so content can be checked against the resolvers that exist rather than against a
 * hand-copied list, which is how an ability row would otherwise be able to name a resolver that
 * was never written.
 */
export function resolverKinds(): string[] {
  return [...Object.keys(RESOLVERS), 'passive'];
}

function abilityOf(deps: CreatureActionDeps, actor: IActor, abilityId: string): AbilityDefinition | undefined {
  return deps.abilities.definitionsFor(actor).find(entry => entry.id === abilityId)?.ability;
}

interface ResolutionContext {
  deps: CreatureActionDeps;
  draft: IState;
  actor: IActor;
  target: IActor;
  ability: AbilityDefinition;
  params: Record<string, unknown>;
}

type AbilityResolver = (context: ResolutionContext) => void;

const RESOLVERS: Record<string, AbilityResolver> = {
  /**
   * Charge: close the distance and hit hard.
   *
   * The griffin's version is a -4 claw for 10d6 that knocks the target back 8 m; the row supplies
   * those numbers so a chort or a bear can charge with its own.
   */
  chargeAttack({ deps, draft, actor, target, ability, params }) {
    // Close to reach first: a charge is a move and an attack, which is what makes it worth -4.
    // If the ground will not let it close, the charge does not happen — it never becomes a free
    // attack from across the field.
    const approach = stepToward(draft, actor, target, 2);
    if (!approach) {
      pushFeed(draft, {
        kind: 'miss',
        title: `${actor.name} breaks off`,
        story: `${actor.name} starts its charge and finds no line through to ${target.name}.`,
        math: 'No path within reach.'
      });
      return;
    }
    actor.pos = approach;

    const penalty = Number(params.attackPenalty) || -4;
    const attack = Dice.check((Number(actor.attack) || 10) + penalty, { label: String(params.name ?? ability.name) });
    const defense = Dice.check(Number(target.defenses?.dodge ?? 10), { label: 'Dodge' });

    if (attack.total <= defense.total) {
      pushFeed(draft, {
        kind: 'miss',
        title: `${actor.name} charges`,
        story: `${target.name} turns the charge aside at the last moment.`,
        math: `${attack.text}; ${defense.text}`
      });
      return;
    }

    const roll = Dice.rollNotation(String(params.damage ?? '6d6'));
    const location = deps.location(target.family === 'Human' ? 'human' : 'monster', 'random');
    const damage = deps.damage.resolve(draft, {
      attacker: actor, target, raw: roll.total, type: 'B', location, weapon: { effects: [] },
      source: String(ability.name)
    });
    knockBack(draft, actor, target, Number(params.knockback) || 0);
    deps.conditions.add(target, 'prone');

    pushFeed(draft, {
      kind: 'critical',
      title: `${actor.name} charges`,
      story: `${actor.name} covers the ground in a heartbeat and hits ${target.name} at full speed for ${damage.dealt ?? 0}, throwing them down.`,
      math: `${attack.text} > ${defense.text}; ${roll.text}.`
    });
    deps.presentationEffect('critical', 0.9);
  },

  /**
   * Throws whatever is to hand.
   *
   * A nekker warband and a troll both do this when the target is too far to reach and too close to
   * ignore. The row supplies the stone: damage, the penalty for throwing an unbalanced lump of rock,
   * and how far it carries.
   */
  thrownObject({ deps, draft, actor, target, ability, params }) {
    const range = Number(params.range) || 12;
    const gap = GridService.distance(actor.pos, target.pos);
    if (gap > range || !GridService.los(draft, actor.pos, target.pos).clear) {
      pushFeed(draft, {
        kind: 'miss',
        title: String(ability.name),
        story: `${actor.name} hefts a stone and finds no throw worth making.`,
        math: gap > range ? `${gap} m, beyond ${range} m.` : 'No clear line.'
      });
      return;
    }

    const penalty = Number(params.attackPenalty) || 0;
    const attack = Dice.check((Number(actor.attack) || 10) + penalty, { label: String(ability.name) });
    const defense = Dice.check(Number(target.defenses?.dodge ?? 10), { label: 'Dodge' });
    if (attack.total <= defense.total) {
      pushFeed(draft, {
        kind: 'miss',
        title: `${actor.name} throws`,
        story: `The stone goes wide and breaks apart somewhere behind ${target.name}.`,
        math: `${attack.text}; ${defense.text}`
      });
      return;
    }

    const roll = Dice.rollNotation(String(params.damage ?? '2d6'));
    const location = deps.location(target.family === 'Human' ? 'human' : 'monster', 'random');
    const damage = deps.damage.resolve(draft, {
      attacker: actor, target, raw: roll.total, type: 'B', location, weapon: { effects: [] },
      source: String(ability.name)
    });
    pushFeed(draft, {
      kind: 'hit',
      title: `${actor.name} throws`,
      story: `The stone crosses ${gap} m and catches ${target.name} for ${damage.dealt ?? 0}.`,
      math: `${attack.text} > ${defense.text}; ${roll.text}.`
    });
    deps.presentationEffect('hit', 0.5);
  },

  /** A screech, roar, or shockwave: everyone in radius makes a Stun save at a penalty. */
  areaStun({ deps, draft, actor, params }) {
    const radius = Number(params.radius) || 10;
    const penalty = Number(params.savePenalty) || 0;
    const caught: string[] = [];

    for (const victim of [draft.player, ...draft.enemies]) {
      if (victim.id === actor.id || victim.dead) continue;
      if (GridService.distance(actor.pos, victim.pos) > radius) continue;
      // The Witcher Stun save: roll under STUN, here shifted by the ability's penalty.
      const save = Dice.d(10);
      const threshold = Math.max(1, (Number(victim.stats?.STUN) || 5) + penalty);
      if (save > threshold) { deps.conditions.add(victim, 'stunned', 1); caught.push(victim.name); }
    }

    pushFeed(draft, {
      kind: caught.length ? 'critical' : 'miss',
      title: String(params.name ?? 'Screech'),
      story: caught.length
        ? `The sound tears across the field and ${caught.join(', ')} reel from it.`
        : 'The sound washes over everyone and nobody buckles.',
      math: `${radius} m radius; Stun save at ${penalty}.`
    });
    deps.presentationEffect('critical', 0.6);
  },

  /** Blinds a single target on a successful casting roll. */
  blind({ deps, draft, actor, target, ability, params }) {
    const cast = Dice.check(effectiveSkill(actor, 'Spell Casting'), { label: String(ability.name) });
    const resist = Dice.check(Number(target.defenses?.magic ?? 10), { label: 'Resist Magic' });
    if (cast.total <= resist.total) {
      pushFeed(draft, { kind: 'miss', title: String(ability.name), story: `${target.name} turns away in time.`, math: `${cast.text}; ${resist.text}` });
      return;
    }
    const rounds = Dice.rollNotation(String(params.duration ?? '1d6'));
    deps.conditions.add(target, 'blinded', rounds.total);
    pushFeed(draft, {
      title: String(ability.name),
      story: `${target.name} is blinded and fighting on sound alone.`,
      math: `${cast.text} > ${resist.text}; ${rounds.text} rounds.`
    });
  },

  /** Goes untouchable until its next turn. */
  negateAttack({ deps, draft, actor, ability, params }) {
    const cast = Dice.check(effectiveSkill(actor, 'Spell Casting'), { label: String(ability.name) });
    if (cast.total < 10) {
      pushFeed(draft, { kind: 'miss', title: String(ability.name), story: `${actor.name} fails to slip out of the physical world.`, math: cast.text });
      return;
    }
    deps.conditions.add(actor, String(params.status ?? 'incorporeal'), Number(params.duration) || 1);
    pushFeed(draft, {
      title: String(ability.name),
      story: `${actor.name} thins into something the eye slides off. Steel will find nothing until it returns.`,
      math: `${cast.text} vs DC 10.`
    });
  },

  /** Orders nearby allies of a kind, sharpening their next actions. */
  commandAllies({ deps, draft, actor, ability, params }) {
    const radius = Number(params.radius) || 20;
    const family = params.family ? String(params.family) : null;
    const bonus = Number(params.bonus) || 2;
    const duration = Number(params.duration) || 2;
    const commanded: string[] = [];

    for (const ally of draft.enemies) {
      if (ally.id === actor.id || ally.dead || ally.fled) continue;
      if (family && ally.family !== family) continue;
      if (GridService.distance(actor.pos, ally.pos) > radius) continue;
      ally.statuses.commanded = { bonus, remaining: duration };
      commanded.push(ally.name);
    }

    pushFeed(draft, {
      title: String(ability.name),
      story: commanded.length
        ? `${actor.name} makes a sound that is not speech, and ${commanded.length} of them move as one.`
        : `${actor.name} calls out, and nothing answers.`,
      math: commanded.length ? `+${bonus} for ${duration} rounds within ${radius} m.` : `Nothing within ${radius} m.`
    });
  },

  /** Crosses the field through the air, ignoring what is on the ground. */
  takeFlight({ deps, draft, actor, target, ability, params }) {
    const range = Number(params.range) || 12;
    const landing = flightLanding(draft, actor, target, range);
    if (!landing) {
      pushFeed(draft, { kind: 'miss', title: String(ability.name), story: `${actor.name} finds nowhere better to be.`, math: 'No landing site.' });
      return;
    }
    const from = { ...actor.pos };
    deps.teleport(draft, actor, landing);
    pushFeed(draft, {
      kind: 'move',
      title: String(ability.name),
      story: `${actor.name} takes to the air and comes down somewhere the ground would not have let it reach.`,
      math: `${from.x},${from.y} → ${landing.x},${landing.y}`
    });
  },

  /** Copies that circle at range and bleed the target to heal their maker. */
  illusions({ deps, draft, actor, target, ability, params }) {
    const copies = Number(params.copies) || 3;
    actor.statuses.illusions = { copies, drain: Number(params.drain) || 3, sourceId: actor.id };
    pushFeed(draft, {
      title: String(ability.name),
      story: `${copies} more of ${actor.name} step out of the heat-shimmer and begin to circle ${target.name}.`,
      math: `Each round: ${Number(params.drain) || 3} Health drained while a copy stands.`
    });
    deps.presentationEffect('sign', 0.6);
  }
};

/**
 * A tile within `reach` of the target that the actor can actually path to.
 *
 * Pathing straight at the target fails: the target's own tile is occupied, so A* never reaches it
 * and returns an empty path. A charge that silently does not move is worse than no charge at all —
 * it becomes a free long-range attack. So the search runs to the *free ground beside* the target
 * and returns null when there is none, which the resolver reports.
 */
function stepToward(state: IState, actor: IActor, target: IActor, reach: number): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number; gap: number }> = [];
  const span = Math.max(1, Math.ceil(reach));
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      if (!dx && !dy) continue;
      const point = { x: target.pos.x + dx, y: target.pos.y + dy };
      if (!GridService.inside(point.x, point.y)) continue;
      if (GridService.distance(point, target.pos) > reach) continue;
      const tile = GridService.tile(state, point.x, point.y);
      if (!tile || tile.blocksMove) continue;
      if (isTaken(state, point, actor.id)) continue;
      candidates.push({ ...point, gap: GridService.distance(actor.pos, point) });
    }
  }
  candidates.sort((a, b) => a.gap - b.gap);

  for (const candidate of candidates) {
    const path = GridService.path(state, actor.pos, candidate, actor.id);
    if (path.length >= 2) return { x: candidate.x, y: candidate.y };
    if (path.length === 1 && candidate.gap === 0) return { x: candidate.x, y: candidate.y };
  }
  return null;
}

/** Whether an actor other than `exceptId` stands on a tile. */
function isTaken(state: IState, point: { x: number; y: number }, exceptId: string): boolean {
  if (state.player.id !== exceptId && state.player.pos.x === point.x && state.player.pos.y === point.y) return true;
  return state.enemies.some(other =>
    other.id !== exceptId && !other.dead && other.pos.x === point.x && other.pos.y === point.y);
}

/** Throws a target directly away from the attacker, as far as open ground allows. */
function knockBack(state: IState, attacker: IActor, target: IActor, metres: number): void {
  if (metres <= 0) return;
  const dx = Math.sign(target.pos.x - attacker.pos.x) || 1;
  const dy = Math.sign(target.pos.y - attacker.pos.y);
  for (let step = 0; step < metres; step++) {
    const next = { x: target.pos.x + dx, y: target.pos.y + dy };
    if (!GridService.inside(next.x, next.y)) return;
    const tile = GridService.tile(state, next.x, next.y);
    if (!tile || tile.blocksMove) return;
    target.pos = next;
  }
}

/**
 * Where a flier should come down.
 *
 * Flight is worth using when it reaches ground walking could not, so the search prefers tiles that
 * are close to the target and hard to arrive at on foot.
 */
function flightLanding(state: IState, actor: IActor, target: IActor, range: number): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  for (let index = 0; index < GridService.SIZE; index++) {
    const point = GridService.pos(index);
    if (GridService.distance(actor.pos, point) > range) continue;
    const tile = GridService.tile(state, point.x, point.y);
    if (!tile || tile.blocksMove) continue;
    if (state.enemies.some(other => other.pos.x === point.x && other.pos.y === point.y)) continue;
    if (state.player.pos.x === point.x && state.player.pos.y === point.y) continue;

    const toTarget = GridService.distance(point, target.pos);
    if (toTarget < 2) continue;
    const los = GridService.los(state, point, target.pos).clear;
    const score = -toTarget * 3 + (los ? 12 : -8) + (tile.elevation || 0) * 4;
    if (!best || score > best.score) best = { ...point, score };
  }
  return best ? { x: best.x, y: best.y } : null;
}
