import type { RegistryHub } from '../RegistryHub';
import type { ArmorRow, ProfessionRow, RaceRow, SkillRow, StatId } from '../../services/CharacterBuilder';

/**
 * Character creation content: skills, races, professions, armour, and what weapons cost.
 *
 * Everything here is data. The rules that use it (point pools, caps, derived values) live in
 * `services/CharacterBuilder.ts`, which receives a resolved catalogue instead of reaching for the
 * registry, so adding a profession or a race is a row in this file and nothing else.
 *
 * Skill names are the names on the character sheet. The two the simulation spells differently
 * (`Dodge / Escape`, `Ride`) use the simulation's spelling here so nothing needs translating.
 */

type Row<T> = Omit<T, 'id'>;

/** Skill rows in sheet order, then the nine defining skills. */
const SKILLS: Array<Row<SkillRow>> = [
  { name: 'Awareness', stat: 'INT' },
  { name: 'Business', stat: 'INT' },
  { name: 'Deduction', stat: 'INT' },
  { name: 'Education', stat: 'INT' },
  { name: 'Common Speech', stat: 'INT', hard: true, group: 'languages' },
  { name: 'Elder Speech', stat: 'INT', hard: true, group: 'languages' },
  { name: 'Dwarven', stat: 'INT', hard: true, group: 'languages' },
  { name: 'Monster Lore', stat: 'INT', hard: true },
  { name: 'Social Etiquette', stat: 'INT' },
  { name: 'Streetwise', stat: 'INT' },
  { name: 'Tactics', stat: 'INT', hard: true },
  { name: 'Teaching', stat: 'INT' },
  { name: 'Wilderness Survival', stat: 'INT' },

  { name: 'Brawling', stat: 'REF', group: 'combat' },
  { name: 'Dodge / Escape', stat: 'REF' },
  { name: 'Melee', stat: 'REF', group: 'combat' },
  { name: 'Ride', stat: 'REF' },
  { name: 'Sailing', stat: 'REF' },
  { name: 'Small Blades', stat: 'REF', group: 'combat' },
  { name: 'Staff/Spear', stat: 'REF', group: 'combat' },
  { name: 'Swordsmanship', stat: 'REF', group: 'combat' },

  { name: 'Archery', stat: 'DEX', group: 'combat' },
  { name: 'Athletics', stat: 'DEX' },
  { name: 'Crossbow', stat: 'DEX', group: 'combat' },
  { name: 'Sleight of Hand', stat: 'DEX' },
  { name: 'Stealth', stat: 'DEX' },

  { name: 'Physique', stat: 'BODY' },
  { name: 'Endurance', stat: 'BODY' },

  { name: 'Charisma', stat: 'EMP' },
  { name: 'Deceit', stat: 'EMP' },
  { name: 'Fine Arts', stat: 'EMP' },
  { name: 'Gambling', stat: 'EMP' },
  { name: 'Grooming and Style', stat: 'EMP' },
  { name: 'Human Perception', stat: 'EMP' },
  { name: 'Leadership', stat: 'EMP' },
  { name: 'Persuasion', stat: 'EMP' },
  { name: 'Performance', stat: 'EMP' },
  { name: 'Seduction', stat: 'EMP' },

  { name: 'Alchemy', stat: 'CRA', hard: true },
  { name: 'Crafting', stat: 'CRA', hard: true },
  { name: 'Disguise', stat: 'CRA' },
  { name: 'First Aid', stat: 'CRA' },
  { name: 'Forgery', stat: 'CRA' },
  { name: 'Pick Lock', stat: 'CRA' },
  { name: 'Trap Crafting', stat: 'CRA', hard: true },

  { name: 'Courage', stat: 'WILL' },
  { name: 'Hex Weaving', stat: 'WILL', hard: true },
  { name: 'Intimidation', stat: 'WILL' },
  { name: 'Spell Casting', stat: 'WILL', hard: true },
  { name: 'Resist Magic', stat: 'WILL', hard: true },
  { name: 'Resist Coercion', stat: 'WILL' },
  { name: 'Ritual Crafting', stat: 'WILL', hard: true },

  { name: 'Busking', stat: 'EMP', profession: 'bard' },
  { name: 'Patch Job', stat: 'CRA', profession: 'craftsman' },
  { name: 'Practiced Paranoia', stat: 'INT', profession: 'criminal' },
  { name: 'Healing Hands', stat: 'CRA', profession: 'doctor' },
  { name: 'Magic Training', stat: 'INT', profession: 'mage' },
  { name: 'Tough As Nails', stat: 'BODY', profession: 'man-at-arms' },
  { name: 'Well Traveled', stat: 'INT', profession: 'merchant' },
  { name: 'Initiate of the Gods', stat: 'EMP', profession: 'priest' },
  { name: 'Witcher Training', stat: 'INT', profession: 'witcher' }
];

