import type { RegistryEntry } from '../entities/types';

/**
 * Character builder: the creation rules as pure functions over a catalogue.
 *
 * A `HeroDraft` is what the player chose — a handful of small numbers and ids. `buildHero` turns it
 * into a `HeroSheet` (every derived value) plus a list of issues, and never mutates its input.
 * Nothing here reads a registry, rolls the simulation's dice, or touches the DOM: content arrives
 * as a `Catalogue`, randomness arrives as a `Roll` function, and the rules can be tested without
 * either. Turning a sheet into a playable actor is `PlayerCharacter.ts`.
 *
 * The rules, in the order a player meets them:
 *
 * 1. **Heritage and profession** pick a race (stat tweaks, bonus skills, natural armour) and a
 *    profession (a skill package, a defining skill, starting kit and coin).
 * 2. **Statistics** are bought from a pool (60 / 70 / 75 / 80 points across nine stats, none above
 *    10) or rolled (1d10 each, re-rolling 1 and 2). Derived values follow from BODY and WILL.
 * 3. **Skills** split into the profession package (44 points, at least one level in each skill) and
 *    pick-up skills (INT + REF points, never on a package skill). Nothing starts above level 6 and
 *    a few skills cost two points per level; racial bonuses and a free home language sit on top.
 * 4. **Coin** is the profession's crowns times 2d6, spent on weapons and armour after the free kit.
 *
 * Two things here are house options rather than tabletop rules, and say so wherever they appear:
 * the stat cap of 10 at creation is inferred from the racial perk that lets REF and DEX pass it,
 * and the field kit of starting consumables is an addition for solo play.
 */

export const STAT_IDS = ['INT', 'REF', 'DEX', 'BODY', 'SPD', 'EMP', 'CRA', 'WILL', 'LUCK'] as const;
export type StatId = (typeof STAT_IDS)[number];
export type Stats = Record<StatId, number>;

export const STAT_TIERS = { average: 60, skilled: 70, heroes: 75, legends: 80 } as const;
export type StatTier = keyof typeof STAT_TIERS;

export const ARMOR_SLOTS = ['head', 'torso', 'legs'] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

export const GENDERS = ['Male', 'Female', 'Nonbinary'] as const;
export type Gender = (typeof GENDERS)[number];

/** Temperaments the hero can have; each is a registered personality profile. */
export const TEMPERAMENTS = ['stoic', 'disciplined', 'cautious', 'aggressive', 'nervous'] as const;

export const STAT_MIN = 1;
export const STAT_MAX = 10;
/** The lowest a rolled stat can land: 1d10 with 1 and 2 re-rolled. */
export const ROLLED_STAT_MIN = 3;
export const SKILL_CAP = 6;
export const PACKAGE_POINTS = 44;
export const HOME_LANGUAGE_LEVEL = 8;
/** Field kit: starting consumables for solo play. A house option, not a tabletop rule. */
export const FIELD_KIT_BASE = 6;
export const FIELD_KIT_ITEM_MAX = 3;
/** Rounds that come with any ranged weapon the hero owns. */
export const STARTING_AMMO = 20;
export const NAME_MAX = 40;
export const AGE_MIN = 14;
export const AGE_MAX = 500;

/** A random-number source: returns an integer from 1 to `sides`. Injected so tests are exact. */
export type Roll = (sides: number) => number;

export interface Perk {
  text: string;
  /** Whether the combat simulation applies it. Narrative perks are listed honestly as such. */
  simulated: boolean;
}

export interface SkillRow {
  id: string;
  name: string;
  stat: StatId;
  /** Costs two points per level instead of one. */
  hard?: boolean;
  /** A profession's defining skill: only that profession can hold it. */
  profession?: string;
  /** Pick-slot group this skill belongs to (`languages`, `combat`). */
  group?: string;
}

export interface RaceRow {
  id: string;
  name: string;
  /**
   * The `family` the actor carries. It selects the hit-location model, loot and body parts, so every
   * playable people uses the humanoid `Human` family; the people itself travels as `name`.
   */
  family: string;
  summary: string;
  homeLanguage: string;
  statMods: Partial<Record<StatId, number>>;
  skillBonus: Record<string, number>;
  /** Stopping power the body has on its own; armour ablation never wears it down. */
  naturalSp: number;
  encBonus: number;
  /** Whether the body can take mutagens, which decoctions require. */
  mutagens: boolean;
  defaultAge: number;
  perks: Perk[];
  names: { male: string[]; female: string[]; family: string[] };
}

export interface KitItem {
  label: string;
  weapon?: string;
  armor?: string;
}

export interface PickSlot {
  id: string;
  label: string;
  /** Skill group the choices come from. */
  from: string;
  count: number;
  /** What the quick build chooses. */
  defaults: string[];
}

