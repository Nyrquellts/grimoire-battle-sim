import type { RegistryHub } from '../RegistryHub';

/**
 * Monster abilities.
 *
 * Before this table every creature was a stat block that walked forward and bit: a wraith fought
 * like a bandit with claws, a griffin never used the air, a noonwraith could be cut down with a
 * steel sword. The abilities that make each monster *that monster* lived in flavour text, not in
 * the rules.
 *
 * Each row is data. `kind` selects a generic resolver in `CreatureAbilities.ts`; `requires` gates
 * when the AI may reach for it; `utility` is how badly it wants to. Nothing here is code, and the
 * engine never names a creature.
 *
 * Where an ability is a paragraph of description rather than a formula, the numbers come from
 * the description: Charge is -4 for 10d6 with an 8 m knockback, Sonic Screech is a Stun save at -1
 * within 10 m. Abilities that describe an effect without giving numbers (Charm and Glamour) are
 * marked `adapted`.
 *
 * ## Mapping and characterisation
 *
 * The **mapping** below says which creature has which ability. Creatures with a published
 * abilities block get exactly that. For the rest, passives are *derived* from the creature's own
 * stat block by `derivedAbilities`, and the remainder are mapped by family with the stat block as
 * the justification — a fire elemental gets `crushingForce` because its Punch says Crushing Force,
 * and `fueledByRage` because a summoned construct has nothing to frighten. That is
 * characterisation, not lookup, and it is worth knowing which is which.
 */

type AbilityKind =
  | 'chargeAttack' | 'areaStun' | 'blind' | 'negateAttack' | 'commandAllies'
  | 'takeFlight' | 'illusions' | 'thrownObject' | 'passive';

interface AbilityRow {
  [field: string]: unknown;
  name: string;
  description: string;
  /** Which generic resolver runs it. `passive` abilities are never chosen as actions. */
  kind: AbilityKind;
  /** Gates the AI checks before offering it. */
  requires?: {
    minDistance?: number;
    maxDistance?: number;
    needsLos?: boolean;
    /** Rounds between uses. */
    cooldown?: number;
    staCost?: number;
    /** Only when the user's Health has fallen below this fraction. */
    healthBelow?: number;
    /** Only when at least this many allies are on the field. */
    alliesAtLeast?: number;
  };
  /** Base utility score, before the profile weights in `AI.score`. */
  utility?: number;
  /** Parameters the resolver reads. */
  params?: Record<string, unknown>;
  /**
   * Markers other rules read.
   *
   * Some drive behaviour — `poisonImmune`, `mindImmune`, `regenerate`, `incorporeal`,
   * `nightVision`, `amphibious`, `waterNative`, `unintimidatable`, `unparryable` — and each has a
   * consumer, which `tests/integration/creatureAbilities.test.ts` enforces.
   *
   * Others are deliberately descriptive: `feral`, `pounce`, `scentTracking` and `longReach`
   * describe a creature without changing a roll, because a tactical simulator with full
   * information has no surface for tracking by scent or leaping without a run-up. They are kept
   * because they describe the creature, and because a future rule may want them.
   */
  tags?: string[];
  ruleStatus: 'standard' | 'adapted';
}

