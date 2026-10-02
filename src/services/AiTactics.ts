import { GridService as GridServiceLike } from './GridService';
import type { TerrainEffects } from '../data/content/terrain';
import type { AbilityOption } from './CreatureAbilities';
import type { IActor, IState, ITile } from '../entities/types';

/** Minimal shapes so this module depends on data rather than on the full actor/state graph. */
type ActorLike = IActor;
type IStateLike = IState;

/**
 * Tactical judgements the AI makes about terrain and abilities.
 *
 * First pieces of the AI to leave the bridge. Both are pure functions of data — a tile and its
 * terrain row, or an ability and its tags — so they are testable on their own and name neither a
 * creature nor a terrain.
 */

export interface TerrainLookup {
  get(id: string): { effects?: TerrainEffects;[field: string]: unknown } | undefined;
}

/**
 * How much an actor wants to stand on a tile, from terrain data alone.
 *
 * Water-native creatures gain where water would punish anyone else, which is why drowners fight
 * from the shallows and why dragging one onto dry land is worth the effort. Everyone else simply
 * dislikes ground that costs them movement or defense.
 *
 * The caller supplies `waterNative` rather than an actor, so this stays free of the ability system.
 */
export function terrainAffinity(
  tile: ITile | undefined,
  terrain: TerrainLookup,
  options: { waterNative?: boolean } = {}
): number {
  if (!tile) return 0;
  const effects = terrain.get(String(tile.terrainKind))?.effects ?? {};

  if (options.waterNative) {
    // Deep water is where it wants to be; merely soft ground is a mild preference.
    if (effects.dodgeUsesAthletics) return 16;
    return Number(tile.moveCost) > 1 ? 7 : 0;
  }

  const penalties = (Number(effects.dodgePenalty) || 0) + (Number(effects.meleePenalty) || 0);
  const slog = Math.max(0, (Number(tile.moveCost) || 1) - 1) * 3;
  return penalties * 2 - slog;
}

/**
 * Maps an ability onto the action vocabulary the utility weights already use.
 *
 * Profile weights are written against names like `attack` and `reposition`. Giving every ability a
 * unique name would make it invisible to those weights, so an ability scores as the kind of thing
 * it *is*: a charge is an attack, a screech is control, flight is a reposition.
 */
export function abilityActionName(option: AbilityOption): string {
  const declared = option.ability.actionName;
  if (typeof declared === 'string' && declared) return declared;
  const tags = Array.isArray(option.ability.tags) ? option.ability.tags : [];
  if (tags.includes('attack')) return 'attack';
  if (tags.includes('movement')) return 'reposition';
  if (tags.includes('defense')) return 'defend';
  if (tags.includes('support')) return 'support';
  return 'control';
}

/** The candidate shape the AI builds from an ability, minus the fields only the bridge knows. */
export function abilityCandidate(option: AbilityOption): {
  name: string;
  base: number;
  tags: string[];
  expectedDamage: number;
  controlValue: number;
  futureValue: number;
} {
  const tags = Array.isArray(option.ability.tags) ? option.ability.tags : [];
  return {
    name: abilityActionName(option),
    base: option.utility,
    tags: ['ability', ...tags],
    expectedDamage: Number(option.ability.expectedDamage) || (tags.includes('attack') ? 24 : 0),
    controlValue: tags.includes('control') ? 20 : 0,
    futureValue: tags.includes('movement') || tags.includes('support') ? 16 : 0
  };
}

/** One spell the caster could reach for, as the registry stores it. */
export interface SpellOption {
  id: string;
  name?: string;
  cost?: number;
  range?: number;
  damage?: string | number | null;
  tags?: string[];
  /** Conditions the spell inflicts when it lands. A spell with neither damage nor these does nothing. */
  effects?: readonly string[];
}

/** What the caster knows about the moment. Nothing here reads the target's equipment. */
export interface SpellContext {
  /** Metres to the target. */
  distance: number;
  /** Caster's health, 0-1. */
  health: number;
  /** Most wounded ally's health as 0-1, or null when nobody needs help. */
  woundedAlly: number | null;
  hasLineOfSight: boolean;
  tier: number;
}

/** Average total of a dice notation such as `8d6` or `4d6+2`. Zero for anything unparseable. */
export function averageRoll(notation: string | number | null | undefined): number {
  const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(String(notation ?? '').trim());
  if (!match) return 0;
  const count = Number(match[1]), faces = Number(match[2]), flat = Number(match[3] ?? 0);
  return count * (faces + 1) / 2 + flat;
}