export interface ProfessionRow {
  id: string;
  name: string;
  summary: string;
  /** Chaos a character can channel without hurting themselves. */
  vigor: number;
  /** Crowns per point of 2d6 on the Starting Coin table. */
  coin: number;
  defining: { name: string; effect: string };
  /** Package skills that are always trained. */
  fixed: string[];
  picks: PickSlot[];
  /** Package skills the quick build raises first. */
  focus: string[];
  /** Pick-up skills the quick build prefers, in order. */
  pickups: string[];
  /** Stat priority for the quick build, highest first. */
  statOrder: StatId[];
  kit: { pick: number; items: KitItem[]; special: KitItem[]; quick: string[] };
  /** Whether the profession knows the basic Signs. */
  signs: boolean;
  magic: string;
  /** Whether the combat simulation can play the profession's magic. */
  simulatedMagic: boolean;
}

export interface ArmorRow {
  id: string;
  name: string;
  slot: ArmorSlot;
  tier: 'light' | 'medium' | 'heavy';
  sp: number;
  /** Encumbrance value. Listed on the sheet; the simulation does not apply it. */
  ev: number;
  cost: number;
}

export interface WeaponRow {
  id: string;
  name: string;
  combatSkill?: string;
  /** Shop price in crowns. Weapons without one cannot be bought. */
  cost?: number;
  damage: string;
  type?: string;
  hands?: number;
  range: number | 'melee';
  effects?: readonly string[];
}

export interface AlchemyRow {
  id: string;
  name: string;
  kind: 'potion' | 'decoction' | 'bomb' | 'oil';
}

export interface Catalogue {
  skills: SkillRow[];
  races: RaceRow[];
  professions: ProfessionRow[];
  armor: ArmorRow[];
  weapons: Map<string, WeaponRow>;
  alchemy: AlchemyRow[];
}

export interface HeroAppearance {
  height: string;
  build: string;
  hair: string;
  eyes: string;
  skin: string;
  notable: string[];
}

/** Everything the player chose. Small, serialisable, and re-derived into a sheet on demand. */
export interface HeroDraft {
  name: string;
  gender: Gender;
  age: number;
  region: string;
  temperament: string;
  appearance: HeroAppearance;
  raceId: string;
  professionId: string;
  statMethod: 'pool' | 'roll';
  statTier: StatTier;
  /** Stats as assigned, before racial modifiers. */
  stats: Stats;
  /** Choices for each profession pick slot, by slot id. */
  picks: Record<string, string[]>;
  /** Purchased skill levels by skill name, for package and pick-up skills alike. */
  levels: Record<string, number>;
  /** Labels of the profession kit items taken from its pick list. */
  kit: string[];
  /** The 2d6 roll behind starting coin; 7 is the average. */
  coinRoll: number;
  /** Weapons bought with coin. */
  weapons: string[];
  /** Armour worn, one piece per slot. */
  armor: Partial<Record<ArmorSlot, string>>;
  /** Consumables carried, by alchemy id. */
  fieldKit: Record<string, number>;
}

export interface Issue {
  level: 'error' | 'warning' | 'note';
  field: string;
  message: string;
}

export interface SkillLine {
  name: string;
  stat: StatId;
  hard: boolean;
  role: 'defining' | 'package' | 'pickup';
  purchased: number;
  /** Racial bonus plus the free home language. */
  bonus: number;
  level: number;
  /** The whole check value the simulation rolls: the stat plus the level. */
  check: number;
}

export interface Derived {
  hp: number;
  sta: number;
  rec: number;
  stun: number;
  run: number;
  leap: number;
  enc: number;
  vigor: number;
  naturalSp: number;
}

export interface Budget {
  spent: number;
  budget: number;
}

export interface HeroSheet {
  name: string;
  gender: Gender;
  age: number;
  ageBand: string;
  region: string;
  temperament: string;
  appearance: HeroAppearance;
  race: { id: string; name: string; family: string };
  profession: { id: string; name: string };
  defining: { name: string; effect: string };
  /** Final stats, racial modifiers included. */
  stats: Stats;
  derived: Derived;
  skills: SkillLine[];
  perks: Perk[];
  magic: string;
  simulatedMagic: boolean;
  /** Signs the hero can cast. */
  knownSigns: string[];
  /** Weapons carried, free kit first, then purchases. */
  weapons: WeaponRow[];
  armor: Record<ArmorSlot, ArmorRow | null>;
  armorByLocation: Record<string, number>;
  /** Kit that has no effect in the simulation, kept for the sheet. */
  gear: string[];
  ammo: number;
  coin: { total: number; spent: number; left: number };
  fieldKit: Array<{ id: string; name: string; kind: AlchemyRow['kind']; count: number }>;
  points: { stats: Budget; package: Budget; pickup: Budget; fieldKit: Budget };
}

export interface BuildResult {
  draft: HeroDraft;
  sheet: HeroSheet;
  issues: Issue[];
  /** True when no issue is an error: the hero can be played. */
  ok: boolean;
}

/** The five basic Signs a witcher knows. */
export const BASIC_SIGNS: readonly string[] = ['aard', 'igni', 'yrden', 'quen', 'axii'];

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