const RACES: Array<[string, Row<RaceRow>]> = [
  ['human', {
    name: 'Human', family: 'Human',
    summary: 'The dominant people of the Continent: adaptable, clever and stubborn to a fault.',
    homeLanguage: 'Common Speech', statMods: {}, skillBonus: { Deduction: 1 }, naturalSp: 0, encBonus: 0,
    mutagens: false, defaultAge: 26,
    perks: [
      { text: '+1 Deduction.', simulated: true },
      { text: '+1 Charisma, Seduction and Persuasion with other humans.', simulated: false },
      { text: 'Reroll a failed Courage or Resist Coercion roll three times a session.', simulated: false }
    ],
    names: {
      male: ['Aldric', 'Bram', 'Corwin', 'Edric', 'Garrick', 'Ivor', 'Kellan', 'Lorne', 'Nolan', 'Perrin', 'Soren', 'Ulric', 'Wystan'],
      female: ['Brenna', 'Delia', 'Fenna', 'Helka', 'Jessa', 'Maren', 'Orla', 'Quilla', 'Rhosyn', 'Tamsin', 'Vesna', 'Yara'],
      family: ['Ashdown', 'Brightwater', 'Coldbrook', 'Dunmere', 'Eastfen', 'Fairholt', 'Greymarch', 'Hollin', 'Ironvale', 'Kestrel', 'Longmeadow', 'Marrow', 'Northcott', 'Oakhurst', 'Ravenscar', 'Stonebridge', 'Thornfield', 'Wetherby']
    }
  }],
  ['elf', {
    name: 'Elf', family: 'Human',
    summary: 'Aen Seidhe: long-lived, at home in the wild and the finest archers anywhere.',
    homeLanguage: 'Elder Speech', statMods: {}, skillBonus: { Archery: 2, 'Fine Arts': 1 }, naturalSp: 0, encBonus: 0,
    mutagens: false, defaultAge: 110,
    perks: [
      { text: '+2 Archery.', simulated: true },
      { text: '+1 Fine Arts.', simulated: true },
      { text: 'Draws and strings a bow without spending an action.', simulated: false },
      { text: 'Animals stay calm around them; common plants are found without a roll.', simulated: false }
    ],
    names: {
      male: ['Aevar', 'Caelum', 'Eldris', 'Faelan', 'Ithren', 'Mirel', 'Naerith', 'Oriel', 'Taevar', 'Vaelis'],
      female: ['Aelis', 'Caerys', 'Eluned', 'Ilmira', 'Lathriel', 'Mirelle', 'Naeris', 'Sylvaine', 'Thessaly'],
      family: ['Dawnmere', 'Ashgrove', 'Moonwater', 'Starling', 'Whisperfen', 'Evenglade', 'Brightleaf', 'Silverbrook']
    }
  }],
  ['dwarf', {
    name: 'Dwarf', family: 'Human',
    summary: 'Compact, broad and hard to bluff, with skin like boiled leather.',
    homeLanguage: 'Dwarven', statMods: {}, skillBonus: { Physique: 1, Business: 1 }, naturalSp: 2, encBonus: 25,
    mutagens: false, defaultAge: 70,
    perks: [
      { text: 'Natural stopping power 2 that armour ablation never wears down.', simulated: true },
      { text: '+1 Physique.', simulated: true },
      { text: '+1 Business.', simulated: true },
      { text: '+25 encumbrance.', simulated: false }
    ],
    names: {
      male: ['Borgar', 'Brandt', 'Dagfinn', 'Eitri', 'Fenrik', 'Hjalmar', 'Kolgrim', 'Orsk', 'Rurik', 'Torvald'],
      female: ['Brunhild', 'Dagna', 'Gudrun', 'Hilde', 'Ingrid', 'Runa', 'Sigrun'],
      family: ['Anvilborn', 'Coalbrow', 'Deepdelver', 'Granitefist', 'Hammerfall', 'Ironhand', 'Rockhelm', 'Stonebeard']
    }
  }],
  ['witcher', {
    name: 'Witcher', family: 'Human',
    summary: 'A mutant raised and trained to hunt monsters: faster, sharper-sensed and emotionally dulled.',
    homeLanguage: 'Common Speech', statMods: { REF: 1, DEX: 1, EMP: -4 }, skillBonus: { Awareness: 1 }, naturalSp: 0, encBonus: 0,
    mutagens: true, defaultAge: 35,
    perks: [
      { text: '+1 REF and DEX, which may pass 10.', simulated: true },
      { text: '-4 EMP, never below 1.', simulated: true },
      { text: '+1 Awareness.', simulated: true },
      { text: 'No dim-light penalty; tracks by scent.', simulated: false },
      { text: 'Immune to disease; can use mutagens (decoctions).', simulated: false },
      { text: 'Never rolls Courage against Intimidation.', simulated: false }
    ],
    names: {
      male: ['Aldric', 'Bram', 'Corwin', 'Edric', 'Garrick', 'Kellan', 'Lorne', 'Perrin', 'Soren', 'Wystan'],
      female: ['Brenna', 'Delia', 'Helka', 'Jessa', 'Maren', 'Orla', 'Yara'],
      family: ['Ashdown', 'Coldbrook', 'Greymarch', 'Ironvale', 'Kestrel', 'Marrow', 'Ravenscar', 'Thornfield']
    }
  }]
];

