import type { IActor } from '../entities/types';

/**
 * Magical cast planning: focus discounts, Vigor overexertion, augmentation, and fumbles.
 *
 * The system is generic. It never names a Sign, a spell, an element, or an augment — it is handed
 * castable definitions and augment definitions and it merges them into a `CastPlan`. Which
 * augments exist, what they cost, and what they modify is *content*.
 *
 * `plan()` is deliberately pure: no dice, no state mutation. That lets presentation show the exact
 * cost of a cast before the player commits to it, and lets tests assert the arithmetic without a
 * seeded RNG. Randomness enters only in `fumble()`, which the caller invokes after a natural 1.
 *
 * Rules encoded here:
 * - Vigor Threshold and overexertion: 5 HP per point of STA cost above the caster's Vigor.
 * - Magical focuses: the focus value comes off the STA cost, but never below 1; the focus must be
 *   held and only one may be used at a time.
 * - Greater Focus: spells cast through it count their DCs as 2 points higher.
 * - Magic fumble outcomes and the elemental fumble effects.
 *
 * Augment stacking is a house extension. The framework only enforces the budget the host game
 * declares; see `docs/DECISIONS.md` D17.
 */

/** A castable magical effect: a Sign, spell, or invocation row from content. */
export interface CastableDefinition {
  id?: string;
  name?: string;
  /** Grouping used by augment targeting, e.g. a Sign family. */
  family?: string;
  /** Elemental attunement used by augment targeting and fumble tables. */
  element?: string;
  /** Delivery shape used by augment targeting, e.g. `cone`, `radius`, `target`, `self`. */
  shape?: string;
  range?: number;
  /** Highest STA the definition itself accepts. */
  maxCost?: number;
  [field: string]: unknown;
}

/**
 * The merged, declarative result of every augment applied to one cast.
 *
 * Every field is additive so merging is order-independent and a new augment never needs a branch
 * in the resolver. Resolvers read the fields they understand and ignore the rest.
 */
export interface CastModifiers {
  /** Added to the casting roll, e.g. from a Greater Focus. */
  castBonus: number;
  /** Extra damage dice granted per point of STA invested in the effect. */
  damageDicePerSta: number;
  /** Flat extra damage expressions rolled alongside the effect's own damage. */
  bonusDamage: string[];
  /** Percentage points added to an ignition chance. */
  ignitionChance: number;
  /** Percentage points added to a knockdown chance. */
  knockdownChance: number;
  /** Metres added to an area effect's radius. */
  radiusDelta: number;
  /** Metres added to the effect's range. */
  rangeDelta: number;
  /** Rounds added to the effect's duration. */
  durationDelta: number;
  /** Additional targets an otherwise single-target effect may catch. */
  extraTargets: number;
  /** Ignores armour on the damage it deals. */
  armorPiercing: boolean;
  /** Conditions the effect applies on a success, beyond its own. */
  applies: Array<{ condition: string; duration?: number }>;
  /** Free-form markers resolvers and narration may read. */
  tags: string[];
}

/** An augment definition: one declarative modification a caster may weave into a cast. */
export interface AugmentDefinition {
  id?: string;
  name?: string;
  description?: string;
  /** Extra STA this augment adds to the cast. */
  staCost?: number;
  /** Which castables accept it. An absent field means "no restriction on that axis". */
  appliesTo?: {
    families?: readonly string[];
    elements?: readonly string[];
    shapes?: readonly string[];
    ids?: readonly string[];
  };
  /** Gates that must hold at cast time. */
  requires?: {
    /** Minimum effective casting skill. */
    minSkill?: number;
    /** Zone type the caster must be standing in. */
    casterZone?: string;
    /** Zone type the target must be standing in. */
    targetZone?: string;
    /** Status the target must already carry. */
    targetCondition?: string;
    /** Requires a held magical focus. */
    focus?: boolean;
  };
  /**
   * Augments sharing a group are mutually exclusive, so a caster cannot stack three variants of
   * the same idea.
   */
  exclusiveGroup?: string;
  effects?: Partial<CastModifiers>;
  [field: string]: unknown;
}