function whole(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

/** Free text: control characters and angle brackets removed, whitespace collapsed, length capped. */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** How a skill's cost per level compares with an ordinary skill. */
export function skillCost(skill: Pick<SkillRow, 'hard'> | undefined): number {
  return skill?.hard ? 2 : 1;
}

/** "Dwarf Craftsman", or just "Witcher" when the people and the calling share a name. */
export function callingLabel(sheet: { race: { name: string }; profession: { name: string } }): string {
  return sheet.race.name === sheet.profession.name ? sheet.race.name : `${sheet.race.name} ${sheet.profession.name}`;
}

export function ageBandFor(age: number): string {
  if (age < 25) return 'Young adult';
  if (age < 45) return 'Adult';
  if (age < 70) return 'Older adult';
  return 'Long-lived adult';
}

// --- catalogue ---------------------------------------------------------------------------------

/** The registry tables the catalogue is read from. */
export interface CatalogueSource {
  creationSkills: Map<string, RegistryEntry>;
  races: Map<string, RegistryEntry>;
  professions: Map<string, RegistryEntry>;
  armorPieces: Map<string, RegistryEntry>;
  weapons: Map<string, RegistryEntry>;
  alchemy: Map<string, RegistryEntry>;
}

/** Snapshots the registry rows the builder needs into plain typed arrays. */
export function catalogueFrom(source: CatalogueSource): Catalogue {
  const weapons = new Map<string, WeaponRow>();
  for (const entry of source.weapons.values()) {
    weapons.set(entry.id, {
      id: entry.id,
      name: String(entry.name),
      combatSkill: entry.combatSkill,
      cost: Number.isFinite(Number(entry.cost)) ? Number(entry.cost) : undefined,
      damage: String(entry.damage),
      type: entry.type,
      hands: entry.hands,
      range: entry.range,
      effects: entry.effects
    });
  }
  return {
    skills: [...source.creationSkills.values()] as unknown as SkillRow[],
    races: [...source.races.values()] as unknown as RaceRow[],
    professions: [...source.professions.values()] as unknown as ProfessionRow[],
    armor: [...source.armorPieces.values()] as unknown as ArmorRow[],
    weapons,
    alchemy: [...source.alchemy.values()]
      .filter(entry => ['potion', 'decoction', 'bomb', 'oil'].includes(entry.kind))
      .map(entry => ({ id: entry.id, name: String(entry.name), kind: entry.kind as AlchemyRow['kind'] }))
  };
}

function raceOf(catalogue: Catalogue, id: string): RaceRow {
  const race = catalogue.races.find(row => row.id === id) ?? catalogue.races[0];
  if (!race) throw new Error('The catalogue has no races.');
  return race;
}

function professionOf(catalogue: Catalogue, id: string): ProfessionRow {
  const profession = catalogue.professions.find(row => row.id === id) ?? catalogue.professions[0];
  if (!profession) throw new Error('The catalogue has no professions.');
  return profession;
}

function skillNamed(catalogue: Catalogue, name: string): SkillRow | undefined {
  return catalogue.skills.find(row => row.name === name);
}

/** The weapons a hero can buy: priced, cheapest first. */
export function purchasableWeapons(catalogue: Catalogue): WeaponRow[] {
  return [...catalogue.weapons.values()]
    .filter(weapon => weapon.cost !== undefined && weapon.combatSkill)
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name));
}

/** Skills a pick slot may choose from: its group, minus anything the package already grants. */
export function pickChoices(catalogue: Catalogue, profession: ProfessionRow, slot: PickSlot): SkillRow[] {
  return catalogue.skills.filter(skill => skill.group === slot.from && !profession.fixed.includes(skill.name));
}

/** The names of every skill in the profession package: fixed, picked, and the defining skill. */
export function packageSkills(profession: ProfessionRow, picks: Record<string, string[]>): string[] {
  const chosen = profession.picks.flatMap(slot => picks[slot.id] ?? []);
  return [...profession.fixed, ...chosen, profession.defining.name];
}

// --- drafts ------------------------------------------------------------------------------------