/** Shorthand for a package that trains the same skills for every race. */
const PROFESSIONS: Array<[string, Row<ProfessionRow>]> = [
  ['bard', {
    name: 'Bard', summary: 'Entertainer, gossip and charmer. Talks their way out of what steel cannot.',
    vigor: 0, coin: 120,
    defining: { name: 'Busking', effect: 'Earns coin from a crowd with an hour of performance.' },
    fixed: ['Charisma', 'Deceit', 'Performance', 'Human Perception', 'Persuasion', 'Streetwise', 'Fine Arts', 'Seduction', 'Social Etiquette'],
    picks: [{ id: 'language', label: 'a language', from: 'languages', count: 1, defaults: ['Elder Speech'] }],
    focus: ['Performance', 'Persuasion', 'Charisma', 'Deceit', 'Seduction'],
    pickups: ['Dodge / Escape', 'Small Blades', 'Athletics', 'Awareness', 'Stealth'],
    statOrder: ['EMP', 'DEX', 'REF', 'INT', 'WILL', 'SPD', 'LUCK', 'CRA', 'BODY'],
    kit: {
      pick: 5, special: [],
      items: [
        { label: 'Dice poker board' }, { label: 'Card deck' }, { label: 'Hand mirror' }, { label: 'An instrument' },
        { label: 'Flask of spirits' }, { label: 'Dagger', weapon: 'dagger' }, { label: 'Perfume or cologne' },
        { label: 'Belt pouch' }, { label: 'Garter sheath' }, { label: 'A journal with a lock' }
      ],
      quick: ['Dagger', 'An instrument', 'Card deck', 'Flask of spirits', 'Belt pouch']
    },
    signs: false, magic: 'None', simulatedMagic: true
  }],
  ['craftsman', {
    name: 'Craftsman', summary: 'Smith, carpenter or tinker. Keeps people and kit in the fight.',
    vigor: 0, coin: 120,
    defining: { name: 'Patch Job', effect: 'Field-repairs a broken weapon or armour to half strength.' },
    fixed: ['Crafting', 'Business', 'Athletics', 'Endurance', 'Physique', 'Streetwise', 'Fine Arts', 'Alchemy', 'Education', 'Persuasion'],
    picks: [],
    focus: ['Crafting', 'Alchemy', 'Physique', 'Business', 'Patch Job'],
    pickups: ['Melee', 'Dodge / Escape', 'Awareness', 'Brawling', 'Courage'],
    statOrder: ['CRA', 'BODY', 'INT', 'REF', 'WILL', 'DEX', 'EMP', 'LUCK', 'SPD'],
    kit: {
      pick: 5, special: [],
      items: [
        { label: "Tinker's forge" }, { label: "Merchant's tools" }, { label: 'Iron long sword', weapon: 'ironLongSword' },
        { label: 'Forging tools' }, { label: 'Alchemy set' }, { label: 'Hourglass' }, { label: 'Small chest' },
        { label: 'Mace', weapon: 'mace' }, { label: '50 crowns of components' }, { label: 'Lock' }
      ],
      quick: ['Mace', 'Iron long sword', 'Forging tools', 'Alchemy set', '50 crowns of components']
    },
    signs: false, magic: 'None', simulatedMagic: true
  }],
  ['criminal', {
    name: 'Criminal', summary: 'Thief, smuggler or assassin. Lives by not being where the trap is.',
    vigor: 0, coin: 100,
    defining: { name: 'Practiced Paranoia', effect: 'Senses traps and ambushes within 10 m.' },
    fixed: ['Sleight of Hand', 'Pick Lock', 'Streetwise', 'Forgery', 'Deceit', 'Stealth', 'Intimidation', 'Small Blades', 'Athletics', 'Awareness'],
    picks: [],
    focus: ['Stealth', 'Small Blades', 'Sleight of Hand', 'Athletics', 'Pick Lock'],
    pickups: ['Dodge / Escape', 'Crossbow', 'Brawling', 'Courage', 'Endurance'],
    statOrder: ['DEX', 'REF', 'INT', 'CRA', 'WILL', 'SPD', 'LUCK', 'EMP', 'BODY'],
    kit: {
      pick: 5, special: [],
      items: [
        { label: 'Loaded dice' }, { label: 'Bullseye lantern' }, { label: 'Secret pocket' }, { label: "Thieves' tools" },
        { label: 'Sleeve sheath' }, { label: 'Stiletto', weapon: 'stiletto' }, { label: 'Brass knuckles' },
        { label: 'Throwing knives x5' }, { label: 'Chloroform' }, { label: 'Satchel' }
      ],
      quick: ['Stiletto', "Thieves' tools", 'Throwing knives x5', 'Sleeve sheath', 'Satchel']
    },
    signs: false, magic: 'None', simulatedMagic: true
  }],
  ['doctor', {
    name: 'Doctor', summary: 'Surgeon or herbalist. The only person who can close a critical wound.',
    vigor: 0, coin: 150,
    defining: { name: 'Healing Hands', effect: 'The only way to treat a critical wound; also covers any First Aid task.' },
    fixed: ['Resist Coercion', 'Charisma', 'Social Etiquette', 'Courage', 'Human Perception', 'Wilderness Survival', 'Business', 'Deduction', 'Small Blades', 'Alchemy'],
    picks: [],
    focus: ['Healing Hands', 'Alchemy', 'Deduction', 'Small Blades', 'Courage'],
    pickups: ['First Aid', 'Dodge / Escape', 'Awareness', 'Endurance', 'Athletics'],
    statOrder: ['CRA', 'INT', 'WILL', 'EMP', 'REF', 'DEX', 'LUCK', 'BODY', 'SPD'],
    kit: {
      pick: 5, special: [],
      items: [
        { label: 'Clotting powder x10' }, { label: 'Sterilizing fluid x10' }, { label: 'Numbing herbs x10' },
        { label: "Surgeon's kit" }, { label: 'Writing kit' }, { label: 'Hourglass' }, { label: 'Candles x10' },
        { label: 'Blanket' }, { label: 'Large tent' }, { label: 'Dagger', weapon: 'dagger' }
      ],
      quick: ['Dagger', "Surgeon's kit", 'Clotting powder x10', 'Sterilizing fluid x10', 'Numbing herbs x10']
    },
    signs: false, magic: 'None', simulatedMagic: true
  }],
  ['mage', {
    name: 'Mage', summary: 'Academy-trained caster of spells, rituals and hexes.',
    vigor: 5, coin: 200,
    defining: { name: 'Magic Training', effect: 'Identifies magical phenomena; detects magic as a form of Awareness.' },
    fixed: ['Human Perception', 'Spell Casting', 'Hex Weaving', 'Resist Magic', 'Staff/Spear', 'Education', 'Ritual Crafting', 'Social Etiquette', 'Seduction', 'Grooming and Style'],
    picks: [],
    focus: ['Spell Casting', 'Magic Training', 'Resist Magic', 'Hex Weaving', 'Ritual Crafting'],
    pickups: ['Dodge / Escape', 'Awareness', 'Endurance', 'Courage', 'Resist Coercion'],
    statOrder: ['WILL', 'INT', 'REF', 'EMP', 'CRA', 'DEX', 'LUCK', 'BODY', 'SPD'],
    kit: {
      pick: 5, special: [],
      items: [
        { label: 'Hourglass' }, { label: 'Makeup kit' }, { label: 'Belt pouch' }, { label: 'Writing kit' },
        { label: 'Hand mirror' }, { label: 'Dagger', weapon: 'dagger' }, { label: 'Staff', weapon: 'staff' },
        { label: 'Garter sheath' }, { label: 'Journal' }, { label: '100 crowns of components' }
      ],
      quick: ['Staff', 'Dagger', 'Writing kit', 'Journal', '100 crowns of components']
    },
    signs: false, magic: 'Five novice spells, one ritual, one hex', simulatedMagic: false
  }],
  ['man-at-arms', {
    name: 'Man at Arms', summary: 'Soldier, guard or mercenary. Takes a beating and keeps standing.',
    vigor: 0, coin: 150,
    defining: { name: 'Tough As Nails', effect: 'Keeps fighting below zero Health on a roll against twice the negative Health.' },
    fixed: ['Wilderness Survival', 'Courage', 'Physique', 'Intimidation', 'Dodge / Escape'],
    picks: [{ id: 'combat', label: 'five combat skills', from: 'combat', count: 5, defaults: ['Swordsmanship', 'Melee', 'Staff/Spear', 'Crossbow', 'Brawling'] }],
    focus: ['Swordsmanship', 'Dodge / Escape', 'Tough As Nails', 'Physique', 'Melee'],
    pickups: ['Athletics', 'Awareness', 'Endurance', 'Tactics', 'Resist Coercion'],
    statOrder: ['REF', 'BODY', 'DEX', 'WILL', 'SPD', 'INT', 'LUCK', 'CRA', 'EMP'],
    kit: {
      pick: 5, special: [],
      items: [
        { label: 'Kord', weapon: 'kord' }, { label: 'Spear', weapon: 'spear' }, { label: 'Battle axe', weapon: 'battleAxe' },
        { label: 'Throwing knives x5' }, { label: 'Satchel' }, { label: 'Chain coif', armor: 'chainCoif' },
        { label: 'Brigandine', armor: 'brigandine' }, { label: 'Armored trousers', armor: 'armoredTrousers' },
        { label: 'Crossbow and bolts x20', weapon: 'crossbow' }, { label: 'Steel buckler' }
      ],
      quick: ['Kord', 'Chain coif', 'Brigandine', 'Armored trousers', 'Crossbow and bolts x20']
    },
    signs: false, magic: 'None', simulatedMagic: true
  }],
  ['merchant', {
    name: 'Merchant', summary: 'Trader on the long road. Knows the price of everything and the way out of town.',
    vigor: 0, coin: 180,
    defining: { name: 'Well Traveled', effect: 'Recalls facts about places, goods and cultures.' },
    fixed: ['Charisma', 'Small Blades', 'Education', 'Streetwise', 'Business', 'Persuasion', 'Human Perception', 'Gambling', 'Resist Coercion'],
    picks: [{ id: 'languages', label: 'two languages', from: 'languages', count: 2, defaults: ['Common Speech', 'Elder Speech'] }],
    focus: ['Business', 'Persuasion', 'Charisma', 'Well Traveled', 'Human Perception'],
    pickups: ['Dodge / Escape', 'Crossbow', 'Awareness', 'Athletics', 'Courage'],
    statOrder: ['EMP', 'INT', 'DEX', 'REF', 'WILL', 'LUCK', 'CRA', 'SPD', 'BODY'],
    kit: {
      pick: 3,
      special: [{ label: 'A mule and cart with 1000 crowns of everyday goods' }],
      items: [
        { label: 'Writing kit' }, { label: "Merchant's tools" }, { label: 'Large tent' }, { label: 'Journal' },
        { label: 'Crossbow and bolts x20', weapon: 'crossbow' }, { label: 'Dagger', weapon: 'dagger' }
      ],
      quick: ['Dagger', 'Crossbow and bolts x20', 'Writing kit']
    },
    signs: false, magic: 'None', simulatedMagic: true
  }],
  ['priest', {
    name: 'Priest', summary: 'Servant of the gods or of the old ways: healer, preacher, ritualist.',
    vigor: 2, coin: 75,
    defining: { name: 'Initiate of the Gods', effect: 'Finds shelter and aid at a temple of the same faith.' },
    fixed: ['Ritual Crafting', 'Leadership', 'Courage', 'Human Perception', 'Hex Weaving', 'First Aid', 'Charisma', 'Wilderness Survival', 'Teaching', 'Spell Casting'],
    picks: [],
    focus: ['Ritual Crafting', 'Leadership', 'Courage', 'Initiate of the Gods', 'Spell Casting'],
    pickups: ['Dodge / Escape', 'Staff/Spear', 'Awareness', 'Endurance', 'Resist Magic'],
    statOrder: ['WILL', 'EMP', 'INT', 'CRA', 'REF', 'BODY', 'LUCK', 'DEX', 'SPD'],
    kit: {
      pick: 5, special: [],
      items: [
        { label: 'Holy symbol' }, { label: 'Sterilizing fluid x5' }, { label: 'Alchemy set' }, { label: "Surgeon's kit" },
        { label: 'Hourglass' }, { label: 'Dagger', weapon: 'dagger' }, { label: 'Staff', weapon: 'staff' },
        { label: 'Clotting powder x5' }, { label: 'Numbing herbs x5' }, { label: '100 crowns of components' }
      ],
      quick: ['Staff', 'Dagger', 'Holy symbol', "Surgeon's kit", 'Clotting powder x5']
    },
    signs: false, magic: 'Two invocations, two rituals, two hexes', simulatedMagic: false
  }],
  ['witcher', {
    name: 'Witcher', summary: 'A professional monster hunter: swordsman, alchemist and a little bit of a mage.',
    vigor: 2, coin: 50,
    defining: { name: 'Witcher Training', effect: 'Halves hostile-environment penalties and stands in for Monster Lore.' },
    fixed: ['Awareness', 'Deduction', 'Spell Casting', 'Alchemy', 'Dodge / Escape', 'Wilderness Survival', 'Swordsmanship', 'Athletics', 'Stealth', 'Ride'],
    picks: [],
    focus: ['Swordsmanship', 'Dodge / Escape', 'Athletics', 'Alchemy', 'Spell Casting', 'Awareness', 'Stealth'],
    pickups: ['Crossbow', 'Endurance', 'Courage', 'Resist Magic', 'Brawling'],
    statOrder: ['REF', 'DEX', 'BODY', 'WILL', 'INT', 'SPD', 'CRA', 'LUCK', 'EMP'],
    kit: {
      pick: 2,
      special: [
        { label: 'Witcher medallion' },
        { label: "Witcher's steel sword", weapon: 'witchersSteel' },
        { label: "Witcher's silver sword", weapon: 'witchersSilver' },
        { label: 'Potion formulae x2' }, { label: 'Oil formulae x2' }, { label: 'Decoction formulae' }
      ],
      items: [
        { label: 'Alchemy set' }, { label: 'A horse' }, { label: 'Throwing knives x5' },
        { label: 'A hand crossbow', weapon: 'handCrossbow' }, { label: 'Double woven gambeson', armor: 'doubleWovenGambeson' }
      ],
      quick: ['A hand crossbow', 'Double woven gambeson']
    },
    signs: true, magic: 'All basic Signs', simulatedMagic: true
  }]
];