const ABILITIES: Array<[string, AbilityRow]> = [
  // ---- active: things a monster spends its turn doing ----------------------------------------
  ['charge', {
    name: 'Charge',
    description: 'When a target opens the distance, close it violently: a -4 claw attack for 10d6 that throws them back 8 m.',
    kind: 'chargeAttack',
    requires: { minDistance: 10, needsLos: true, cooldown: 2 },
    utility: 108,
    params: { attackPenalty: -4, damage: '10d6', knockback: 8, name: 'Charge' },
    tags: ['attack', 'movement'],
    ruleStatus: 'standard'
  }],

  ['sonicScreech', {
    name: 'Sonic Screech',
    description: 'A piercing screech: everyone within 10 m must pass a Stun save at -1.',
    kind: 'areaStun',
    requires: { maxDistance: 10, cooldown: 2 },
    utility: 96,
    params: { radius: 10, savePenalty: -1 },
    tags: ['control', 'area'],
    ruleStatus: 'standard'
  }],

  ['dustDevil', {
    name: 'Dust Devil',
    description: 'Swirls dust into a target\'s face. Spell Casting against them; on a hit they are blinded for 1d6 rounds.',
    kind: 'blind',
    requires: { maxDistance: 5, needsLos: true, cooldown: 2 },
    utility: 94,
    params: { duration: '1d6' },
    tags: ['control', 'usesMagic'],
    ruleStatus: 'standard'
  }],

  ['shift', {
    name: 'Shift',
    description: 'Spell Casting to go incorporeal and negate an attack. Nothing physical touches it until its next turn.',
    kind: 'negateAttack',
    requires: { maxDistance: 4, cooldown: 2 },
    utility: 92,
    params: { status: 'incorporeal', duration: 1 },
    tags: ['defense', 'usesMagic', 'incorporeal'],
    ruleStatus: 'standard'
  }],

  ['commandUndead', {
    name: 'Command the Undead',
    description: 'Instead of attacking, gives an order to every necrophage within 20 m.',
    kind: 'commandAllies',
    requires: { alliesAtLeast: 1, cooldown: 2 },
    utility: 86,
    params: { radius: 20, family: 'Necrophage', bonus: 3, duration: 2 },
    tags: ['support', 'coordination'],
    ruleStatus: 'standard'
  }],

  ['throwRock', {
    name: 'Hurled Stone',
    description: 'Picks up whatever the ground offers and throws it, rather than closing empty-handed.',
    kind: 'thrownObject',
    requires: { minDistance: 3, maxDistance: 12 },
    utility: 66,
    params: { damage: '2d6', attackPenalty: -2, range: 12 },
    tags: ['ranged', 'harass', 'attack'],
    actionName: 'throwRock',
    expectedDamage: 7,
    ruleStatus: 'standard'
  }],
  ['takeFlight', {
    name: 'Flight',
    description: 'Takes to the air as a movement, crossing ground that would stop anything walking.',
    kind: 'takeFlight',
    requires: { minDistance: 3 },
    utility: 76,
    params: { range: 14 },
    tags: ['movement', 'flight'],
    ruleStatus: 'standard'
  }],

  ['highNoonDance', {
    name: 'High Noon Dance',
    description: 'Three copies circle the target at range, draining 3 Health a round to heal their maker. Cutting a copy kills it.',
    kind: 'illusions',
    requires: { maxDistance: 12, cooldown: 6 },
    utility: 98,
    params: { copies: 3, drain: 3, minRange: 5 },
    tags: ['control', 'heal', 'usesMagic'],
    ruleStatus: 'standard'
  }],

  // ---- passive: always on ---------------------------------------------------------------------
  ['incorporeal', {
    name: 'Incorporeal',
    description: 'Always incorporeal: blades, bleeding and poison pass straight through until it is forced to materialise.',
    kind: 'passive',
    tags: ['incorporeal', 'physicalImmune', 'bleedImmune', 'poisonImmune'],
    ruleStatus: 'standard'
  }],
  ['regeneration', {
    name: 'Regeneration',
    description: 'Recovers 5 points of damage every round.',
    kind: 'passive',
    params: { perRound: 5 },
    tags: ['regenerate'],
    ruleStatus: 'standard'
  }],
  ['amphibious', {
    name: 'Amphibious',
    description: 'Lives underwater indefinitely and takes no penalty for acting in it.',
    kind: 'passive',
    tags: ['amphibious', 'waterNative'],
    ruleStatus: 'standard'
  }],
  ['impenetrablyDim', {
    name: 'Impenetrably Dim',
    description: 'Too unintelligent to be reached by magic that works on thought or emotion.',
    kind: 'passive',
    tags: ['mindImmune'],
    ruleStatus: 'standard'
  }],
  ['poisonImmunity', {
    name: 'Poison Immunity',
    description: 'Immune to the poison effect.',
    kind: 'passive',
    tags: ['poisonImmune'],
    ruleStatus: 'standard'
  }],
  ['nightVision', {
    name: 'Night Vision',
    description: 'Operates in dim light with no penalty.',
    kind: 'passive',
    tags: ['nightVision'],
    ruleStatus: 'standard'
  }],
  ['fueledByRage', {
    name: 'Fueled By Rage',
    description: 'Blinded by rage: deaf to persuasion and unmoved by threats.',
    kind: 'passive',
    tags: ['unintimidatable', 'fearImmune'],
    ruleStatus: 'standard'
  }],
  ['scentTracking', {
    name: 'Scent Tracking',
    description: 'Tracks by scent, with no penalty for losing sight of its quarry.',
    kind: 'passive',
    tags: ['scentTracking'],
    ruleStatus: 'standard'
  }],
  ['crushingForce', {
    name: 'Crushing Force',
    description: 'Punches too hard to parry, and ruins armour and shields at double rate.',
    kind: 'passive',
    tags: ['unparryable'],
    ruleStatus: 'standard'
  }],
  ['packLeader', {
    name: 'Leader',
    description: 'While it lives, its pack fights at +4 Courage and moves on its orders.',
    kind: 'passive',
    params: { courage: 4, radius: 20 },
    tags: ['leader'],
    ruleStatus: 'standard'
  }],
  ['feral', {
    name: 'Feral',
    description: 'Instinct stands in for intelligence when sensing or surviving.',
    kind: 'passive',
    tags: ['feral'],
    ruleStatus: 'standard'
  }],
  ['charm', {
    name: 'Charm',
    description: "Bends a target's intent with a look. Spell Casting against Resist Magic; on a hit they lose their turn.",
    kind: 'blind',
    requires: { maxDistance: 8, needsLos: true, cooldown: 3 },
    utility: 90,
    params: { duration: '1d6', name: 'Charm' },
    tags: ['control', 'usesMagic'],
    ruleStatus: 'adapted'
  }],
  ['glamour', {
    name: 'Glamour',
    description: 'Slips out of sight behind an illusion and is somewhere else when it fades.',
    kind: 'negateAttack',
    requires: { maxDistance: 6, cooldown: 3 },
    utility: 84,
    params: { status: 'incorporeal', duration: 1 },
    tags: ['defense', 'usesMagic', 'incorporeal'],
    ruleStatus: 'adapted'
  }],
  ['burrow', {
    name: 'Burrow',
    description: 'Goes under the ground and comes up somewhere the target was not watching.',
    kind: 'passive',
    tags: ['burrower'],
    ruleStatus: 'standard'
  }],
  ['longLived', {
    name: 'Long-Lived',
    description: 'Old enough that age is a measure of cunning rather than decline.',
    kind: 'passive',
    tags: ['agesIntoPower'],
    ruleStatus: 'standard'
  }],
  ['bleedImmunity', {
    name: 'Bleed Immunity',
    description: 'Does not bleed: there is nothing in it to lose.',
    kind: 'passive',
    tags: ['bleedImmune'],
    ruleStatus: 'standard'
  }],
  ['longReach', {
    name: 'Long Reach',
    description: 'Strikes from further away than its body suggests.',
    kind: 'passive',
    params: { reach: 4 },
    tags: ['longReach'],
    ruleStatus: 'standard'
  }],
  ['pounce', {
    name: 'Pounce',
    description: 'Leaps without needing a running start.',
    kind: 'passive',
    tags: ['pounce'],
    ruleStatus: 'standard'
  }]
];