/** A held magical focus (staff, amulet, or a weapon carrying the Focus effect). */
export interface FocusProfile {
  name?: string;
  /** Points subtracted from the STA cost. */
  value: number;
  /** Greater Focus: the cast counts as 2 points harder to resist. */
  greater?: boolean;
}

/** Anything that can resolve a content id. A `Map` satisfies this. */
export interface DefinitionSource<T> {
  get(id: string): T | undefined;
}

/**
 * An augment table. `entries()` is optional so a bare lookup still works; when it is present the
 * system can enumerate what a caster could weave, which presentation needs to offer the choice.
 */
export interface AugmentSource extends DefinitionSource<AugmentDefinition> {
  entries?(): Iterable<[string, AugmentDefinition]>;
}

/** One augment offered for a specific cast, with the reason it cannot be used when it cannot. */
export interface AugmentAvailability {
  id: string;
  augment: AugmentDefinition;
  legal: boolean;
  reason?: string;
}

/** One rejected augment and why, so the UI can explain rather than silently drop it. */
export interface RejectedAugment {
  id: string;
  name: string;
  reason: string;
}

/** The battlefield facts augment gates are checked against. */
export interface CastContext {
  /** Effective casting skill after conditions and wounds. */
  skill: number;
  /** Zone types the caster currently stands in. */
  casterZones?: readonly string[];
  /** Zone types the target currently stands in. */
  targetZones?: readonly string[];
  /** Statuses the target currently carries. */
  targetConditions?: readonly string[];
  /** The focus the caster is holding, if any. */
  focus?: FocusProfile | null;
  /** Units of dimeritium within range, each lowering the Vigor Threshold by 1. */
  dimeritiumUnits?: number;
}

/** A fully costed cast, ready to be committed or displayed. */
export interface CastPlan {
  /** STA invested in the effect itself, before augments and focus. */
  investment: number;
  /** STA added by the accepted augments. */
  augmentCost: number;
  /** STA removed by the held focus. */
  focusDiscount: number;
  /** STA actually spent. Never below 1. */
  staCost: number;
  /** The caster's Vigor Threshold after dimeritium suppression. */
  vigor: number;
  /** Points of STA cost above the Vigor Threshold. */
  vigorOver: number;
  /** Health burned by overexertion: 5 per point over. */
  healthCost: number;
  /** Augments that passed their gates, in registration order. */
  augments: AugmentDefinition[];
  /** Augments that were requested but rejected, with reasons. */
  rejected: RejectedAugment[];
  /** The merged modifications the resolver applies. */
  modifiers: CastModifiers;
  /** False when the cast may not proceed at all. */
  legal: boolean;
  /** Why the cast is illegal, when it is. */
  reason?: string;
}

/** The outcome of a magic fumble, per the Magic Fumble Outcome table. */
export interface FumbleOutcome {
  /** The second d10 the table is read against. */
  roll: number;
  /** Whether the effect still resolves. */
  spellGoesOff: boolean;
  /** Damage the caster takes: 1 per point they fumbled by. */
  selfDamage: number;
  /** Whether the elemental fumble effect applies. */
  elemental: boolean;
  /** Whether a held focus detonates as a bomb. */
  focusExplodes: boolean;
  /** Damage expression for an exploding focus. */
  focusDamage?: string;
  /** Radius in metres for an exploding focus. */
  focusRadius?: number;
  /** The elemental effect row, when one applies. */
  effect?: ElementalFumbleDefinition | null;
  /** Human-readable summary for the combat feed. */
  text: string;
}

/** One row of the elemental fumble table. */
export interface ElementalFumbleDefinition {
  name?: string;
  description?: string;
  /** Condition applied to the caster. */
  condition?: string;
  duration?: number;
  /** Metres the caster is thrown back. */
  knockback?: number;
  [field: string]: unknown;
}