/**
 * Weapon traits by registry id: which skill wields it, and its price in crowns.
 *
 * Skill is weapon data, not a rule: a character sheet rolls the skill the weapon names, so an axe
 * uses Melee and a bow uses Archery. Weapons with no price cannot be bought.
 */
export const WEAPON_TRAITS: Record<string, { combatSkill: string; cost?: number }> = {
  ironLongSword: { combatSkill: 'Swordsmanship', cost: 160 },
  armingSword: { combatSkill: 'Swordsmanship', cost: 270 },
  gleddyf: { combatSkill: 'Swordsmanship', cost: 285 },
  falchion: { combatSkill: 'Swordsmanship', cost: 325 },
  krigsverd: { combatSkill: 'Swordsmanship', cost: 570 },
  esboda: { combatSkill: 'Swordsmanship', cost: 650 },
  kord: { combatSkill: 'Swordsmanship', cost: 725 },
  vicovarian: { combatSkill: 'Swordsmanship', cost: 955 },
  torrwr: { combatSkill: 'Swordsmanship', cost: 1075 },
  dagger: { combatSkill: 'Small Blades', cost: 50 },
  stiletto: { combatSkill: 'Small Blades', cost: 275 },
  poniard: { combatSkill: 'Small Blades', cost: 350 },
  jambiya: { combatSkill: 'Small Blades', cost: 440 },
  handAxe: { combatSkill: 'Melee', cost: 205 },
  battleAxe: { combatSkill: 'Melee', cost: 525 },
  berserkerAxe: { combatSkill: 'Melee', cost: 960 },
  mace: { combatSkill: 'Melee', cost: 525 },
  highlandMauler: { combatSkill: 'Melee', cost: 1100 },
  spear: { combatSkill: 'Staff/Spear', cost: 375 },
  poleAxe: { combatSkill: 'Staff/Spear', cost: 460 },
  redHalberd: { combatSkill: 'Staff/Spear', cost: 865 },
  staff: { combatSkill: 'Staff/Spear', cost: 335 },
  hookedStaff: { combatSkill: 'Staff/Spear', cost: 550 },
  ironStaff: { combatSkill: 'Staff/Spear', cost: 675 },
  crystalStaff: { combatSkill: 'Staff/Spear', cost: 835 },
  shortBow: { combatSkill: 'Archery', cost: 290 },
  longBow: { combatSkill: 'Archery', cost: 475 },
  warBow: { combatSkill: 'Archery', cost: 835 },
  handCrossbow: { combatSkill: 'Crossbow', cost: 285 },
  crossbow: { combatSkill: 'Crossbow', cost: 455 },
  monsterCrossbow: { combatSkill: 'Crossbow', cost: 1125 }
};