/**
 * What a spell is worth to the caster right now.
 *
 * The thing this exists to fix: every damaging spell used to score a flat 82 with a flat expected
 * damage of 16, so a mage picked a 1d6 cantrip as readily as an 8d6 thunderbolt — and against an
 * armoured opponent the cantrip cannot do anything at all. A caster is now made to prefer its
 * heavier magic, which is the whole difference between a mage who is a threat and one who is not.
 *
 * It reads the caster's own spellbook and the distance between the two of them. It does not look at
 * the target's armour, inventory, or anything else the caster could not see.
 *
 * Returns null when the spell is not worth offering at all this turn.
 */
export function spellCandidate(spell: SpellOption, context: SpellContext): {
  base: number;
  tags: string[];
  resourceCost: number;
  expectedDamage: number;
  controlValue: number;
  futureValue: number;
} | null {
  const tags = Array.isArray(spell.tags) ? spell.tags : [];
  const cost = Number(spell.cost) || 0;

  // A heal is worth what the wound is worth, and nothing at all when everyone is whole.
  if (tags.includes('heal')) {
    if (context.woundedAlly === null) return null;
    return {
      base: 88 + (1 - context.woundedAlly) * 24,
      tags: ['cast', 'heal'], resourceCost: cost, expectedDamage: 0, controlValue: 0, futureValue: 18
    };
  }

  // Blinking away is a response to danger, not a reflex. Scored by how hurt the caster is, it sits
  // below a good attack at full health and above everything when the caster is nearly dead — which
  // stops the loop where a healthy mage teleported out every round and walked back in.
  if (tags.includes('escape')) {
    if (context.distance >= 4) return null;
    return {
      base: 58 + (1 - context.health) * 44,
      tags: ['cast', 'escape'], resourceCost: cost, expectedDamage: 0, controlValue: 0, futureValue: 26
    };
  }

  const range = Number(spell.range) || 0;
  if (range > 0 && context.distance > range) return null;
  if (!context.hasLineOfSight) return null;

  const expected = averageRoll(spell.damage);
  // A spell that deals nothing and inflicts nothing has no effect when it resolves, and offering
  // one is how three mages came to spend an entire fight casting Magic Screen at each other's
  // backs. Read from the spell's own row rather than from a list of names.
  if (expected <= 0 && !(spell.effects?.length)) return null;

  const control = tags.includes('control');

  // A heavier spell is worth more, and a caster clever enough to plan reaches further up its list.
  const weight = Math.min(30, expected) * (1 + Math.max(0, context.tier - 2) * 0.06);
  const base = (expected > 0 ? 70 + weight : 78) + (control ? 4 : 0);

  return {
    base,
    tags: ['cast', control && expected === 0 ? 'control' : 'damage'],
    resourceCost: cost,
    expectedDamage: expected,
    controlValue: control ? 18 : 0,
    futureValue: 0
  };
}

/** Actor field an actor uses to declare it is at home in water, for callers assembling options. */
export const WATER_NATIVE_TAG = 'waterNative';

/**
 * One scoring adjustment, with the reason it was applied.
 *
 * The AI's explainability is a feature — the debug panel shows why a creature chose what it chose —
 * so every adjustment carries a human-readable label rather than being folded into a number.
 */
export interface Insight { label: string; value: number }

/** What the tactical layer needs to know about the fight. */
export interface InsightContext {
  /** Cognition tier, 0 (mindless) to 5 (mastermind). */
  tier: number;
  /** Distance to the target in metres. */
  distance: number;
  /** The acting creature's remaining Health, 0-1. */
  health: number;
  /** The target's remaining Health, 0-1. */
  targetHealth: number;
  /** Quen blocks the target currently has standing. */
  targetWard: number;
  /** Active Shield hit points the target currently has. */
  targetShield: number;
  /** Stamina the target has left, 0-1: how much magic they can still afford. */
  targetStamina: number;
  /** Whether the target is prone, stunned, or otherwise open. */
  targetOpen: boolean;
  /** Zone types the acting creature is standing in. */
  standingIn: readonly string[];
  /** Elevation of the tile the creature occupies. */
  elevation: number;
  /** Whether the creature can currently see its target. */
  hasLineOfSight: boolean;
  /** Allies still fighting. */
  allies: number;
}