export interface SpellCastingOptions {
  /** Elemental fumble rows, keyed by element. */
  fumbles?: DefinitionSource<ElementalFumbleDefinition>;
  /** Element used when a castable declares none, or its element has no row. */
  fallbackElement?: string;
  /** Most augments one cast may carry. The house limit on "mixing". */
  maxAugments?: number;
  /** Health burned per point of STA above the Vigor Threshold. */
  overexertionHealthPerPoint?: number;
  /** Casting bonus a Greater Focus grants. */
  greaterFocusBonus?: number;
  /** Rolls a single die. Injected so the system stays free of kernel imports. */
  roll?: (sides: number) => number;
}

/** An empty modifier set. Every merge starts from a fresh copy of this shape. */
export function emptyModifiers(): CastModifiers {
  return {
    castBonus: 0,
    damageDicePerSta: 0,
    bonusDamage: [],
    ignitionChance: 0,
    knockdownChance: 0,
    radiusDelta: 0,
    rangeDelta: 0,
    durationDelta: 0,
    extraTargets: 0,
    armorPiercing: false,
    applies: [],
    tags: []
  };
}

export class SpellCastingSystem {
  readonly #fumbles: DefinitionSource<ElementalFumbleDefinition> | null;
  readonly #fallbackElement: string;
  readonly #maxAugments: number;
  readonly #healthPerPoint: number;
  readonly #greaterFocusBonus: number;
  readonly #roll: (sides: number) => number;

  constructor(
    private readonly augmentSource: AugmentSource,
    options: SpellCastingOptions = {}
  ) {
    this.#fumbles = options.fumbles ?? null;
    this.#fallbackElement = options.fallbackElement ?? 'Mixed';
    this.#maxAugments = options.maxAugments ?? 2;
    this.#healthPerPoint = options.overexertionHealthPerPoint ?? 5;
    this.#greaterFocusBonus = options.greaterFocusBonus ?? 2;
    this.#roll = options.roll ?? ((sides: number) => 1 + Math.floor(Math.random() * sides));
  }