/** Weapons a profession hands out or sells that the registry does not already hold. */
const EXTRA_WEAPONS: Array<[string, Record<string, unknown>]> = [
  ['witchersSteel', {
    name: "Witcher's steel sword", combatSkill: 'Swordsmanship', type: 'S', wa: 0, damage: '4d6+2', rel: 15, hands: 2, range: 'melee',
    effects: ['ArmorPiercing', 'Meteorite']
  }],
  ['witchersSilver', {
    name: "Witcher's silver sword", combatSkill: 'Swordsmanship', type: 'S', wa: 0, damage: '1d6+2', silverDamage: '3d6', rel: 10, hands: 2, range: 'melee',
    effects: ['Silver']
  }],
  ['stiletto', {
    name: 'Stiletto', type: 'P', wa: 2, damage: '1d6', rel: 5, hands: 1, range: 'melee', effects: ['Concealment']
  }]
];

/** Armour by body slot. Torso armour covers the torso and both arms; leg armour covers both legs. */
const ARMOR: Array<[string, Row<ArmorRow>]> = [
  ['verdenArchersHood', { name: "Verden Archer's Hood", slot: 'head', tier: 'light', sp: 3, ev: 0, cost: 100 }],
  ['doubleWovenHood', { name: 'Double Woven Hood', slot: 'head', tier: 'light', sp: 5, ev: 0, cost: 175 }],
  ['spectacledHelm', { name: 'Spectacled Helm', slot: 'head', tier: 'light', sp: 8, ev: 0, cost: 200 }],
  ['chainCoif', { name: 'Chain Coif', slot: 'head', tier: 'medium', sp: 12, ev: 0, cost: 250 }],
  ['armoredHood', { name: 'Armored Hood', slot: 'head', tier: 'medium', sp: 14, ev: 0, cost: 350 }],
  ['temerianArmet', { name: 'Temerian Armet', slot: 'head', tier: 'medium', sp: 16, ev: 0, cost: 475 }],
  ['greatHelm', { name: 'Great Helm', slot: 'head', tier: 'heavy', sp: 20, ev: 0, cost: 575 }],
  ['skelligeHelm', { name: 'Skellige Helm', slot: 'head', tier: 'heavy', sp: 25, ev: 0, cost: 700 }],
  ['nilfgaardianHelm', { name: 'Nilfgaardian Helm', slot: 'head', tier: 'heavy', sp: 30, ev: 0, cost: 800 }],
  ['gambeson', { name: 'Gambeson', slot: 'torso', tier: 'light', sp: 3, ev: 0, cost: 100 }],
  ['aedirnianGambeson', { name: 'Aedirnian Gambeson', slot: 'torso', tier: 'light', sp: 5, ev: 0, cost: 175 }],
  ['doubleWovenGambeson', { name: 'Double Woven Gambeson', slot: 'torso', tier: 'light', sp: 8, ev: 0, cost: 250 }],
  ['brigandine', { name: 'Brigandine', slot: 'torso', tier: 'medium', sp: 12, ev: 1, cost: 300 }],
  ['redanianHalberdiersArmor', { name: "Redanian Halberdier's Armor", slot: 'torso', tier: 'medium', sp: 14, ev: 1, cost: 400 }],
  ['lyrianLeatherJacket', { name: 'Lyrian Leather Jacket', slot: 'torso', tier: 'medium', sp: 16, ev: 1, cost: 525 }],
  ['plateArmor', { name: 'Plate Armor', slot: 'torso', tier: 'heavy', sp: 20, ev: 2, cost: 625 }],
  ['hindarsfjallHeavyArmor', { name: 'Hindarsfjall Heavy Armor', slot: 'torso', tier: 'heavy', sp: 25, ev: 2, cost: 750 }],
  ['nilfgaardianPlateArmor', { name: 'Nilfgaardian Plate Armor', slot: 'torso', tier: 'heavy', sp: 30, ev: 2, cost: 850 }],
  ['cavalryTrousers', { name: 'Cavalry Trousers', slot: 'legs', tier: 'light', sp: 3, ev: 0, cost: 75 }],
  ['paddedTrousers', { name: 'Padded Trousers', slot: 'legs', tier: 'light', sp: 5, ev: 0, cost: 125 }],
  ['doubleWovenTrousers', { name: 'Double Woven Trousers', slot: 'legs', tier: 'light', sp: 8, ev: 0, cost: 225 }],
  ['armoredTrousers', { name: 'Armored Trousers', slot: 'legs', tier: 'medium', sp: 12, ev: 0, cost: 250 }],
  ['redanianGreaves', { name: 'Redanian Greaves', slot: 'legs', tier: 'medium', sp: 14, ev: 0, cost: 400 }],
  ['lyrianLeatherTrousers', { name: 'Lyrian Leather Trousers', slot: 'legs', tier: 'medium', sp: 16, ev: 0, cost: 525 }],
  ['plateGreaves', { name: 'Plate Greaves', slot: 'legs', tier: 'heavy', sp: 20, ev: 1, cost: 625 }],
  ['hindarsfjallHeavyChausses', { name: 'Hindarsfjall Heavy Chausses', slot: 'legs', tier: 'heavy', sp: 25, ev: 1, cost: 650 }],
  ['nilfgaardianGreaves', { name: 'Nilfgaardian Greaves', slot: 'legs', tier: 'heavy', sp: 30, ev: 1, cost: 850 }]
];