/**
 * Tactical judgement that only clever things make.
 *
 * Everything here is gated on cognition tier, which is the point: a drowner has the wits of a
 * bottom-feeder and must keep charging blindly, while a higher vampire or a mage should
 * read the fight. Gating by tier rather than by creature keeps ground rule 8 intact — nothing here
 * names a monster.
 *
 * The adjustments are deliberately about *information a thinking opponent would act on*:
 *
 * - a ward standing on the target means an attack is wasted, so wait or spend the ward down;
 * - an opening (prone, stunned) is worth committing to, because it will not last;
 * - a target low on Stamina cannot afford another Sign, so pressure beats patience;
 * - height and cover are worth taking before they are needed, not after;
 * - a creature that is losing should break line of sight rather than trade to death.
 */
export function tacticalInsight(
  action: { name: string; tags?: readonly string[] },
  context: InsightContext
): Insight[] {
  const out: Insight[] = [];
  const tags = action.tags ?? [];
  const add = (label: string, value: number): void => { if (value) out.push({ label, value }); };
  const attacking = tags.includes('attack') || action.name === 'attack';

  // --- tier 2: reads the target's defenses ------------------------------------------------------
  if (context.tier >= 2) {
    const warded = context.targetWard > 0 || context.targetShield > 0;
    if (attacking && warded) {
      // Hitting a ward is not wasted — it strips it — but it is worth less than hitting flesh.
      add('target is warded', -6 - Math.min(8, context.targetWard * 2));
    }
    if (context.targetOpen && attacking) add('target is open', 14 + context.tier * 2);
    if (context.targetOpen && tags.includes('control')) add('already controlled', -12);
  }

  // --- tier 3: uses the ground ------------------------------------------------------------------
  if (context.tier >= 3) {
    if (tags.includes('ranged') && context.elevation > 0) add('shooting from height', 4 * context.elevation);
    if (context.standingIn.length) add('standing in a hazard', -10 * context.standingIn.length);
    if (attacking && !context.hasLineOfSight) add('no clear line', -14);
    // A wounded thinker disengages rather than trading to the death.
    if (context.health < 0.4 && action.name === 'reposition') add('breaking off while hurt', 12 + context.tier * 2);
    if (context.health < 0.4 && attacking) add('bad trade while hurt', -8);
  }

  // --- tier 4: reads the target's resources -----------------------------------------------------
  if (context.tier >= 4) {
    // A caster with no Stamina is a swordsman. Closing is safe; staying back wastes the window.
    if (context.targetStamina < 0.25 && attacking) add('target is out of Stamina', 10);
    if (context.targetStamina > 0.7 && context.distance > 6 && action.name === 'reposition') {
      add('close before they can cast', 8);
    }
    if (context.targetHealth < 0.3 && attacking) add('finishing a wounded opponent', 12 + context.tier);
  }

  // --- tier 5: fights the whole engagement ------------------------------------------------------
  if (context.tier >= 5) {
    // Alone against a healthy opponent, a mastermind buys time rather than trading.
    if (context.allies === 0 && context.targetHealth > 0.6 && action.name === 'reposition') {
      add('outnumbered: keep the distance', 10);
    }
    if (context.allies >= 2 && attacking) add('pack advantage', 8);
  }

  return out;
}

/** The battlefield facts `tacticalInsight` reads, gathered from state. */
export interface InsightInputs {
  tier: number;
  distance: number;
  /** The acting creature's Health as a fraction. */
  health: number;
  /** The target's Health as a fraction. */
  targetHealth: number;
  allies: number;
}

/**
 * Builds an insight context from the battlefield.
 *
 * Kept here rather than at the wiring site so the AI's view of a fight lives with the AI. Takes the
 * two actors and the pre-computed ratios the caller already has, and reads the rest off the map.
 */
