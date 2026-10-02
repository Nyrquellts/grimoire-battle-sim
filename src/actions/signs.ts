import { Dice } from '../core/kernel';
import { pushFeed } from '../services/CombatLog';
import { effectiveSkill } from '../services/Skills';
import { GridService } from '../services/GridService';
import { TargetingService } from '../services/Targeting';
import { isHostile } from '../services/ActorState';
import type { AugmentAvailability, CastContext, CastPlan, FocusProfile, SpellCastingSystem } from '../services/SpellCasting';
import type { IActor, IState, RegistryEntry } from '../entities/types';
import type { ActionGateway } from '../core/ActionGateway';

/**
 * Sign casting: validation, cost, and resolution.
 *
 * Extracted from the legacy bridge. Two things changed in the move and both are deliberate:
 *
 * 1. **Resolution dispatches on content, not on Sign id.** A Sign row declares `resolver` plus the
 *    numbers that resolver reads, so adding a Sign is a data edit. The previous chain of
 *    `sign.id === 'aard' || sign.id === 'aardSweep'` comparisons is gone.
 * 2. **Casts go through `SpellCastingSystem`.** That adds magical focuses, augment weaving, and
 *    magic fumbles. With no focus, no augments, and no dimeritium the arithmetic is identical to
 *    the previous inline `cost` / `overcast` handling, so an unaugmented Sign behaves exactly as
 *    it did before.
 */

/** Collaborators the Sign actions need that still live in the simulation bridge. */
export interface SignActionDeps {
  gateway: ActionGateway<IState>;
  casting: SpellCastingSystem;
  /** Content lookups. */
  signs: { get(id: string): RegistryEntry | undefined };
  focusItems: { get(id: string): RegistryEntry | undefined };
  /** Shared turn-economy guards owned by the bridge. */
  validCombat(state: IState, payload: Record<string, unknown>): { ok: boolean; reason?: string };
  validateActionResource(state: IState, payload: Record<string, unknown>): { ok: boolean; reason?: string };
  spendActionResource(draft: IState, payload: Record<string, unknown>): void;
  /** Simulation services owned by the bridge's wiring block. */
  conditions: { add(actor: IActor, id: string, duration?: number): unknown };
  damage: { resolve(draft: IState, request: Record<string, unknown>): { dealt?: number;[field: string]: unknown } };
  zones: {
    create(draft: IState, request: Record<string, unknown>): unknown;
    igniteDream(draft: IState, position: { x: number; y: number }): unknown;
  };
  location(model: string, called: string): { id: string; name: string; penalty: number; mult: number };
  grammar: { object(actor: IActor): string; subject(actor: IActor): string };
  findActor(state: IState, id: string | null | undefined): IActor | undefined;
  presentationEffect(kind: string, intensity?: number): void;
}

/**
 * The wiring this module was registered with.
 *
 * Presentation needs to *cost* a prospective cast so the player can see what weaving an augment
 * will do before committing an Action. That preview must use the same casting system the action
 * uses — two instances would be two authoritative implementations of one concern. Holding the
 * single wiring here, rather than exporting a preview from the legacy bridge, keeps the bridge
 * shrinking and keeps the ownership in this module.
 */
let wiring: SignActionDeps | null = null;

/**
 * Costs a prospective cast for presentation. Pure and read-only: no dice, no state change.
 *
 * Returns `null` before the actions are registered or when the Sign id is unknown, which lets a
 * panel render a neutral state rather than throw during startup.
 */
export function previewSignCast(
  state: IState,
  request: { signId: string; cost: number; augmentIds?: readonly string[]; targetId?: string | null }
): CastPlan | null {
  if (!wiring) return null;
  const sign = wiring.signs.get(request.signId);
  if (!sign) return null;
  const target = wiring.findActor(state, request.targetId ?? state.selectedEnemyId);
  return buildPlan(wiring, state, sign, { cost: request.cost, augmentIds: [...(request.augmentIds ?? [])] }, target);
}