/** Suggested homelands for the region field. Free text is accepted too. */
export const REGION_SUGGESTIONS: readonly string[] = [
  'Temeria', 'Redania', 'Kaedwen', 'Aedirn', 'Cintra', 'Nilfgaard', 'Skellige', 'Mahakam',
  'Dol Blathanna', 'Zerrikania', 'Toussaint', 'Kovir and Poviss'
];

/** Stat ids, for callers that only need the type. */
export type { StatId };

/** Registers skills, races, professions, armour, and the weapons a profession issues. */
export function registerCharacterCreationContent(registry: RegistryHub): void {
  for (const row of SKILLS) {
    const id = skillId(row.name);
    if (!registry.creationSkills.has(id)) registry.add('creationSkills', id, row);
  }
  for (const [id, row] of RACES) if (!registry.races.has(id)) registry.add('races', id, row);
  for (const [id, row] of PROFESSIONS) if (!registry.professions.has(id)) registry.add('professions', id, row);
  for (const [id, row] of ARMOR) if (!registry.armorPieces.has(id)) registry.add('armorPieces', id, row);
  for (const [id, row] of EXTRA_WEAPONS) {
    if (!registry.weapons.has(id)) registry.add('weapons', id, { ...row, ...(WEAPON_TRAITS[id] ?? {}) });
  }
}

/** Stable registry id for a skill name. */
export function skillId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