export function insightContext(
  state: IStateLike,
  enemy: ActorLike,
  target: ActorLike,
  inputs: InsightInputs
): InsightContext {
  const here = enemy.pos ? GridServiceLike.tile(state, enemy.pos.x, enemy.pos.y) : undefined;
  return {
    tier: inputs.tier,
    distance: inputs.distance,
    health: inputs.health,
    targetHealth: inputs.targetHealth,
    allies: inputs.allies,
    targetWard: Number(target.quenBlocks) || 0,
    targetShield: Number(target.activeShield?.hp) || 0,
    targetStamina: Number(target.sta) / Math.max(1, Number(target.maxSta) || 1),
    targetOpen: Boolean(target.statuses?.prone || target.statuses?.stunned || target.statuses?.grappled),
    standingIn: enemy.pos
      ? (state.map?.zones ?? [])
          .filter(zone => GridServiceLike.distance({ x: zone.x, y: zone.y }, enemy.pos!) <= Number(zone.radius))
          .map(zone => String(zone.type))
      : [],
    elevation: Number(here?.elevation) || 0,
    hasLineOfSight: Boolean(enemy.pos && target.pos && GridServiceLike.los(state, enemy.pos, target.pos).clear)
  };
}

/** How dangerous a zone is, declared by the zone rather than inferred from its id. */
export interface ZoneThreat {
  /** Base risk score the AI subtracts from a destination. */
  risk?: number;
  /** Actors immune to this condition ignore the zone entirely. */
  negatedBy?: string;
  /** Only actors carrying one of these capabilities are at risk. Absent means everyone is. */
  threatens?: readonly string[];
  /** Only actors whose own susceptibility list names one of these. Merged with `threatens`. */
  susceptibleTo?: readonly string[];
}

/** One zone covering a tile, as the zone service reports it. */
export interface ZoneOccupancy {
  def?: { threat?: ZoneThreat };
  zone?: { type?: string };
}

/**
 * What an actor is capable of, and what it is susceptible to, read from its own data.
 *
 * This is the seam that lets zone risk stop naming creatures. Instead of asking "is this a Specter
 * or a Higher Vampire", the AI asks "does this thing use magic" and "does its own stat block list
 * Yrden as a weakness" — both of which the bestiary already records.
 */
export interface ActorCapabilities {
  /** Capability markers, e.g. `magic`, `incorporeal`. */
  capabilities: ReadonlySet<string>;
  /** Susceptibilities as the bestiary spells them, e.g. `Yrden`, `Dimeritium`. */
  susceptibilities: ReadonlySet<string>;
  /** Condition ids the actor is immune to. */
  immunities: ReadonlySet<string>;
}

/**
 * Derives an actor's capabilities from its data.
 *
 * `hasAbilityTag` is injected so this module never imports the ability system; the caller wires it
 * to whatever provides passives.
 */
export function actorCapabilities(
  actor: IActor,
  hasAbilityTag: (actor: IActor, tag: string) => boolean
): ActorCapabilities {
  const capabilities = new Set<string>();

  // Anything that can draw on Chaos: a declared caster, a creature with the skill, or one whose
  // abilities work through Spell Casting.
  if (actor.mage || Number(actor.skills?.['Spell Casting']) > 0 || hasAbilityTag(actor, 'usesMagic')) {
    capabilities.add('magic');
  }
  if (actor.statuses?.incorporeal || hasAbilityTag(actor, 'incorporeal')) capabilities.add('incorporeal');

  // A creature's susceptibilities land in `vulnerabilities` or `abilities` depending on which
  // data table the row came from, so both are read.
  const susceptibilities = new Set<string>([
    ...(actor.vulnerabilities ?? []).map(String),
    ...(actor.abilities ?? []).map(String)
  ]);

  return {
    capabilities,
    susceptibilities,
    immunities: new Set((actor.immunities ?? []).map(String))
  };
}

/**
 * How much an actor should fear standing on a tile.
 *
 * Reads the threat each covering zone declares against what the actor's own data says it is. No
 * zone id and no creature name appears here, which is the point: a new hazard is a registry row,
 * and a creature fears it because of what its stat block records rather than because the engine
 * recognises its species.
 */
export function zoneRisk(occupancy: readonly ZoneOccupancy[], capabilities: ActorCapabilities): number {
  let risk = 0;
  for (const entry of occupancy) {
    const threat = entry.def?.threat;
    if (!threat?.risk) continue;
    if (threat.negatedBy && capabilities.immunities.has(threat.negatedBy)) continue;

    const gated = Boolean(threat.threatens?.length || threat.susceptibleTo?.length);
    if (gated) {
      const capable = (threat.threatens ?? []).some(tag => capabilities.capabilities.has(tag));
      const susceptible = (threat.susceptibleTo ?? []).some(name => capabilities.susceptibilities.has(name));
      if (!capable && !susceptible) continue;
    }
    risk += threat.risk;
  }
  return risk;
}
