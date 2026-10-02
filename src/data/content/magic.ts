import type { RegistryHub } from '../RegistryHub';

/**
 * Magic content: elemental fumble outcomes, magical focuses, advanced Signs, and Sign augments.
 *
 * Nothing here is behavior. Each row declares *what exists*; `SpellCastingSystem` decides what a
 * cast costs and `resolveSign` applies the merged modifiers. Adding an augment is a data edit.
 *
 * Rule status follows `docs/CONTENT_POLICY.md`:
 * - `standard`  — the tabletop game's standard rules.
 * - `adapted`   — standard rules translated for a grid and a simulator.
 * - `house`     — a deliberate extension for this simulator, marked and justified.
 * - `original`  — invented for this project.
 *
 * The augments are house content. The standard rules give Signs alternate forms but no rule for
 * modifying a Sign mid-cast. These augments therefore stay inside the existing economy: every one
 * of them costs STA, so weaving them pushes the cast toward the caster's Vigor Threshold, and past
 * it the caster pays 5 HP per point. That cost — not a special case — is what keeps mixing "within
 * reason". See `docs/DECISIONS.md` D17.
 */

/** Elemental fumble effects. Keys match a castable's `element`. */
const ELEMENTAL_FUMBLES = [
  ['Mixed', {
    name: 'Sparking backlash',
    description: 'Magic sparks out of the caster\'s body; an effect drawn from another element follows.',
    condition: 'staggered',
    duration: 1
  }],
  ['Earth', {
    name: 'Rocking earth',
    description: 'The earth around the caster rocks and the shock passes up through them.',
    condition: 'stunned',
    duration: 1
  }],
  ['Air', {
    name: 'Rushing air',
    description: 'The air slams outward and throws the caster backwards.',
    knockback: 2,
    condition: 'staggered',
    duration: 1
  }],
  ['Fire', {
    name: 'Ignition',
    description: 'The caster\'s own body bursts into flame.',
    condition: 'burning'
  }],
  ['Water', {
    name: 'Killing frost',
    description: 'Frost crackles and hardens around the caster\'s body.',
    condition: 'frozen',
    duration: 2
  }]
] as const;

/**
 * Magical focuses.
 *
 * A focus subtracts its value from a spell's STA cost, can never take that cost below 1, must be
 * in the caster's hand, and only one may be used at a time. Greater Focus additionally makes the
 * cast count as 2 points harder to resist.
 */
const FOCUS_ITEMS = [
  ['oakStaff', { name: 'Oak staff', value: 1, greater: false, hands: 2, description: 'A plain hedge-witch\'s staff; steadies a small draw of chaos.' }],
  ['elvenWalkingStaff', { name: 'Elven walking staff', value: 2, greater: false, hands: 2, description: 'Slender elven work, carved along the grain of the wood.' }],
  ['gnomishStaff', { name: 'Gnomish staff', value: 3, greater: false, hands: 2, description: 'Dense, metal-shod, and heavier than it looks.' }],
  ['crystalStaff', { name: 'Crystal staff', value: 3, greater: true, hands: 2, description: 'A crystal-headed staff; magic drawn through it lands far harder.' }],
  ['silverAmulet', { name: 'Silver focus amulet', value: 1, greater: false, hands: 1, description: 'A worked silver amulet, gripped in the casting hand.' }]
] as const;

/**
 * Advanced Signs.
 *
 * Somne is combat-relevant: it puts a target to sleep, which the simulator resolves as the Stunned
 * condition. How readily the target wakes scales with the STA invested — the tiers below are the
 * thresholds.
 */
const ADVANCED_SIGNS = [
  ['somne', {
    name: 'Somne',
    family: 'Somne',
    element: 'Water',
    alternate: false,
    cost: 'Variable',
    maxCost: 7,
    range: 8,
    shape: 'target',
    duration: '8 hours',
    defense: ['Resist Magic'],
    description: 'Lulls a single target into sleep; the more STA invested, the harder they are to rouse.',
    ruleStatus: 'standard'
  }],
  ['supirre', {
    name: 'Supirre',
    family: 'Supirre',
    element: 'Air',
    alternate: false,
    cost: 'Variable',
    maxCost: 7,
    range: 2,
    shape: 'self',
    duration: '10 minutes',
    defense: [],
    description: 'Links a drawn sigil to a distant point and carries its sound back to the caster. Reconnaissance, not combat.',
    ruleStatus: 'standard'
  }]
] as const;

/**
 * Sign augments — the house "weaving" layer.
 *
 * Design constraints, all deliberate:
 * - every augment costs STA, so mixing competes with raw investment for the same budget;
 * - `exclusiveGroup` stops three variants of one idea stacking;
 * - the cross-family augments require a *battlefield* precondition (a zone, a condition), so they
 *   reward setup rather than being free damage;
 * - none of them grants an ability the rules deny a witcher: no new Sign, no spell, no ritual.
 */