/** Clamps and repairs a draft so every field is valid and refers to something in the catalogue. */
export function normalizeDraft(input: Partial<HeroDraft> | undefined, catalogue: Catalogue): HeroDraft {
  const source = input ?? {};
  const race = raceOf(catalogue, String(source.raceId ?? ''));
  const profession = professionOf(catalogue, String(source.professionId ?? ''));

  const stats = {} as Stats;
  for (const id of STAT_IDS) stats[id] = clamp(whole(source.stats?.[id], 6), STAT_MIN, STAT_MAX);

  const picks: Record<string, string[]> = {};
  for (const slot of profession.picks) {
    const allowed = new Set(pickChoices(catalogue, profession, slot).map(skill => skill.name));
    const wanted = Array.isArray(source.picks?.[slot.id]) ? (source.picks?.[slot.id] ?? []) : [];
    picks[slot.id] = [...new Set(wanted.map(String))].filter(name => allowed.has(name)).slice(0, slot.count);
  }

  const eligible = new Set(
    catalogue.skills.filter(skill => !skill.profession || skill.profession === profession.id).map(skill => skill.name)
  );
  const levels: Record<string, number> = {};
  for (const [name, value] of Object.entries(source.levels ?? {})) {
    const level = clamp(whole(value, 0), 0, SKILL_CAP);
    if (eligible.has(name) && level > 0) levels[name] = level;
  }

  const kitLabels = new Set(profession.kit.items.map(item => item.label));
  const kit = [...new Set((source.kit ?? []).map(String))].filter(label => kitLabels.has(label)).slice(0, profession.kit.pick);

  const buyable = new Set(purchasableWeapons(catalogue).map(weapon => weapon.id));
  const weapons = [...new Set((source.weapons ?? []).map(String))].filter(id => buyable.has(id));

  const armor: Partial<Record<ArmorSlot, string>> = {};
  for (const slot of ARMOR_SLOTS) {
    const id = source.armor?.[slot];
    if (id && catalogue.armor.some(piece => piece.id === id && piece.slot === slot)) armor[slot] = id;
  }

  const fieldKit: Record<string, number> = {};
  for (const item of catalogue.alchemy) {
    const count = clamp(whole(source.fieldKit?.[item.id], 0), 0, FIELD_KIT_ITEM_MAX);
    if (count > 0 && (item.kind !== 'decoction' || race.mutagens)) fieldKit[item.id] = count;
  }

  const appearance = source.appearance;
  const notable = Array.isArray(appearance?.notable) ? appearance.notable : [];
  return {
    name: cleanText(source.name, NAME_MAX),
    gender: (GENDERS as readonly string[]).includes(String(source.gender)) ? (source.gender as Gender) : 'Male',
    age: clamp(whole(source.age, race.defaultAge), AGE_MIN, AGE_MAX),
    region: cleanText(source.region, 40),
    temperament: (TEMPERAMENTS as readonly string[]).includes(String(source.temperament)) ? String(source.temperament) : 'disciplined',
    appearance: {
      height: cleanText(appearance?.height, 24),
      build: cleanText(appearance?.build, 60),
      hair: cleanText(appearance?.hair, 60),
      eyes: cleanText(appearance?.eyes, 40),
      skin: cleanText(appearance?.skin, 40),
      notable: notable.map(entry => cleanText(entry, 60)).filter(Boolean).slice(0, 4)
    },
    raceId: race.id,
    professionId: profession.id,
    statMethod: source.statMethod === 'roll' ? 'roll' : 'pool',
    statTier: source.statTier && source.statTier in STAT_TIERS ? source.statTier : 'average',
    stats,
    picks,
    levels,
    kit,
    coinRoll: clamp(whole(source.coinRoll, 7), 2, 12),
    weapons,
    armor,
    fieldKit
  };
}

/** Racial modifiers applied to assigned stats. EMP never drops below 1. */
export function finalStats(assigned: Stats, race: RaceRow): Stats {
  const stats = {} as Stats;
  for (const id of STAT_IDS) {
    const raw = assigned[id] + (race.statMods[id] ?? 0);
    stats[id] = Math.max(1, raw);
  }
  return stats;
}

export function deriveValues(stats: Stats, race: RaceRow, profession: ProfessionRow): Derived {
  const average = Math.floor((stats.BODY + stats.WILL) / 2);
  const run = stats.SPD * 3;
  return {
    hp: average * 5,
    sta: average * 5,
    rec: average,
    stun: average,
    run,
    leap: Math.floor(run / 5),
    enc: stats.BODY * 10 + race.encBonus,
    vigor: profession.vigor,
    naturalSp: race.naturalSp
  };
}

/** Rolls the nine stats: 1d10 each, re-rolling 1 and 2. */
export function rollStats(roll: Roll): Stats {
  const stats = {} as Stats;
  for (const id of STAT_IDS) {
    let value = roll(10);
    while (value < ROLLED_STAT_MIN) value = roll(10);
    stats[id] = clamp(value, ROLLED_STAT_MIN, STAT_MAX);
  }
  return stats;
}

/** Two six-sided dice. */
export function rollCoin(roll: Roll): number {
  return roll(6) + roll(6);
}

/** A random name for the race and gender. */
export function suggestName(catalogue: Catalogue, raceId: string, gender: Gender, roll: Roll): string {
  const race = raceOf(catalogue, raceId);
  const pools = gender === 'Female' ? [race.names.female] : gender === 'Male' ? [race.names.male] : [race.names.male, race.names.female];
  const given = pools.flat();
  const pick = (list: string[]): string => list[(roll(Math.max(1, list.length)) - 1) % Math.max(1, list.length)] ?? '';
  return `${pick(given)} ${pick(race.names.family)}`.trim();
}

// --- building ----------------------------------------------------------------------------------

interface Owned {
  free: WeaponRow[];
  bought: WeaponRow[];
  armorFree: Partial<Record<ArmorSlot, ArmorRow>>;
}

function ownedGear(draft: HeroDraft, profession: ProfessionRow, catalogue: Catalogue): Owned {
  const granted = [
    ...profession.kit.special,
    ...profession.kit.items.filter(item => draft.kit.includes(item.label))
  ];
  const free: WeaponRow[] = [];
  const armorFree: Partial<Record<ArmorSlot, ArmorRow>> = {};
  for (const item of granted) {
    const weapon = item.weapon ? catalogue.weapons.get(item.weapon) : undefined;
    if (weapon && !free.some(row => row.id === weapon.id)) free.push(weapon);
    const piece = item.armor ? catalogue.armor.find(row => row.id === item.armor) : undefined;
    if (piece && !armorFree[piece.slot]) armorFree[piece.slot] = piece;
  }
  const bought = draft.weapons
    .map(id => catalogue.weapons.get(id))
    .filter((weapon): weapon is WeaponRow => Boolean(weapon) && !free.some(row => row.id === weapon?.id));
  return { free, bought, armorFree };
}