/**
 * Every augment that could shape this Sign, each marked legal or refused for the current
 * battlefield. Presentation uses it to show *why* an option is unavailable rather than hiding it.
 */
export function augmentAvailability(
  state: IState,
  signId: string,
  targetId?: string | null
): AugmentAvailability[] {
  if (!wiring) return [];
  const sign = wiring.signs.get(signId);
  if (!sign) return [];
  const target = wiring.findActor(state, targetId ?? state.selectedEnemyId);
  return wiring.casting.availability(sign, castContext(wiring, state, target));
}

/** The focus the player is currently drawing through, for display. */
export function heldFocusProfile(state: IState): FocusProfile | null {
  return wiring ? heldFocus(wiring, state.player) : null;
}

/** Registers `sign` on the gateway. */
export function registerSignActions(deps: SignActionDeps): void {
  wiring = deps;
  deps.gateway.register('sign', {
    validate(state, payload) {
      const turn = deps.validCombat(state, payload);
      if (!turn.ok) return turn;
      const resource = deps.validateActionResource(state, payload);
      if (!resource.ok) return resource;

      const sign = deps.signs.get(String(payload.signId));
      if (!sign) return { ok: false, reason: 'Unknown Sign.' };
      const unlearned = notLearned(state.player, sign);
      if (unlearned) return { ok: false, reason: unlearned };
      if (state.player.statuses.dimeritium) return { ok: false, reason: 'Dimeritium suppresses Signs.' };

      const target = bindTarget(state, payload, sign);
      if (target.error) return { ok: false, reason: target.error };

      const plan = buildPlan(deps, state, sign, payload, target.actor);
      if (!plan.legal) return { ok: false, reason: plan.reason ?? 'The Sign cannot be woven that way.' };
      return { ok: true };
    },

    spend(draft, payload) {
      deps.spendActionResource(draft, payload);
      const sign = deps.signs.get(String(payload.signId));
      if (!sign) throw new Error('Unknown Sign.');
      const target = deps.findActor(draft, (payload.targetId as string) ?? draft.selectedEnemyId);
      const plan = buildPlan(deps, draft, sign, payload, target);

      draft.player.sta -= plan.staCost;
      // Overexertion: 5 HP per point of STA above the Vigor Threshold.
      if (plan.healthCost > 0) draft.player.hp -= plan.healthCost;

      // The resolver reads the committed plan rather than re-deriving it, so the cost the player
      // was shown and the cost they paid can never diverge.
      payload.cost = plan.investment;
      payload.staSpent = plan.staCost;
      payload.overcast = plan.vigorOver;
      payload.plan = plan;
    },

    run(draft, payload) {
      if (payload.targetId) TargetingService.select(draft, String(payload.targetId));
      resolveSign(deps, draft, payload);
      deps.presentationEffect('sign', 0.45);
    }
  });

  /**
   * Takes hold of one carried magical focus, or puts them all away.
   *
   * A focus changes what every subsequent cast costs, so it is a rules change and goes through the
   * gateway like any other. Swapping which one is in hand is free: the rules charge nothing for it,
   * and only one may be used at a time regardless.
   */
  deps.gateway.register('equipFocus', {
    validate(state, payload) {
      const turn = deps.validCombat(state, payload);
      if (!turn.ok) return turn;
      const focusId = payload.focusId;
      if (focusId === null || focusId === undefined || focusId === '') return { ok: true };
      const carried = Array.isArray(state.player.focusItems) ? state.player.focusItems.map(String) : [];
      if (!carried.includes(String(focusId))) return { ok: false, reason: 'That focus is not being carried.' };
      if (!deps.focusItems.get(String(focusId))) return { ok: false, reason: 'Unknown focus.' };
      return { ok: true };
    },
    spend() { /* Taking a focus in hand costs no Action. */ },
    run(draft, payload) {
      const focusId = payload.focusId ? String(payload.focusId) : null;
      draft.player.focusId = focusId;
      const row = focusId ? deps.focusItems.get(focusId) : null;
      pushFeed(draft, {
        title: row ? `${row.name} in hand` : 'Focus stowed',
        story: row
          ? `${draft.player.name} takes up the ${String(row.name).toLowerCase()}; chaos drawn through it costs ${row.value} less.`
          : `${draft.player.name} puts the focus away and draws chaos bare-handed.`,
        math: row ? `Focus ${row.value}${row.greater ? ' · Greater Focus +2' : ''}` : 'No focus discount.'
      });
    }
  });
}