  /** The house cap on how many augments one cast may carry. */
  get maxAugments(): number { return this.#maxAugments; }

  /**
   * Costs one cast without touching state or dice.
   *
   * Order matters and follows the standard rules: augments raise the STA cost, the focus discounts the
   * total (never below 1), and only the resulting cost is measured against the Vigor Threshold. A
   * focus therefore genuinely protects a caster from overexertion, which is the point of carrying
   * one.
   */
  plan(
    castable: CastableDefinition,
    caster: IActor,
    request: { investment: number; augmentIds?: readonly string[] },
    context: CastContext
  ): CastPlan {
    const maxInvestment = Number(castable.maxCost) || 7;
    const investment = clampInt(request.investment, 1, maxInvestment);
    const accepted: AugmentDefinition[] = [];
    const rejected: RejectedAugment[] = [];
    const claimedGroups = new Set<string>();

    for (const augmentId of request.augmentIds ?? []) {
      const augment = this.augmentSource.get(augmentId);
      if (!augment) {
        rejected.push({ id: augmentId, name: augmentId, reason: 'Unknown augment.' });
        continue;
      }
      const label = augment.name ?? augmentId;
      if (accepted.length >= this.#maxAugments) {
        rejected.push({ id: augmentId, name: label, reason: `A cast may carry at most ${this.#maxAugments} augments.` });
        continue;
      }
      const group = augment.exclusiveGroup;
      if (group && claimedGroups.has(group)) {
        rejected.push({ id: augmentId, name: label, reason: `Conflicts with another ${group} augment already woven in.` });
        continue;
      }
      const applicability = this.#checkApplicability(augment, castable);
      if (applicability) {
        rejected.push({ id: augmentId, name: label, reason: applicability });
        continue;
      }
      const gate = this.#checkRequirements(augment, context);
      if (gate) {
        rejected.push({ id: augmentId, name: label, reason: gate });
        continue;
      }
      if (group) claimedGroups.add(group);
      accepted.push(augment);
    }

    const augmentCost = accepted.reduce((sum, augment) => sum + Math.max(0, Number(augment.staCost) || 0), 0);
    const focus = context.focus ?? null;
    const gross = investment + augmentCost;
    // However strong the focus, the spell still costs at least 1 STA.
    const focusDiscount = focus ? Math.min(Math.max(0, Math.floor(focus.value)), gross - 1) : 0;
    const staCost = Math.max(1, gross - focusDiscount);

    // Dimeritium within range lowers the Vigor Threshold by 1 per unit.
    const baseVigor = Math.max(0, Number(caster.vigor) || 0);
    const vigor = Math.max(0, baseVigor - Math.max(0, Number(context.dimeritiumUnits) || 0));
    const vigorOver = Math.max(0, staCost - vigor);
    const healthCost = vigorOver * this.#healthPerPoint;

    const modifiers = this.#mergeModifiers(accepted);
    if (focus?.greater) modifiers.castBonus += this.#greaterFocusBonus;

    const plan: CastPlan = {
      investment,
      augmentCost,
      focusDiscount,
      staCost,
      vigor,
      vigorOver,
      healthCost,
      augments: accepted,
      rejected,
      modifiers,
      legal: true
    };

    const staAvailable = Number(caster.sta) || 0;
    const healthAvailable = Number(caster.hp) || 0;
    if (staAvailable < staCost) {
      plan.legal = false;
      plan.reason = `Need ${staCost} STA; only ${staAvailable} remains.`;
    } else if (healthCost > 0 && healthAvailable <= healthCost) {
      // Overexertion that would drop the caster to zero is refused rather than resolved as suicide.
      plan.legal = false;
      plan.reason = `Overexerting by ${vigorOver} would cost ${healthCost} HP and ${caster.name} has ${healthAvailable}.`;
    }
    return plan;
  }

  /**
   * Every augment that could apply to `castable`, marked legal or not for the current context.
   *
   * Augments that do not apply to this castable at all are omitted rather than listed as refused —
   * a fire augment is not a "failure" when the caster is shaping Aard, it is simply irrelevant.
   */
  availability(castable: CastableDefinition, context: CastContext): AugmentAvailability[] {
    const entries = this.augmentSource.entries?.();
    if (!entries) return [];
    const out: AugmentAvailability[] = [];
    for (const [id, augment] of entries) {
      if (this.#checkApplicability(augment, castable)) continue;
      const gate = this.#checkRequirements(augment, context);
      out.push(gate ? { id, augment, legal: false, reason: gate } : { id, augment, legal: true });
    }
    return out;
  }

  /** Returns why `augment` cannot modify `castable`, or `null` when it can. */
  #checkApplicability(augment: AugmentDefinition, castable: CastableDefinition): string | null {
    const scope = augment.appliesTo;
    if (!scope) return null;
    if (scope.ids?.length && !scope.ids.includes(String(castable.id))) {
      return `${augment.name ?? 'That augment'} does not apply to ${castable.name ?? 'this effect'}.`;
    }
    if (scope.families?.length && !scope.families.includes(String(castable.family))) {
      return `${augment.name ?? 'That augment'} only shapes ${scope.families.join('/')} magic.`;
    }
    if (scope.elements?.length && !scope.elements.includes(String(castable.element))) {
      return `${augment.name ?? 'That augment'} only shapes ${scope.elements.join('/')} magic.`;
    }
    if (scope.shapes?.length && !scope.shapes.includes(String(castable.shape))) {
      return `${augment.name ?? 'That augment'} cannot be woven into a ${castable.shape ?? 'shapeless'} effect.`;
    }
    return null;
  }

  /** Returns why `augment`'s gates fail in `context`, or `null` when they hold. */
  #checkRequirements(augment: AugmentDefinition, context: CastContext): string | null {
    const gate = augment.requires;
    if (!gate) return null;
    const label = augment.name ?? 'That augment';
    if (gate.minSkill !== undefined && context.skill < gate.minSkill) {
      return `${label} needs an effective casting skill of ${gate.minSkill}.`;
    }
    if (gate.focus && !context.focus) {
      return `${label} must be woven through a held focus.`;
    }
    if (gate.casterZone && !(context.casterZones ?? []).includes(gate.casterZone)) {
      return `${label} requires the caster to stand inside ${gate.casterZone}.`;
    }
    if (gate.targetZone && !(context.targetZones ?? []).includes(gate.targetZone)) {
      return `${label} requires the target to stand inside ${gate.targetZone}.`;
    }
    if (gate.targetCondition && !(context.targetConditions ?? []).includes(gate.targetCondition)) {
      return `${label} requires the target to be ${gate.targetCondition}.`;
    }
    return null;
  }