function fieldKitBudget(alchemyLevel: number): number {
  return FIELD_KIT_BASE + Math.floor(alchemyLevel / 2);
}

export function fieldKitCost(kind: AlchemyRow['kind']): number {
  return kind === 'decoction' ? 2 : 1;
}

/** Builds the full sheet for a draft and reports everything wrong with it. */
export function buildHero(input: Partial<HeroDraft> | undefined, catalogue: Catalogue): BuildResult {
  const draft = normalizeDraft(input, catalogue);
  const race = raceOf(catalogue, draft.raceId);
  const profession = professionOf(catalogue, draft.professionId);
  const issues: Issue[] = [];
  const problem = (level: Issue['level'], field: string, message: string): void => { issues.push({ level, field, message }); };

  const stats = finalStats(draft.stats, race);
  const derived = deriveValues(stats, race, profession);

  // Identity.
  if (!draft.name) problem('error', 'name', 'Give your hero a name.');
  if (race.id === 'witcher' && profession.id !== 'witcher') {
    problem('warning', 'professionId', 'Witchers are trained monster hunters; the Witcher profession is the usual fit.');
  }
  if (profession.id === 'witcher' && race.id !== 'witcher') {
    problem('warning', 'raceId', 'The Witcher profession expects the Witcher race: mutation is what makes a witcher.');
  }

  // Statistics.
  const assignedTotal = STAT_IDS.reduce((sum, id) => sum + draft.stats[id], 0);
  const statBudget = STAT_TIERS[draft.statTier];
  if (draft.statMethod === 'pool') {
    if (assignedTotal > statBudget) problem('error', 'stats', `${assignedTotal - statBudget} stat points over the ${statBudget}-point pool.`);
    else if (assignedTotal < statBudget) problem('warning', 'stats', `${statBudget - assignedTotal} stat points still unassigned.`);
  } else {
    for (const id of STAT_IDS) {
      if (draft.stats[id] < ROLLED_STAT_MIN) problem('error', 'stats', `${id} is below the lowest possible roll (${ROLLED_STAT_MIN}).`);
    }
  }

  // Skills.
  const packageNames = packageSkills(profession, draft.picks);
  const packageSet = new Set(packageNames);
  for (const slot of profession.picks) {
    const chosen = draft.picks[slot.id] ?? [];
    if (chosen.length < slot.count) problem('error', `picks.${slot.id}`, `Choose ${slot.count - chosen.length} more: ${slot.label}.`);
  }

  const lines: SkillLine[] = [];
  let packageSpent = 0;
  let pickupSpent = 0;
  let alchemyLevel = 0;
  for (const skill of catalogue.skills) {
    if (skill.profession && skill.profession !== profession.id) continue;
    const purchased = draft.levels[skill.name] ?? 0;
    const bonus = (race.skillBonus[skill.name] ?? 0) + (skill.name === race.homeLanguage ? HOME_LANGUAGE_LEVEL : 0);
    const role: SkillLine['role'] = skill.name === profession.defining.name ? 'defining' : packageSet.has(skill.name) ? 'package' : 'pickup';
    const level = purchased + bonus;
    lines.push({
      name: skill.name,
      stat: skill.stat,
      hard: Boolean(skill.hard),
      role,
      purchased,
      bonus,
      level,
      check: stats[skill.stat] + level
    });
    const cost = purchased * skillCost(skill);
    if (role === 'pickup') pickupSpent += cost; else packageSpent += cost;
    if (skill.name === 'Alchemy') alchemyLevel = level;
  }
  for (const name of packageNames) {
    if ((draft.levels[name] ?? 0) < 1 && skillNamed(catalogue, name)) problem('error', `levels.${name}`, `${name} is part of your package: put at least 1 point in it.`);
  }
  const pickupBudget = stats.INT + stats.REF;
  if (packageSpent > PACKAGE_POINTS) problem('error', 'package', `${packageSpent - PACKAGE_POINTS} package points over the ${PACKAGE_POINTS}-point budget.`);
  else if (packageSpent < PACKAGE_POINTS) problem('warning', 'package', `${PACKAGE_POINTS - packageSpent} package points unspent.`);
  if (pickupSpent > pickupBudget) problem('error', 'pickup', `${pickupSpent - pickupBudget} pick-up points over your INT + REF budget of ${pickupBudget}.`);
  else if (pickupSpent < pickupBudget) problem('warning', 'pickup', `${pickupBudget - pickupSpent} pick-up points unspent.`);

  // Gear and coin.
  if (draft.kit.length > profession.kit.pick) problem('error', 'kit', `Your profession kit allows ${profession.kit.pick} picks.`);
  else if (draft.kit.length < profession.kit.pick) problem('warning', 'kit', `You can still take ${profession.kit.pick - draft.kit.length} kit items.`);

  const owned = ownedGear(draft, profession, catalogue);
  const armor: Record<ArmorSlot, ArmorRow | null> = { head: null, torso: null, legs: null };
  let spent = owned.bought.reduce((sum, weapon) => sum + (weapon.cost ?? 0), 0);
  for (const slot of ARMOR_SLOTS) {
    const chosen = draft.armor[slot] ? catalogue.armor.find(row => row.id === draft.armor[slot]) ?? null : null;
    const free = owned.armorFree[slot] ?? null;
    // A kit piece is free; a different piece for the same slot is bought and replaces it.
    armor[slot] = chosen ?? free;
    if (chosen && chosen.id !== free?.id) spent += chosen.cost;
  }
  const total = profession.coin * draft.coinRoll;
  if (spent > total) problem('error', 'coin', `${spent - total} crowns over budget.`);

  const weapons = [...owned.free, ...owned.bought];
  const armorByLocation: Record<string, number> = {
    head: armor.head?.sp ?? 0,
    torso: armor.torso?.sp ?? 0,
    rightArm: armor.torso?.sp ?? 0,
    leftArm: armor.torso?.sp ?? 0,
    rightLeg: armor.legs?.sp ?? 0,
    leftLeg: armor.legs?.sp ?? 0
  };

  // Field kit.
  const kitBudget = fieldKitBudget(alchemyLevel);
  let kitSpent = 0;
  const fieldKit: HeroSheet['fieldKit'] = [];
  for (const item of catalogue.alchemy) {
    const count = draft.fieldKit[item.id] ?? 0;
    if (count < 1) continue;
    kitSpent += count * fieldKitCost(item.kind);
    fieldKit.push({ id: item.id, name: item.name, kind: item.kind, count });
  }
  if (kitSpent > kitBudget) problem('error', 'fieldKit', `${kitSpent - kitBudget} field kit points over budget.`);

  if (!profession.simulatedMagic) {
    problem('note', 'magic', `${profession.name} magic (${profession.magic}) is not part of the combat simulation yet; this hero fights with skills, steel and the field kit.`);
  }

  const gear = profession.kit.items
    .filter(item => draft.kit.includes(item.label) && !item.weapon && !item.armor)
    .concat(profession.kit.special.filter(item => !item.weapon && !item.armor))
    .map(item => item.label);

  const perks: Perk[] = [
    ...race.perks,
    { text: `${profession.defining.name}: ${profession.defining.effect}`, simulated: false }
  ];

  const sheet: HeroSheet = {
    name: draft.name,
    gender: draft.gender,
    age: draft.age,
    ageBand: ageBandFor(draft.age),
    region: draft.region,
    temperament: draft.temperament,
    appearance: draft.appearance,
    race: { id: race.id, name: race.name, family: race.family },
    profession: { id: profession.id, name: profession.name },
    defining: profession.defining,
    stats,
    derived,
    skills: lines,
    perks,
    magic: profession.magic,
    simulatedMagic: profession.simulatedMagic,
    knownSigns: profession.signs ? [...BASIC_SIGNS] : [],
    weapons,
    armor,
    armorByLocation,
    gear,
    ammo: weapons.some(weapon => weapon.range !== 'melee') ? STARTING_AMMO : 0,
    coin: { total, spent, left: total - spent },
    fieldKit,
    points: {
      stats: { spent: assignedTotal, budget: statBudget },
      package: { spent: packageSpent, budget: PACKAGE_POINTS },
      pickup: { spent: pickupSpent, budget: pickupBudget },
      fieldKit: { spent: kitSpent, budget: kitBudget }
    }
  };

  return { draft, sheet, issues, ok: !issues.some(issue => issue.level === 'error') };
}