/** Resolves and validates the Sign's target, honouring the augmented range. */
function bindTarget(
  state: IState,
  payload: Record<string, unknown>,
  sign: RegistryEntry
): { actor?: IActor; error?: string } {
  if (!['target', 'cone'].includes(String(sign.shape))) return {};
  const range = Number(sign.range) || 0;
  const bound = TargetingService.bind(state, payload, {
    maxRange: range > 0 ? range : Infinity,
    requireLos: false
  }) as IActor | undefined;
  if (!bound) return { error: `No legal target is available for ${sign.name}.` };
  if (range > 0 && GridService.distance(state.player.pos, bound.pos) > range) {
    return { error: `${sign.name} is out of range.` };
  }
  return { actor: bound };
}

/** Costs one cast from the request payload. Pure: safe to call in `validate` and again in `spend`. */
function buildPlan(
  deps: SignActionDeps,
  state: IState,
  sign: RegistryEntry,
  payload: Record<string, unknown>,
  target: IActor | undefined
): CastPlan {
  const augmentIds = Array.isArray(payload.augmentIds) ? payload.augmentIds.map(String) : [];
  const plan = deps.casting.plan(
    sign,
    state.player,
    { investment: Number(payload.cost) || 1, augmentIds },
    castContext(deps, state, target)
  );
  const unlearned = notLearned(state.player, sign);
  return unlearned ? { ...plan, legal: false, reason: unlearned } : plan;
}

/** Why `caster` cannot weave `sign`, or null when they can. A caster with no list knows every Sign. */
function notLearned(caster: IActor, sign: RegistryEntry): string | null {
  const known = caster.knownSigns;
  if (!known || known.includes(sign.id)) return null;
  return `${caster.name} has not learned ${sign.name}.`;
}

/** Collects the battlefield facts augment gates are checked against. */
function castContext(deps: SignActionDeps, state: IState, target: IActor | undefined): CastContext {
  return {
    skill: effectiveSkill(state.player, 'Spell Casting'),
    casterZones: zoneTypesAt(state, state.player.pos),
    targetZones: target ? zoneTypesAt(state, target.pos) : [],
    targetConditions: target ? Object.keys(target.statuses ?? {}) : [],
    focus: heldFocus(deps, state.player),
    dimeritiumUnits: dimeritiumUnitsNear(state, state.player)
  };
}

/** Zone types covering a position. */
function zoneTypesAt(state: IState, position: { x: number; y: number }): string[] {
  const types: string[] = [];
  for (const zone of state.map?.zones ?? []) {
    if (GridService.distance({ x: zone.x, y: zone.y }, position) <= Number(zone.radius)) types.push(String(zone.type));
  }
  return types;
}

/**
 * The single focus the caster is drawing through.
 *
 * Only one focus can be drawn through at once, however many are carried, so the strongest
 * carried focus is used. An explicit `focusId` on the actor overrides that.
 */