/**
 * Which creatures have which abilities.
 *
 * Keyed by bestiary id. This is the one place a monster is connected to its behaviour, and it is a
 * lookup table rather than a branch: `src/services/CreatureAbilities.ts` reads it and never names a
 * creature itself.
 */
const CREATURE_ABILITIES: Record<string, string[]> = {
  drowner: ['amphibious', 'impenetrablyDim', 'poisonImmunity', 'feral', 'nightVision'],
  rotfiend: ['poisonImmunity', 'feral', 'nightVision'],
  ghoul: ['pounce', 'nightVision', 'feral', 'poisonImmunity'],
  gravehag: ['commandUndead', 'nightVision', 'feral', 'poisonImmunity'],
  foglet: ['nightVision', 'feral', 'shift'],
  bullvore: ['charge', 'feral'],

  wraith: ['shift', 'fueledByRage', 'nightVision'],
  noonwraith: ['incorporeal', 'highNoonDance', 'dustDevil', 'fueledByRage'],
  barghest: ['nightVision', 'feral', 'scentTracking'],
  hym: ['incorporeal', 'nightVision'],
  penitent: ['incorporeal', 'fueledByRage'],
  pesta: ['incorporeal', 'poisonImmunity'],

  werewolf: ['regeneration', 'scentTracking', 'nightVision', 'feral'],
  vendigo: ['regeneration', 'feral', 'nightVision'],

  griffin: ['charge', 'takeFlight', 'feral'],
  siren: ['takeFlight', 'sonicScreech', 'amphibious'],
  harpy: ['takeFlight', 'feral'],
  cockatrice: ['takeFlight', 'feral'],
  wyvern: ['takeFlight', 'charge', 'feral'],
  slyzard: ['takeFlight', 'feral'],
  phoenix: ['takeFlight', 'regeneration'],

  golem: ['crushingForce', 'fueledByRage'],
  livingarmor: ['crushingForce', 'fueledByRage'],
  rocktroll: ['crushingForce', 'feral', 'throwRock'],
  shaelmaar: ['charge', 'crushingForce', 'feral'],
  fiend: ['charge', 'feral', 'nightVision'],
  chort: ['charge', 'feral'],

  nekker: ['feral', 'nightVision', 'pounce', 'throwRock'],
  wolf: ['scentTracking', 'feral', 'nightVision', 'packLeader'],
  bear: ['charge', 'feral', 'scentTracking'],
  boar: ['charge', 'feral'],
  panther: ['pounce', 'scentTracking', 'nightVision', 'feral'],
  dog: ['scentTracking', 'feral'],
  horse: ['feral', 'scentTracking'],
  warhorse: ['feral', 'scentTracking'],

  katakan: ['regeneration', 'nightVision', 'shift'],
  bruxa: ['regeneration', 'nightVision', 'sonicScreech'],
  garkain: ['regeneration', 'nightVision'],
  plumard: ['regeneration', 'takeFlight', 'nightVision'],
  highervampire: ['regeneration', 'nightVision', 'shift'],

  arachas: ['feral', 'nightVision', 'poisonImmunity'],
  endrega: ['feral', 'poisonImmunity'],
  giantcentipede: ['feral', 'poisonImmunity'],

  leshen: ['commandUndead', 'nightVision', 'feral'],
  truedragon: ['takeFlight', 'charge', 'longLived'],

  // ---- humans and sapients -------------------------------------------------------------------
  // A mage has no monster abilities: its threat is the spell list the encounter system
  // gives it, and its cognition tier is what makes it dangerous. An empty list here is a
  // statement, not an omission.
  mage: [],
  scoiatael: ['nightVision'],
  succubus: ['nightVision', 'charm'],
  godling: ['nightVision', 'glamour'],

  // ---- constructs and elementals -------------------------------------------------------------
  // Summoned and mindless: nothing to frighten, nothing to poison, and a punch that cannot be
  // parried. All three are properties of their stat blocks.
  earthelemental: ['crushingForce', 'fueledByRage', 'poisonImmunity'],
  fireelemental: ['crushingForce', 'fueledByRage', 'poisonImmunity'],
  iceelemental: ['crushingForce', 'fueledByRage', 'poisonImmunity'],
  corpseamalgam: ['fueledByRage', 'poisonImmunity', 'nightVision'],

  // ---- ogroids and big hitters ---------------------------------------------------------------
  cyclops: ['crushingForce', 'charge', 'feral', 'throwRock'],
  troll: ['crushingForce', 'feral', 'throwRock'],
  greatbear: ['charge', 'feral', 'scentTracking'],
  manticore: ['takeFlight', 'charge', 'feral'],
  frightener: ['charge', 'feral', 'nightVision'],
  barbegazi: ['feral', 'nightVision', 'pounce'],

  // ---- plants, cursed things, and demons -----------------------------------------------------
  archespore: ['longReach', 'poisonImmunity', 'feral'],
  botchling: ['nightVision', 'feral', 'fueledByRage'],
  bes: ['nightVision', 'feral', 'charge'],
  casglydd: ['nightVision', 'feral'],
  marilwyd: ['nightVision', 'fueledByRage', 'charge']
};