// --- quick build -------------------------------------------------------------------------------

/** Stat templates by tier, highest first. Each sums to its pool and stays at or under 10. */
const QUICK_STATS: Record<StatTier, number[]> = {
  average: [9, 8, 8, 7, 7, 6, 6, 5, 4],
  skilled: [10, 10, 9, 8, 8, 7, 7, 6, 5],
  heroes: [10, 10, 10, 9, 8, 8, 7, 7, 6],
  legends: [10, 10, 10, 10, 9, 8, 8, 8, 7]
};

/** Raises each listed skill one level per pass, in order, until the budget or the cap stops it. */
function spreadPoints(
  levels: Record<string, number>,
  order: string[],
  budget: number,
  catalogue: Catalogue
): number {
  let remaining = budget;
  let progressed = true;
  while (progressed && remaining > 0) {
    progressed = false;
    for (const name of order) {
      const skill = skillNamed(catalogue, name);
      if (!skill) continue;
      const cost = skillCost(skill);
      if ((levels[name] ?? 0) >= SKILL_CAP || cost > remaining) continue;
      levels[name] = (levels[name] ?? 0) + 1;
      remaining -= cost;
      progressed = true;
    }
  }
  return remaining;
}

/** A general-purpose pick-up list for when a profession's own preferences run out. */
const PICKUP_FALLBACK = ['Awareness', 'Endurance', 'Athletics', 'Courage', 'Dodge / Escape', 'Physique', 'Resist Coercion', 'Stealth', 'Brawling'];