function heldFocus(deps: SignActionDeps, actor: IActor): FocusProfile | null {
  const carried = Array.isArray(actor.focusItems) ? actor.focusItems.map(String) : [];
  const explicit = typeof actor.focusId === 'string' ? actor.focusId : null;
  const candidates = explicit ? [explicit] : carried;

  let best: FocusProfile | null = null;
  for (const id of candidates) {
    const row = deps.focusItems.get(id);
    if (!row) continue;
    const profile: FocusProfile = { name: String(row.name), value: Number(row.value) || 0, greater: Boolean(row.greater) };
    if (!best || profile.value > best.value || (profile.value === best.value && profile.greater && !best.greater)) best = profile;
  }
  return best;
}

/** Units of dimeritium within 5 m, each lowering the Vigor Threshold by 1. */
function dimeritiumUnitsNear(state: IState, actor: IActor): number {
  let units = 0;
  for (const zone of state.map?.zones ?? []) {
    if (String(zone.type) !== 'dimeritiumCloud') continue;
    if (GridService.distance({ x: zone.x, y: zone.y }, actor.pos) <= 5) units++;
  }
  return units;
}

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

/** One resolver shape. Signs select theirs through their `resolver` content field. */
type SignResolver = (context: ResolutionContext) => void;

interface ResolutionContext {
  deps: SignActionDeps;
  draft: IState;
  sign: RegistryEntry;
  plan: CastPlan;
  /** STA invested in the effect itself; the value every Sign scales from. */
  power: number;
  target: IActor | undefined;
  cast: { total: number; first: number; text: string };
}

function resolveSign(deps: SignActionDeps, draft: IState, payload: Record<string, unknown>): void {
  const sign = deps.signs.get(String(payload.signId));
  if (!sign) throw new Error('Unknown Sign.');
  const plan = (payload.plan as CastPlan | undefined) ?? buildPlan(deps, draft, sign, payload, undefined);
  const power = plan.investment;
  const target = deps.findActor(draft, (payload.targetId as string) ?? draft.selectedEnemyId);

  const cast = Dice.check(effectiveSkill(draft.player, 'Spell Casting') + plan.modifiers.castBonus, { label: String(sign.name) });

  reportOverexertion(deps, draft, plan);
  reportWeave(deps, draft, sign, plan);

  // A natural 1 on a magical attack is a fumble.
  if (cast.first === 1 && !applyFumble(deps, draft, sign, plan, target, cast)) return;

  const resolver = RESOLVERS[String(sign.resolver ?? '')];
  if (!resolver) {
    pushFeed(draft, {
      title: String(sign.name),
      story: `${draft.player.name} shapes ${sign.name}, but it has no battlefield effect here.`,
      math: cast.text
    });
    return;
  }
  resolver({ deps, draft, sign, plan, power, target, cast });
}

/** Announces the Health burned by exceeding the Vigor Threshold. */
function reportOverexertion(deps: SignActionDeps, draft: IState, plan: CastPlan): void {
  if (plan.vigorOver <= 0) return;
  pushFeed(draft, {
    kind: 'critical',
    title: 'Vigor exceeded',
    story: `The Sign exceeds ${draft.player.name}'s Vigor Threshold by ${plan.vigorOver}; magical backlash tears ${plan.healthCost} HP out of ${deps.grammar.object(draft.player)}.`,
    math: `Overcast ${plan.vigorOver} × 5 HP.`
  });
}

/** Announces which augments were woven in, and which were refused and why. */
function reportWeave(deps: SignActionDeps, draft: IState, sign: RegistryEntry, plan: CastPlan): void {
  if (!plan.augments.length && !plan.rejected.length && !plan.focusDiscount) return;
  const woven = plan.augments.map(augment => augment.name ?? augment.id).join(', ');
  const parts: string[] = [];
  if (woven) parts.push(`${draft.player.name} weaves ${woven} into ${sign.name}.`);
  if (plan.focusDiscount > 0) parts.push(`The focus carries ${plan.focusDiscount} STA of the draw.`);
  for (const refused of plan.rejected) parts.push(`${refused.name} will not take: ${refused.reason}`);
  pushFeed(draft, {
    title: `${sign.name} — weaving`,
    story: parts.join(' '),
    math: `Investment ${plan.investment} + augments ${plan.augmentCost} − focus ${plan.focusDiscount} = ${plan.staCost} STA.`
  });
}