/**
 * Abilities a *variant* brings, on top of what its species has.
 *
 * A brown dragon burrows and the others do not, so the capability belongs to the variant rather
 * than to dragons in general. Keeping it in a table here is what lets the AI ask "can this thing
 * burrow" instead of "is this a brown dragon".
 */
const VARIANT_ABILITIES: Record<string, string[]> = {
  brown: ['burrow']
};

/** Ability ids granted by a variant key, or an empty list. */
export function variantAbilitiesFor(variantKey: string): string[] {
  return VARIANT_ABILITIES[variantKey] ?? [];
}

/**
 * Ability ids derived from a creature's own stat block.
 *
 * Most creatures have no abilities block — the same information lives in the attack effect
 * column, the regeneration line, and the immunities list. Reading those back is better than
 * hand-listing abilities creature by creature: it cannot drift from the stat block, and a
 * creature added later gets its passives for free.
 *
 * Only unambiguous signals are used. Nothing here infers behaviour from a name.
 */
export function derivedAbilities(profile: {
  regen?: number;
  immunities?: readonly string[];
  attacks?: ReadonlyArray<{ effect?: string; range?: number }>;
} | undefined): string[] {
  if (!profile) return [];
  const found = new Set<string>();

  if (Number(profile.regen) > 0) found.add('regeneration');

  const immunities = (profile.immunities ?? []).map(entry => String(entry).toLowerCase());
  if (immunities.some(entry => entry.includes('poison'))) found.add('poisonImmunity');
  if (immunities.some(entry => entry.includes('bleed'))) found.add('bleedImmunity');

  for (const attack of profile.attacks ?? []) {
    const effect = String(attack.effect ?? '').toLowerCase();
    if (effect.includes('crushing force')) found.add('crushingForce');
    if (effect.includes('long reach')) found.add('longReach');
  }
  return [...found];
}

/** Ability ids for one bestiary row: the hand-mapped behaviours plus whatever its block implies. */
export function abilitiesFor(creatureId: string, profile?: Parameters<typeof derivedAbilities>[0]): string[] {
  return [...new Set([...(CREATURE_ABILITIES[creatureId] ?? []), ...derivedAbilities(profile)])];
}

/** Registers the ability table. */
export function registerCreatureAbilityContent(registry: RegistryHub): void {
  for (const [id, row] of ABILITIES) {
    if (!registry.creatureAbilities.has(id)) registry.add('creatureAbilities', id, row);
  }
}