/** The consumables a quick build tries to carry, in order. */
const FIELD_KIT_PRIORITY: Array<[string, number]> = [
  ['swallow', 2], ['thunderbolt', 1], ['grapeshot', 1], ['beast-oil', 1], ['necrophage-oil', 1],
  ['cat', 1], ['northern-wind', 1], ['specter-oil', 1], ['tawny-owl', 1]
];

/**
 * Fills in every mechanical choice with a sensible default for the draft's race and profession,
 * keeping its identity (name, look, race, profession, stat tier). The result always builds without
 * errors.
 */
export function quickBuild(input: Partial<HeroDraft> | undefined, catalogue: Catalogue): HeroDraft {
  const base = normalizeDraft(input, catalogue);
  const race = raceOf(catalogue, base.raceId);
  const profession = professionOf(catalogue, base.professionId);

  // Statistics, ranked by the profession's priorities.
  const template = QUICK_STATS[base.statTier];
  const stats = {} as Stats;
  const ranked = [...profession.statOrder, ...STAT_IDS.filter(id => !profession.statOrder.includes(id))];
  ranked.forEach((id, rank) => { stats[id] = template[rank] ?? 5; });

  // Profession picks, then the package.
  const picks: Record<string, string[]> = {};
  for (const slot of profession.picks) picks[slot.id] = slot.defaults.slice(0, slot.count);
  const packageNames = packageSkills(profession, picks);

  const levels: Record<string, number> = {};
  let used = 0;
  for (const name of packageNames) {
    levels[name] = 1;
    used += skillCost(skillNamed(catalogue, name));
  }
  const focus = profession.focus.filter(name => packageNames.includes(name));
  spreadPoints(levels, [...focus, ...packageNames.filter(name => !focus.includes(name))], PACKAGE_POINTS - used, catalogue);

  // Pick-up skills.
  const finals = finalStats(stats, race);
  const pickupOrder = [...profession.pickups, ...PICKUP_FALLBACK]
    .filter((name, index, all) => all.indexOf(name) === index)
    .filter(name => !packageNames.includes(name) && skillNamed(catalogue, name));
  spreadPoints(levels, pickupOrder, finals.INT + finals.REF, catalogue);

  const draft: HeroDraft = {
    ...base,
    statMethod: 'pool',
    stats,
    picks,
    levels,
    kit: profession.kit.quick.filter(label => profession.kit.items.some(item => item.label === label)).slice(0, profession.kit.pick),
    coinRoll: 7,
    weapons: [],
    armor: {},
    fieldKit: {}
  };

  // Spend coin: armour first, then a main weapon in the hero's best weapon skill.
  const total = profession.coin * draft.coinRoll;
  const owned = ownedGear(draft, profession, catalogue);
  let left = total;
  const shares: Array<[ArmorSlot, number]> = [['torso', 0.4], ['legs', 0.3], ['head', 0.3]];
  for (const [slot, share] of shares) {
    if (owned.armorFree[slot]) continue;
    const cap = left * share;
    const piece = catalogue.armor
      .filter(row => row.slot === slot && row.cost <= cap)
      .sort((a, b) => b.sp - a.sp)[0];
    if (piece) { draft.armor[slot] = piece.id; left -= piece.cost; }
  }

  const weaponSkills = catalogue.skills.filter(skill => skill.group === 'combat').map(skill => skill.name);
  const topSkill = [...weaponSkills].sort((a, b) => (levels[b] ?? 0) - (levels[a] ?? 0))[0];
  const hasMain = owned.free.some(weapon => weapon.combatSkill === topSkill);
  if (topSkill && !hasMain) {
    const main = purchasableWeapons(catalogue)
      .filter(weapon => weapon.combatSkill === topSkill && (weapon.cost ?? 0) <= left * 0.7)
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))[0];
    if (main) { draft.weapons.push(main.id); left -= main.cost ?? 0; }
  }

  // Field kit, within budget.
  const alchemy = (race.skillBonus.Alchemy ?? 0) + (levels.Alchemy ?? 0);
  let points = fieldKitBudget(alchemy);
  for (const [id, wanted] of FIELD_KIT_PRIORITY) {
    const item = catalogue.alchemy.find(row => row.id === id);
    if (!item || (item.kind === 'decoction' && !race.mutagens)) continue;
    const count = Math.min(wanted, Math.floor(points / fieldKitCost(item.kind)));
    if (count > 0) { draft.fieldKit[id] = count; points -= count * fieldKitCost(item.kind); }
  }
  return normalizeDraft(draft, catalogue);
}

/** A fresh, valid draft for a race and profession, ready to edit. */
export function newDraft(catalogue: Catalogue, roll: Roll, raceId?: string, professionId?: string): HeroDraft {
  const seed = normalizeDraft({ raceId, professionId }, catalogue);
  const race = raceOf(catalogue, seed.raceId);
  const gender: Gender = roll(2) === 1 ? 'Male' : 'Female';
  return quickBuild({
    ...seed,
    gender,
    age: race.defaultAge,
    name: suggestName(catalogue, race.id, gender, roll),
    temperament: 'disciplined'
  }, catalogue);
}