/**
 * Applies a magic fumble. Returns true when the Sign still resolves.
 *
 * The margin is how badly the roll missed: against a defended Sign that is the gap to the target's
 * magical defense, and against an undefended one the gap to the caster's own skill, so a fumble
 * always costs at least a point.
 */
function applyFumble(
  deps: SignActionDeps,
  draft: IState,
  sign: RegistryEntry,
  plan: CastPlan,
  target: IActor | undefined,
  cast: { total: number; text: string }
): boolean {
  const opposition = Number(target?.defenses?.magic ?? effectiveSkill(draft.player, 'Spell Casting'));
  const outcome = deps.casting.fumble(String(sign.element ?? ''), Math.max(1, opposition - cast.total));

  draft.player.hp -= outcome.selfDamage;
  if (outcome.elemental && outcome.effect) {
    if (outcome.effect.condition) {
      deps.conditions.add(draft.player, String(outcome.effect.condition), outcome.effect.duration as number | undefined);
    }
    if (outcome.effect.knockback) pushBack(draft, draft.player, Number(outcome.effect.knockback));
  }
  if (outcome.focusExplodes && outcome.focusDamage) {
    const blast = Dice.rollNotation(outcome.focusDamage);
    draft.player.hp -= blast.total;
  }

  pushFeed(draft, {
    kind: 'critical',
    title: `${sign.name} fumbles`,
    story: `${outcome.text} ${outcome.effect ? outcome.effect.description ?? '' : ''}`.trim(),
    math: `${cast.text}; ${outcome.selfDamage} self damage.${plan.augments.length ? ' Woven augments are lost.' : ''}`
  });
  deps.presentationEffect('critical', 0.7);
  return outcome.spellGoesOff;
}

/** Moves an actor directly away from the centre of the field, as far as open ground allows. */
function pushBack(draft: IState, actor: IActor, metres: number): void {
  const steps = Math.max(1, Math.round(metres / 2));
  const stepX = Math.sign(actor.pos.x - GridService.W / 2) || 1;
  for (let step = 0; step < steps; step++) {
    const next = { x: actor.pos.x + stepX, y: actor.pos.y };
    if (!GridService.inside(next.x, next.y)) break;
    const tile = GridService.tile(draft, next.x, next.y);
    if (!tile || tile.blocksMove) break;
    actor.pos = next;
  }
}

/** Every conditions a resolver may apply from its augments. */
function applyAugmentConditions(context: ResolutionContext, victim: IActor): void {
  for (const entry of context.plan.modifiers.applies) {
    context.deps.conditions.add(victim, entry.condition, entry.duration);
  }
}