const SIGN_AUGMENTS = [
  // ---- shaping: how the effect is delivered -------------------------------------------------
  ['narrowedCone', {
    name: 'Narrowed cone',
    description: 'Collapse the spread into a single line. The force that would have spilled wide goes into one target.',
    staCost: 1,
    exclusiveGroup: 'shaping',
    appliesTo: { shapes: ['cone'] },
    requires: { minSkill: 10 },
    effects: { castBonus: 2, knockdownChance: 10, tags: ['narrowed'] },
    ruleStatus: 'house'
  }],
  ['widenedField', {
    name: 'Widened field',
    description: 'Let the sigil sprawl. The circle covers more ground but bites less deeply.',
    staCost: 1,
    exclusiveGroup: 'shaping',
    appliesTo: { shapes: ['radius'] },
    effects: { radiusDelta: 2, castBonus: -1, tags: ['widened'] },
    ruleStatus: 'house'
  }],
  ['extendedReach', {
    name: 'Extended reach',
    description: 'Push the working further out than it wants to go.',
    staCost: 1,
    exclusiveGroup: 'shaping',
    appliesTo: { shapes: ['target', 'cone', 'radius'] },
    requires: { minSkill: 12 },
    effects: { rangeDelta: 3, tags: ['extended'] },
    ruleStatus: 'house'
  }],

  // ---- intensity: how hard the effect lands -------------------------------------------------
  ['whiteFlame', {
    name: 'White flame',
    description: 'Draw the fire hotter and paler until it burns rather than scorches.',
    staCost: 2,
    exclusiveGroup: 'intensity',
    appliesTo: { elements: ['Fire'] },
    requires: { minSkill: 12 },
    effects: { bonusDamage: ['1d6'], ignitionChance: 25, tags: ['whiteFlame'] },
    ruleStatus: 'house'
  }],
  ['hammerBlow', {
    name: 'Hammer blow',
    description: 'Compress the telekinetic wave into a single shove instead of a push.',
    staCost: 2,
    exclusiveGroup: 'intensity',
    appliesTo: { elements: ['Air'] },
    requires: { minSkill: 12 },
    effects: { knockdownChance: 25, tags: ['hammerBlow'] },
    ruleStatus: 'house'
  }],
  ['deeperCompulsion', {
    name: 'Deeper compulsion',
    description: 'Sink the compulsion past the surface of the mind, where it is harder to shrug off.',
    staCost: 2,
    exclusiveGroup: 'intensity',
    appliesTo: { elements: ['Water'] },
    requires: { minSkill: 14 },
    effects: { castBonus: 3, durationDelta: 1, tags: ['deepAxii'] },
    ruleStatus: 'house'
  }],
  ['layeredWard', {
    name: 'Layered ward',
    description: 'Fold the shell over itself. Slower to raise, but it holds longer.',
    staCost: 2,
    exclusiveGroup: 'intensity',
    appliesTo: { elements: ['Earth'] },
    requires: { minSkill: 12 },
    effects: { durationDelta: 2, tags: ['layeredQuen'] },
    ruleStatus: 'house'
  }],
  ['piercingWeave', {
    name: 'Piercing weave',
    description: 'Thread the working through the gaps in armour instead of breaking against it.',
    staCost: 2,
    exclusiveGroup: 'intensity',
    appliesTo: { shapes: ['cone', 'target'] },
    requires: { minSkill: 14, focus: true },
    effects: { armorPiercing: true, tags: ['piercing'] },
    ruleStatus: 'house'
  }],

  // ---- mixing: cross-effect combinations that need a prepared battlefield --------------------
  ['glyphIgnition', {
    name: 'Glyph ignition',
    description: 'Fire poured onto a target standing in Yrden sets the violet glyphs alight beneath them.',
    staCost: 2,
    exclusiveGroup: 'mixing',
    appliesTo: { elements: ['Fire'] },
    requires: { targetZone: 'yrden', minSkill: 12 },
    effects: { bonusDamage: ['2d6'], ignitionChance: 25, tags: ['glyphIgnition'] },
    ruleStatus: 'house'
  }],
  ['groundedSurge', {
    name: 'Grounded surge',
    description: 'A target already slowed by Yrden cannot recover its footing against a telekinetic wave.',
    staCost: 1,
    exclusiveGroup: 'mixing',
    appliesTo: { elements: ['Air'] },
    requires: { targetZone: 'yrden' },
    effects: { knockdownChance: 40, tags: ['groundedSurge'] },
    ruleStatus: 'house'
  }],
  ['kindledDust', {
    name: 'Kindled dust',
    description: 'Dragon\'s Dream hanging in the air needs only a spark. The cloud does the rest.',
    staCost: 1,
    exclusiveGroup: 'mixing',
    appliesTo: { elements: ['Fire'] },
    requires: { targetZone: 'dreamCloud' },
    effects: { bonusDamage: ['3d6'], ignitionChance: 50, tags: ['kindledDust'] },
    ruleStatus: 'house'
  }],
  ['shatterFrost', {
    name: 'Shatter frost',
    description: 'A frozen body is brittle. Strike it with force rather than heat and it comes apart.',
    staCost: 2,
    exclusiveGroup: 'mixing',
    appliesTo: { elements: ['Air'] },
    requires: { targetCondition: 'frozen', minSkill: 12 },
    effects: { bonusDamage: ['2d6'], armorPiercing: true, tags: ['shatterFrost'] },
    ruleStatus: 'house'
  }],
  ['bleedingBurn', {
    name: 'Cauterising burn',
    description: 'Fire closes an open wound the hard way — and the target feels every second of it.',
    staCost: 1,
    exclusiveGroup: 'mixing',
    appliesTo: { elements: ['Fire'] },
    requires: { targetCondition: 'bleeding' },
    effects: { applies: [{ condition: 'stunned', duration: 1 }], tags: ['cauterise'] },
    ruleStatus: 'house'
  }]
] as const;

