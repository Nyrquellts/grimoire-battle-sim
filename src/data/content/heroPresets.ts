import type { RegistryHub } from '../RegistryHub';

/**
 * Premade heroes: the ones on offer before anyone opens the character creator.
 *
 * Two shapes share one table. A **veteran** is a finished combat sheet, hand-built beyond what
 * creation allows, and carries its whole actor. A **fresh** hero is only an identity plus a race,
 * a profession and a stat tier; the builder fills in every mechanical choice, so a fresh hero can
 * never drift from the creation rules.
 */

type Row = Record<string, unknown>;

/** Veterans. `inventoryAll` stocks every registered consumable of each kind with that many. */
const VETERANS: Array<[string, Row]> = [
  ['nikhail', {
    default: true,
    name: 'Nikhail',
    label: 'Half-elf witcher',
    summary: 'A young witcher out of Zerrikania: quick, scarred, and equipped for monsters and men alike with curved steel and silver, a shield and a hand crossbow. The full veteran kit.',
    actor: {
      id: 'nikhail',
      name: 'Nikhail',
      baseName: 'Nikhail',
      family: 'Human',
      gender: 'Male',
      age: 20,
      ageBand: 'Young adult',
      team: 'player',
      control: 'PLAYER',
      anatomyId: 'humanoid',
      personalityProfile: 'stoic',
      combatDoctrines: ['witcher'],
      objective: { id: 'eliminate' },
      identity: { gender: 'Male', age: 20, region: 'Zerrikania', pronouns: { subject: 'he', object: 'him', possessiveAdjective: 'his', possessivePronoun: 'his', reflexive: 'himself' } },
      appearance: { height: '5′6½″', build: 'compact, heavily conditioned', heritage: 'half-elf', skin: 'dark brown', hair: 'long dreadlocks', eyes: 'amber-brown', notable: ['Manticore medallion', 'acid scar over the left brow and upper cheek', 'young witcher'] },
      stats: { INT: 8, REF: 11, DEX: 11, BODY: 9, SPD: 10, EMP: 4, CRA: 8, WILL: 9, STUN: 9, LUCK: 3 },
      skills: { 'Witcher Training': 16, Awareness: 17, Deduction: 14, 'Spell Casting': 15, Alchemy: 16, 'Dodge / Escape': 20, 'Wilderness Survival': 15, Swordsmanship: 20, Athletics: 20, Stealth: 19, Ride: 17, Crossbow: 19, 'Melee (Shield)': 19, Brawling: 18, Endurance: 17, Physique: 16, Crafting: 13, 'First Aid': 12, Tactics: 14, 'Resist Magic': 15, 'Resist Coercion': 16, Courage: 16, Intimidation: 15, 'Human Perception': 8, Persuasion: 7, 'Social Etiquette': 12 },
      hp: 45,
      maxHp: 45,
      sta: 45,
      maxSta: 45,
      rec: 9,
      vigor: 5,
      toxicity: 0,
      maxToxicity: 150,
      armorByLocation: { head: 0, torso: 14, rightArm: 14, leftArm: 14, rightLeg: 14, leftLeg: 14 },
      armorMaxByLocation: { head: 0, torso: 14, rightArm: 14, leftArm: 14, rightLeg: 14, leftLeg: 14 },
      defenses: { dodge: 20, reposition: 20, block: 19, magic: 15 },
      statuses: {},
      criticals: [],
      disabledLocations: {},
      death: null,
      dead: false,
      pos: { x: 4, y: 8 },
      quenBlocks: 0,
      activeShield: null,
      activeSigns: {},
      weapons: ['manticoreSteel', 'manticoreSilver', 'sipar', 'zerrikanianCrossbow'],
      tools: ['silverHuntingKnife'],
      selectedWeapon: 'manticoreSteel',
      crossbowLoaded: true,
      ammo: { standard: 20, bodkin: 5, broadhead: 5 },
      inventoryAll: { potions: 2, decoctions: 1, bombs: 2, oils: 3 },
      activeAlchemy: {},
      morale: { state: 'steady', fear: 0 },
      history: [],
      resistances: [],
      immunities: [],
      vulnerabilities: [],
      ai: null
    }
  }]
];

/** Fresh heroes: identity only. Names are invented. */
const FRESH: Array<[string, Row]> = [
  ['isra-vale', {
    name: 'Isra Vale',
    summary: 'A witcher still earning her medallion. Signs, a silver-and-steel pair, and a belt of potions and bombs.',
    draft: {
      name: 'Isra Vale', gender: 'Female', age: 29, region: 'Kaedwen', temperament: 'disciplined',
      raceId: 'witcher', professionId: 'witcher', statTier: 'heroes',
      appearance: { height: '5′8″', build: 'lean and wiry', hair: 'white, braided close', eyes: 'pale gold', skin: 'fair', notable: ['a mutation-pale complexion', 'a ring of old burns on one wrist'] }
    }
  }],
  ['maren-coldbrook', {
    name: 'Maren Coldbrook',
    summary: 'A sellsword who has outlived three companies. Heavy armour, a good sword, and a crossbow for the ones who run.',
    draft: {
      name: 'Maren Coldbrook', gender: 'Female', age: 31, region: 'Temeria', temperament: 'stoic',
      raceId: 'human', professionId: 'man-at-arms', statTier: 'skilled',
      appearance: { height: '5′9″', build: 'broad-shouldered', hair: 'cropped, iron-grey at the temples', eyes: 'grey', skin: 'weathered', notable: ['a notched left ear', 'a company brand on the forearm'] }
    }
  }],
  ['borgar-hammerfall', {
    name: 'Borgar Hammerfall',
    summary: 'A journeyman smith turned caravan guard. Skin like boiled leather, a hammer that doubles as a weapon, and no patience for fools.',
    draft: {
      name: 'Borgar Hammerfall', gender: 'Male', age: 74, region: 'Mahakam', temperament: 'aggressive',
      raceId: 'dwarf', professionId: 'craftsman', statTier: 'skilled',
      appearance: { height: '4′11″', build: 'barrel-chested', hair: 'copper, braided into a beard', eyes: 'dark brown', skin: 'ruddy', notable: ['forge-scarred forearms', 'a missing front tooth'] }
    }
  }],
  ['aelis-moonwater', {
    name: 'Aelis Moonwater',
    summary: 'An elven scout from the borderlands: light on her feet, quicker with a blade than with small talk, and never where you last saw her.',
    draft: {
      name: 'Aelis Moonwater', gender: 'Female', age: 118, region: 'Dol Blathanna', temperament: 'cautious',
      raceId: 'elf', professionId: 'criminal', statTier: 'skilled',
      appearance: { height: '5′10″', build: 'slender', hair: 'silver-blonde, bound with leather cord', eyes: 'green', skin: 'pale', notable: ['a tattooed river across one shoulder', 'a chipped ear tip'] }
    }
  }]
];

/** Registers every premade hero on the supplied hub. Called once from `witcherContent.ts`. */
export function registerHeroPresetContent(registry: RegistryHub): void {
  for (const [id, row] of [...VETERANS, ...FRESH]) registry.add('heroPresets', id, row);
}