const RESOLVERS: Record<string, SignResolver> = {
  /** Quen: blocks one failed attack per STA spent. */
  ward({ draft, sign, plan, power, cast }) {
    const blocks = power * (Number(sign.blocksPerSta) || 1) + plan.modifiers.durationDelta;
    draft.player.quenBlocks = (draft.player.quenBlocks ?? 0) + blocks;
    pushFeed(draft, {
      title: String(sign.name),
      story: `A hard gold shimmer locks over ${draft.player.name}; it can swallow ${blocks} failed attack${blocks === 1 ? '' : 's'}.`,
      math: cast.text
    });
  },

  /** Active Shield: 10 HP of shell per STA, sustained for half the initial STA each round. */
  shield({ draft, sign, power, cast }) {
    const health = power * (Number(sign.healthPerSta) || 10);
    draft.player.activeShield = { hp: health, maxHp: health, cost: power, upkeep: Math.ceil(power / 2) };
    pushFeed(draft, {
      title: String(sign.name),
      story: `Quen blooms into a tangible shell with ${health} HP.`,
      math: `Upkeep ${Math.ceil(power / 2)} STA/round. ${cast.text}`
    });
  },

  /** Yrden and Magic Trap: a persistent zone centred on the caster. */
  zone({ deps, draft, sign, plan, power, cast }) {
    const duration = Number(sign.zoneDuration) || power * (Number(sign.zoneDurationPerSta) || 1);
    const radius = (Number(sign.range) || 0) + plan.modifiers.radiusDelta;
    deps.zones.create(draft, {
      type: String(sign.zoneType ?? sign.id),
      center: draft.player.pos,
      radius,
      duration: duration + plan.modifiers.durationDelta,
      power,
      source: String(sign.name)
    });
    pushFeed(draft, {
      title: String(sign.name),
      story: sign.zoneType === 'yrden'
        ? `Violet lines bite into the ground around ${draft.player.name}, slowing anything that enters.`
        : 'Yrden is built into a prepared trap that will strike the nearest intruder.',
      math: cast.text
    });
  },

  /** Aard and Aard Sweep: staggers, with a knockdown chance that scales with STA. */
  force(context) {
    const { deps, draft, sign, plan, power, target, cast } = context;
    const reach = (Number(sign.range) || 0) + plan.modifiers.rangeDelta;
    const victims = sign.areaOfEffect
      ? draft.enemies.filter(enemy => isHostile(enemy) && GridService.distance(draft.player.pos, enemy.pos) <= reach)
      : (target ? [target] : []);

    const knockdown = power * (Number(sign.knockdownPerSta) || 10) + plan.modifiers.knockdownChance;
    for (const victim of victims) {
      if (sign.staggers) deps.conditions.add(victim, 'staggered');
      if (Dice.d(100) <= knockdown) deps.conditions.add(victim, 'prone');
      applyBonusDamage(context, victim);
      applyAugmentConditions(context, victim);
    }
    pushFeed(draft, {
      title: String(sign.name),
      story: `Telekinetic force hammers ${victims.length === 1 ? victims[0]?.name : `${victims.length} targets`}, staggering the line${victims.some(victim => victim.statuses.prone) ? ' and throwing bodies down' : ''}.`,
      math: `${cast.text}; knockdown ${knockdown}%.`
    });
  },

  /** Axii, Puppet, and Somne: an opposed Resist Magic roll, then a control effect. */
  dominate(context) {
    const { deps, draft, sign, plan, power, target, cast } = context;
    if (!target) throw new Error(`${sign.name} needs a target.`);
    const resist = Dice.check(Number(target.defenses?.magic ?? 10), { label: 'Resist Magic' });
    if (cast.total <= resist.total) {
      pushFeed(draft, {
        kind: 'miss',
        title: `${sign.name} resisted`,
        story: `${target.name} forces the magic out.`,
        math: `${cast.text}; ${resist.text}`
      });
      return;
    }

    const control = String(sign.control ?? 'stun');
    if (control === 'puppet') {
      target.statuses.puppet = power;
      target.controlEffect = { type: 'puppet', sourceId: draft.player.id, remaining: power, originalFaction: target.faction, originalTeam: target.team };
      target.faction = 'player-controlled';
    } else if (control === 'sleep') {
      // Somne: sleep is resolved as a deep stun that outlasts an ordinary one.
      deps.conditions.add(target, 'stunned', power + 2 + plan.modifiers.durationDelta);
    } else {
      // Axii: the Stun save worsens by 1 for every 2 extra STA past the first.
      deps.conditions.add(target, 'stunned', Math.ceil((power + 1) / 2) + plan.modifiers.durationDelta);
    }
    applyAugmentConditions(context, target);

    pushFeed(draft, {
      title: String(sign.name),
      story: control === 'puppet'
        ? `${target.name}'s intent is forcibly bent to ${draft.player.name}'s will.`
        : `${target.name}'s focus buckles under ${sign.name}.`,
      math: `${cast.text}; ${resist.text}`
    });
  },

  /** Igni and Fire Stream: 1d6 per STA, with an ignition chance. */
  flame(context) {
    const { deps, draft, sign, plan, power, target, cast } = context;
    if (!target) throw new Error(`${sign.name} needs a target.`);
    const defense = Dice.check(Number(target.defenses?.dodge ?? 10), { label: 'Dodge' });
    if (cast.total <= defense.total) {
      pushFeed(draft, {
        kind: 'miss',
        title: `${sign.name} misses`,
        story: `${target.name} gets clear of the fire before it can bite.`,
        math: `${cast.text}; ${defense.text}`
      });
      return;
    }

    const dice = power * (Number(sign.damageDicePerSta) || 1) + plan.modifiers.damageDicePerSta * power;
    const roll = Dice.rollNotation(`${Math.max(1, dice)}d${Number(sign.damageDie) || 6}`);
    const bonus = rollBonusDamage(context);
    const location = context.deps.location(target.family === 'Human' ? 'human' : 'monster', 'random');
    const damage = deps.damage.resolve(draft, {
      attacker: draft.player,
      target,
      raw: roll.total + bonus.total,
      type: 'E',
      location,
      weapon: { effects: plan.modifiers.armorPiercing ? ['ArmorPiercing'] : [] },
      source: String(sign.name)
    });

    const ignition = (Number(sign.ignitionChance) || 50) + plan.modifiers.ignitionChance;
    if (Dice.d(100) <= ignition) deps.conditions.add(target, 'burning');
    deps.zones.igniteDream(draft, target.pos);
    applyAugmentConditions(context, target);
    if (sign.sustained) {
      draft.player.activeSigns ??= {};
      draft.player.activeSigns[String(sign.sustained)] = { targetId: target.id, cost: power, upkeep: Math.ceil(power / 2) };
    }

    pushFeed(draft, {
      kind: damage.dealt ? 'hit' : 'miss',
      title: String(sign.name),
      story: damage.dealt
        ? `${sign.name} catches ${target.name} at the ${location.name.toLowerCase()} for ${damage.dealt} damage${target.statuses.burning ? ' and leaves fire clinging to them' : ''}.`
        : 'The flames wash over armor without getting through.',
      math: `${cast.text}; damage ${roll.text}${bonus.text}.`
    });
  },

  /** Signs with no battlefield effect, such as Supirre. */
  utility({ draft, sign, cast }) {
    pushFeed(draft, {
      title: String(sign.name),
      story: `${draft.player.name} completes ${sign.name}. It has no effect on the fight itself.`,
      math: cast.text
    });
  }
};

/** Rolls every augment-granted damage expression. */
function rollBonusDamage(context: ResolutionContext): { total: number; text: string } {
  let total = 0;
  const parts: string[] = [];
  for (const expression of context.plan.modifiers.bonusDamage) {
    const roll = Dice.rollNotation(expression);
    total += roll.total;
    parts.push(`${expression} ${roll.total}`);
  }
  return { total, text: parts.length ? ` + augments [${parts.join(', ')}]` : '' };
}

/** Applies augment-granted damage to a victim of an otherwise non-damaging Sign. */
function applyBonusDamage(context: ResolutionContext, victim: IActor): void {
  if (!context.plan.modifiers.bonusDamage.length) return;
  const bonus = rollBonusDamage(context);
  if (bonus.total <= 0) return;
  const location = context.deps.location(victim.family === 'Human' ? 'human' : 'monster', 'random');
  context.deps.damage.resolve(context.draft, {
    attacker: context.draft.player,
    target: victim,
    raw: bonus.total,
    type: 'E',
    location,
    weapon: { effects: context.plan.modifiers.armorPiercing ? ['ArmorPiercing'] : [] },
    source: `${context.sign.name} (woven)`
  });
}