// --- sharing -----------------------------------------------------------------------------------

/** The label every hero document carries, so a stray JSON file is not mistaken for one. */
export const HERO_FORMAT = 'grimoire-hero';
/** Bumped when a document written by this version could not be read by an older one. */
export const HERO_VERSION = 1;
/** The longest document accepted, in characters. A real hero is under three thousand. */
export const HERO_FILE_MAX = 20000;

export type ImportResult =
  | { ok: true; draft: HeroDraft; /** What was repaired or left out, in plain words. */ notes: string[] }
  | { ok: false; error: string };

/** Writes a draft as a small, readable JSON document. */
export function exportHero(draft: HeroDraft, catalogue: Catalogue): string {
  return JSON.stringify({ format: HERO_FORMAT, version: HERO_VERSION, hero: normalizeDraft(draft, catalogue) }, null, 2);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Text and numbers only: an object smuggled into a text field would throw when it is coerced. */
const asText = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined;
const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(entry => (asText(entry) === undefined ? [] : [String(entry)])) : [];

/** Copies a record's own entries through `convert`, dropping the ones it rejects and any `__proto__`. */
function asRecord<T>(value: unknown, convert: (entry: unknown) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isPlain(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    const converted = convert(entry);
    if (converted !== undefined && key !== '__proto__') out[key] = converted;
  }
  return out;
}

/**
 * Gives an untrusted document the shape `normalizeDraft` expects, so a damaged file is repaired
 * rather than crashing the reader. Only known fields are copied, so nothing else it holds survives.
 */
function shapeHero(raw: Record<string, unknown>): Partial<HeroDraft> {
  const appearance = isPlain(raw.appearance) ? raw.appearance : {};
  return {
    name: asText(raw.name),
    gender: asText(raw.gender) as Gender,
    age: asNumber(raw.age),
    region: asText(raw.region),
    temperament: asText(raw.temperament),
    appearance: {
      height: asText(appearance.height) ?? '',
      build: asText(appearance.build) ?? '',
      hair: asText(appearance.hair) ?? '',
      eyes: asText(appearance.eyes) ?? '',
      skin: asText(appearance.skin) ?? '',
      notable: asList(appearance.notable)
    },
    raceId: asText(raw.raceId),
    professionId: asText(raw.professionId),
    statMethod: asText(raw.statMethod) as HeroDraft['statMethod'],
    statTier: asText(raw.statTier) as StatTier,
    stats: asRecord(raw.stats, asNumber) as Stats,
    picks: asRecord(raw.picks, entry => (Array.isArray(entry) ? asList(entry) : undefined)),
    levels: asRecord(raw.levels, asNumber),
    kit: asList(raw.kit),
    coinRoll: asNumber(raw.coinRoll),
    weapons: asList(raw.weapons),
    armor: asRecord(raw.armor, asText) as HeroDraft['armor'],
    fieldKit: asRecord(raw.fieldKit, asNumber)
  };
}

/** Reads a hero document. Never throws: a damaged or hostile file is reported, not trusted. */
export function importHero(text: string, catalogue: Catalogue): ImportResult {
  const source = String(text ?? '').trim();
  if (!source) return { ok: false, error: 'Paste a hero first.' };
  if (source.length > HERO_FILE_MAX) return { ok: false, error: 'That text is too large to be a hero.' };

  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { return { ok: false, error: 'That is not valid JSON.' }; }
  if (!isPlain(parsed) || parsed.format !== HERO_FORMAT || !isPlain(parsed.hero)) {
    return { ok: false, error: 'That is not a Grimoire hero file.' };
  }
  if (Number(parsed.version) > HERO_VERSION) {
    return { ok: false, error: 'That hero was saved by a newer version of the game.' };
  }

  const raw = shapeHero(parsed.hero);
  const draft = normalizeDraft(raw, catalogue);

  const notes: string[] = [];
  const unknown = (label: string, said: unknown, found: string): void => {
    if (said !== undefined && said !== found) notes.push(`${label} "${cleanText(said, 30)}" is not known here; ${found} was used instead.`);
  };
  unknown('People', raw.raceId, draft.raceId);
  unknown('Calling', raw.professionId, draft.professionId);
  const lost = (said: string[], kept: string[]): number => said.filter(entry => !kept.includes(entry)).length;
  const weapons = lost(raw.weapons ?? [], draft.weapons);
  if (weapons) notes.push(`${weapons} weapon${weapons === 1 ? ' was' : 's were'} not recognised and left out.`);
  const armour = Object.keys(raw.armor ?? {}).filter(slot => !(slot in draft.armor)).length;
  if (armour) notes.push(`${armour} armour piece${armour === 1 ? ' was' : 's were'} not recognised and left out.`);
  const kit = Object.keys(raw.fieldKit ?? {}).filter(id => !(id in draft.fieldKit)).length;
  if (kit) notes.push(`${kit} field kit item${kit === 1 ? ' was' : 's were'} not recognised and left out.`);
  return { ok: true, draft, notes };
}