/**
 * Resolution metadata for the core Signs.
 *
 * The Sign resolver used to be an `if (sign.id === 'aard' || sign.id === 'aardSweep')` chain, which
 * meant every new Sign needed a branch in rules code. These rows move that knowledge into content:
 * a Sign declares *which resolver shape it is* and the numbers that resolver reads, so
 * `src/actions/signs.ts` dispatches on data alone.
 *
 * The values reproduce the standard Signs exactly; nothing here changes
 * a cost, chance, or duration.
 */
const SIGN_RESOLUTION: Record<string, Record<string, unknown>> = {
  // Aard: staggers, 10% knockdown per STA spent. The cone form hits its target; the alternate
  // Sweep form hits everything inside its radius.
  aard: { resolver: 'force', knockdownPerSta: 10, staggers: true },
  aardSweep: { resolver: 'force', knockdownPerSta: 10, staggers: true, areaOfEffect: true },

  // Igni: 1d6 per STA spent, 50% ignition. Fire Stream raises that to 75% and is sustained.
  igni: { resolver: 'flame', damageDicePerSta: 1, damageDie: 6, ignitionChance: 50 },
  fireStream: { resolver: 'flame', damageDicePerSta: 1, damageDie: 6, ignitionChance: 75, sustained: 'fireStream' },

  // Quen: blocks one failed attack per STA spent. Active Shield is 10 HP per STA instead.
  quen: { resolver: 'ward', blocksPerSta: 1 },
  activeShield: { resolver: 'shield', healthPerSta: 10 },

  // Yrden: a 5-round circle. Magic Trap lasts one round per STA spent.
  yrden: { resolver: 'zone', zoneType: 'yrden', zoneDuration: 5 },
  magicTrap: { resolver: 'zone', zoneType: 'magicTrap', zoneDurationPerSta: 1 },

  // Axii: stun until a Stun save, which worsens by 1 for every 2 extra STA. Puppet takes control.
  axii: { resolver: 'dominate', control: 'stun', stunRoundsPerTwoSta: true },
  puppet: { resolver: 'dominate', control: 'puppet' },

  // Somne: sleep, resolved as a deep stun.
  somne: { resolver: 'dominate', control: 'sleep' },
  supirre: { resolver: 'utility' }
};

/** Resolution metadata for one Sign id, merged into the registered row. */
export function signResolution(id: string): Record<string, unknown> {
  return SIGN_RESOLUTION[id] ?? {};
}

/**
 * Registers every magic content row on the supplied hub.
 *
 * Called once from `witcherContent.ts` so the registry keeps a single composition root.
 */
export function registerMagicContent(registry: RegistryHub): void {
  for (const [id, row] of ELEMENTAL_FUMBLES) {
    registry.add('magicFumbles', id, { ...row, ruleStatus: 'standard' });
  }
  for (const [id, row] of FOCUS_ITEMS) {
    registry.add('focusItems', id, { ...row, ruleStatus: 'standard' });
  }
  for (const [id, row] of ADVANCED_SIGNS) {
    if (!registry.signs.has(id)) registry.add('signs', id, { ...row, ...signResolution(id) });
  }
  for (const [id, row] of SIGN_AUGMENTS) {
    registry.add('signAugments', id, { ...row });
  }
}