  /** Folds every accepted augment's declarative effects into one additive modifier set. */
  #mergeModifiers(augments: readonly AugmentDefinition[]): CastModifiers {
    const merged = emptyModifiers();
    for (const augment of augments) {
      const effects = augment.effects;
      if (!effects) continue;
      merged.castBonus += Number(effects.castBonus) || 0;
      merged.damageDicePerSta += Number(effects.damageDicePerSta) || 0;
      merged.ignitionChance += Number(effects.ignitionChance) || 0;
      merged.knockdownChance += Number(effects.knockdownChance) || 0;
      merged.radiusDelta += Number(effects.radiusDelta) || 0;
      merged.rangeDelta += Number(effects.rangeDelta) || 0;
      merged.durationDelta += Number(effects.durationDelta) || 0;
      merged.extraTargets += Number(effects.extraTargets) || 0;
      merged.armorPiercing ||= Boolean(effects.armorPiercing);
      if (effects.bonusDamage?.length) merged.bonusDamage.push(...effects.bonusDamage);
      if (effects.applies?.length) merged.applies.push(...effects.applies);
      if (effects.tags?.length) merged.tags.push(...effects.tags);
    }
    return merged;
  }

  /**
   * Resolves a magic fumble after a natural 1 on the casting roll.
   *
   * Roll 1d10 and read the magic fumble outcome table. On 1-6 the caster
   * takes 1 damage per point they fumbled by but the effect still resolves; on 7-9 the effect
   * fails and the elemental fumble effect applies; above 9 a held focus also detonates.
   */
  fumble(element: string | undefined, fumbledBy: number): FumbleOutcome {
    const roll = this.#roll(10);
    const margin = Math.max(1, Math.floor(fumbledBy));
    const key = element && this.#fumbles?.get(element) ? element : this.#fallbackElement;
    const effect = this.#fumbles?.get(key) ?? null;

    if (roll <= 6) {
      return {
        roll,
        spellGoesOff: true,
        selfDamage: margin,
        elemental: false,
        focusExplodes: false,
        effect: null,
        text: `Magic fumble ${roll}: sparks and crackle. ${margin} damage, but the effect still goes off.`
      };
    }
    if (roll <= 9) {
      return {
        roll,
        spellGoesOff: false,
        selfDamage: margin,
        elemental: true,
        focusExplodes: false,
        effect,
        text: `Magic fumble ${roll}: the chaos ignites inside the caster. The effect fails and a ${key} backlash follows.`
      };
    }
    return {
      roll,
      spellGoesOff: false,
      selfDamage: margin,
      elemental: true,
      focusExplodes: true,
      focusDamage: '1d10',
      focusRadius: 2,
      effect,
      text: `Magic fumble ${roll}: catastrophic backlash. Any carried focus detonates.`
    };
  }
}

function clampInt(value: unknown, min: number, max: number): number {
  const numeric = Math.floor(Number(value) || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}
