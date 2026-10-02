/**
 * Core bestiary stat blocks.
 *
 * Every row carries the ten statistics, the derived values (STA, REC, HP, RUN, LEAP, ENC, VIGOR),
 * armour, the skill list, and the weapons table with its damage, effect, and ROF.
 *
 * These rows are *overlaid* onto the profiles in `witcherData.ts` at registration. The split is
 * deliberate and load-bearing:
 *
 * - the numbers a stat block carries live here;
 * - what a stat block does not carry — family grouping, AI profile, loot tables, silver
 *   vulnerability, engine-specific flags — stays in `witcherData.ts`.
 *
 * So a wrong number is either a data bug or a project choice, and you can always tell which file
 * to look in.
 *
 * ## Derived combat values
 *
 * Monsters have skills, not to-hit numbers: an attack is `stat + skill + 1d10`. So `attack` is REF
 * plus the skill that weapon uses, `dodgeDefense` is REF + Dodge/Escape, `blockDefense` is REF +
 * Melee or Brawling, and `magicDefense` is WILL + Resist Magic. All four are computed from the
 * skills, never guessed.
 *
 * `sta: null` is not missing data — a construct does not tire, so it has no Stamina.
 */

/** One attack from a creature's weapons table. */
export interface CoreAttack {
  name: string;
  /** REF + the skill this weapon uses. */
  attack: number;
  /** `S`, `P`, or `B`. */
  type: string;
  damage: string;
  /** Metres. Melee reach is 2 unless the effect text gives a range. */
  range: number;
  /** The weapon's effect text. Empty where there is none. */
  effect: string;
  rof: number;
}

/** One creature's stat block. */
export interface CoreStatBlock {
  stats: Record<string, number>;
  hp: number;
  /** `null` for a creature that does not tire. */
  sta: number | null;
  rec: number;
  vigor: number;
  armor: number;
  run: number;
  leap: number;
  enc: number;
  bounty: number;
  skills: Record<string, number>;
  attacks: CoreAttack[];
  dodgeDefense: number;
  blockDefense: number;
  magicDefense: number;
}

/** Stat blocks, keyed by the simulator's bestiary id. */
export const CORE_BESTIARY_STATS: Record<string, CoreStatBlock> = 
{
  mage: {
    stats: {
      INT: 7,
      REF: 7,
      DEX: 6,
      BODY: 5,
      SPD: 5,
      EMP: 4,
      CRA: 5,
      WILL: 8,
      LUCK: 0,
      STUN: 7
    },
    hp: 30,
    sta: 30,
    rec: 7,
    vigor: 10,
    armor: 0,
    run: 15,
    leap: 3,
    enc: 50,
    bounty: 100,
    skills: {
      "Staff/Spear": 6,
      "Spell Casting": 7,
      "Hex Weaving": 6,
      "Ritual Crafting": 5,
      "Dodge/Escape": 8,
      Athletics: 5,
      Awareness: 7,
      Stealth: 5,
      "Wilderness Survival": 5,
      "Resist Magic": 7,
      "Resist Coercion": 7,
      Endurance: 5,
      Courage: 6
    },
    attacks: [
      {
        name: "Iron staff",
        attack: 13,
        type: "B",
        damage: "3d6",
        range: 2,
        effect: "Focus (2)",
        rof: 2
      },
      {
        name: "Dagger",
        attack: 7,
        type: "P",
        damage: "1d6",
        range: 2,
        effect: "",
        rof: 2
      }
    ],
    dodgeDefense: 15,
    blockDefense: 7,
    magicDefense: 15
  },
  scoiatael: {
    stats: {
      INT: 4,
      REF: 6,
      DEX: 7,
      BODY: 5,
      SPD: 7,
      EMP: 3,
      CRA: 4,
      WILL: 6,
      LUCK: 0,
      STUN: 5
    },
    hp: 25,
    sta: 25,
    rec: 5,
    vigor: 0,
    armor: 5,
    run: 21,
    leap: 4,
    enc: 50,
    bounty: 20,
    skills: {
      Archery: 8,
      Swordsmanship: 6,
      "Small Blades": 6,
      Brawling: 4,
      "Dodge/Escape": 7,
      Athletics: 7,
      Awareness: 9,
      Stealth: 8,
      "Wilderness Survival": 10,
      "Resist Magic": 4,
      "Resist Coercion": 6,
      Endurance: 7,
      Courage: 6
    },
    attacks: [
      {
        name: "Hunter\u2019s falchion",
        attack: 12,
        type: "S",
        damage: "3d6",
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Dagger",
        attack: 12,
        type: "P",
        damage: "1d6",
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Throwing knives",
        attack: 12,
        type: "P",
        damage: "1d6",
        range: 24,
        effect: "RNG: 24m",
        rof: 1
      },
      {
        name: "Longbow",
        attack: 14,
        type: "P",
        damage: "4d6",
        range: 200,
        effect: "RNG: 200m",
        rof: 1
      }
    ],
    dodgeDefense: 13,
    blockDefense: 10,
    magicDefense: 10
  },
  drowner: {
    stats: {
      INT: 1,
      REF: 7,
      DEX: 7,
      BODY: 6,
      SPD: 6,
      EMP: 1,
      CRA: 1,
      WILL: 4,
      LUCK: 0,
      STUN: 5
    },
    hp: 25,
    sta: 25,
    rec: 5,
    vigor: 0,
    armor: 0,
    run: 18,
    leap: 3,
    enc: 60,
    bounty: 10,
    skills: {
      Melee: 6,
      Brawling: 6,
      "Dodge/Escape": 5,
      Athletics: 6,
      Awareness: 8,
      Stealth: 5,
      "Wilderness Survival": 6,
      "Resist Magic": 4,
      Endurance: 6,
      Courage: 8
    },
    attacks: [
      {
        name: "Claws",
        attack: 13,
        type: "S",
        damage: "3d6",
        range: 2,
        effect: "",
        rof: 1
      }
    ],
    dodgeDefense: 12,
    blockDefense: 13,
    magicDefense: 8
  },
  ghoul: {
    stats: {
      INT: 1,
      REF: 6,
      DEX: 7,
      BODY: 6,
      SPD: 6,
      EMP: 1,
      CRA: 1,
      WILL: 5,
      LUCK: 0,
      STUN: 5
    },
    hp: 25,
    sta: 25,
    rec: 5,
    vigor: 0,
    armor: 0,
    run: 21,
    leap: 4,
    enc: 60,
    bounty: 30,
    skills: {
      Melee: 6,
      Brawling: 6,
      "Dodge/Escape": 6,
      Athletics: 7,
      Awareness: 7,
      Stealth: 4,
      "Wilderness Survival": 6,
      "Resist Magic": 4,
      Endurance: 6,
      Courage: 7
    },
    attacks: [
      {
        name: "Claws",
        attack: 12,
        type: "S",
        damage: "3d6",
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Bite",
        attack: 12,
        type: "P",
        damage: "3d6+2",
        range: 2,
        effect: "Bleed (25%)",
        rof: 1
      }
    ],
    dodgeDefense: 12,
    blockDefense: 12,
    magicDefense: 9
  },
  gravehag: {
    stats: {
      INT: 6,
      REF: 10,
      DEX: 10,
      BODY: 7,
      SPD: 7,
      EMP: 3,
      CRA: 3,
      WILL: 6,
      LUCK: 0,
      STUN: 6
    },
    hp: 60,
    sta: 30,
    rec: 6,
    vigor: 0,
    armor: 0,
    run: 21,
    leap: 4,
    enc: 70,
    bounty: 500,
    skills: {
      Melee: 8,
      Brawling: 6,
      "Dodge/Escape": 8,
      Athletics: 6,
      Awareness: 8,
      Stealth: 8,
      "Wilderness Survival": 6,
      "Resist Magic": 10,
      "Resist Coercion": 10,
      Endurance: 7,
      Courage: 9
    },
    attacks: [
      {
        name: "Claws",
        attack: 16,
        type: "S",
        damage: "5d6",
        range: 2,
        effect: "Bleed (50%)",
        rof: 2
      },
      {
        name: "Bite",
        attack: 16,
        type: "P",
        damage: "6d6",
        range: 2,
        effect: "Poison (75%)",
        rof: 1
      },
      {
        name: "Tongue",
        attack: 16,
        type: "P",
        damage: "3d6+2",
        range: 2,
        effect: "Poison (100%)",
        rof: 1
      }
    ],
    dodgeDefense: 18,
    blockDefense: 18,
    magicDefense: 16
  },
  wraith: {
    stats: {
      INT: 4,
      REF: 6,
      DEX: 5,
      BODY: 5,
      SPD: 5,
      EMP: 1,
      CRA: 1,
      WILL: 6,
      LUCK: 0,
      STUN: 5
    },
    hp: 25,
    sta: 25,
    rec: 5,
    vigor: 0,
    armor: 0,
    run: 15,
    leap: 3,
    enc: 50,
    bounty: 30,
    skills: {
      Swordsmanship: 7,
      Melee: 6,
      Brawling: 6,
      "Dodge/Escape": 6,
      Athletics: 5,
      Awareness: 8,
      Stealth: 9,
      "Wilderness Survival": 6,
      "Resist Magic": 6,
      Endurance: 7
    },
    attacks: [
      {
        name: "Wraith sword",
        attack: 13,
        type: "S",
        damage: "3d6",
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Wraith lantern",
        attack: 12,
        type: "B",
        damage: "2d6+2",
        range: 2,
        effect: "Fire (25%)",
        rof: 1
      }
    ],
    dodgeDefense: 12,
    blockDefense: 12,
    magicDefense: 12
  },
  noonwraith: {
    stats: {
      INT: 5,
      REF: 8,
      DEX: 6,
      BODY: 7,
      SPD: 6,
      EMP: 1,
      CRA: 1,
      WILL: 9,
      LUCK: 0,
      STUN: 6
    },
    hp: 60,
    sta: 30,
    rec: 6,
    vigor: 0,
    armor: 0,
    run: 18,
    leap: 3,
    enc: 70,
    bounty: 800,
    skills: {
      "Spell Casting": 8,
      Melee: 8,
      Brawling: 7,
      "Dodge/Escape": 9,
      Athletics: 4,
      Awareness: 10,
      Stealth: 10,
      "Wilderness Survival": 5,
      "Resist Magic": 7,
      Endurance: 7
    },
    attacks: [
      {
        name: "Claws",
        attack: 15,
        type: "S",
        damage: "5d6",
        range: 2,
        effect: "",
        rof: 2
      }
    ],
    dodgeDefense: 17,
    blockDefense: 16,
    magicDefense: 16
  },
  werewolf: {
    stats: {
      INT: 6,
      REF: 8,
      DEX: 8,
      BODY: 7,
      SPD: 9,
      EMP: 1,
      CRA: 3,
      WILL: 5,
      LUCK: 0,
      STUN: 6
    },
    hp: 60,
    sta: 30,
    rec: 6,
    vigor: 0,
    armor: 8,
    run: 27,
    leap: 5,
    enc: 70,
    bounty: 500,
    skills: {
      Melee: 9,
      Brawling: 8,
      "Dodge/Escape": 8,
      Athletics: 8,
      Awareness: 10,
      Stealth: 9,
      "Wilderness Survival": 9,
      "Resist Magic": 9,
      "Resist Coercion": 10,
      Endurance: 8,
      Courage: 10,
      Reflex: 2,
      Body: 3,
      Speed: 4
    },
    attacks: [
      {
        name: "Claws",
        attack: 16,
        type: "S",
        damage: "4d6+2",
        range: 2,
        effect: "Bleed (25%)",
        rof: 2
      },
      {
        name: "Bite",
        attack: 16,
        type: "P",
        damage: "5d6",
        range: 2,
        effect: "Bleed (75%)",
        rof: 1
      }
    ],
    dodgeDefense: 16,
    blockDefense: 17,
    magicDefense: 14
  },
  siren: {
    stats: {
      INT: 3,
      REF: 7,
      DEX: 7,
      BODY: 6,
      SPD: 8,
      EMP: 3,
      CRA: 3,
      WILL: 8,
      LUCK: 0,
      STUN: 7
    },
    hp: 35,
    sta: 35,
    rec: 7,
    vigor: 0,
    armor: 0,
    run: 24,
    leap: 4,
    enc: 60,
    bounty: 20,
    skills: {
      Melee: 7,
      Brawling: 7,
      "Dodge/Escape": 6,
      Athletics: 8,
      Awareness: 7,
      Stealth: 8,
      "Wilderness Survival": 7,
      "Resist Magic": 6,
      "Resist Coercion": 6,
      Endurance: 6,
      Courage: 5
    },
    attacks: [
      {
        name: "Claws",
        attack: 14,
        type: "S",
        damage: "2d6+2",
        range: 2,
        effect: "+1 ACC",
        rof: 1
      },
      {
        name: "Tail",
        attack: 14,
        type: "B",
        damage: "3d6+2",
        range: 2,
        effect: "",
        rof: 1
      }
    ],
    dodgeDefense: 13,
    blockDefense: 14,
    magicDefense: 14
  },
  griffin: {
    stats: {
      INT: 1,
      REF: 10,
      DEX: 10,
      BODY: 15,
      SPD: 6,
      EMP: 1,
      CRA: 1,
      WILL: 5,
      LUCK: 0,
      STUN: 10
    },
    hp: 100,
    sta: 50,
    rec: 10,
    vigor: 0,
    armor: 8,
    run: 18,
    leap: 3,
    enc: 150,
    bounty: 1200,
    skills: {
      Melee: 9,
      Brawling: 7,
      "Dodge/Escape": 7,
      Athletics: 7,
      Awareness: 10,
      Stealth: 4,
      "Wilderness Survival": 8,
      "Resist Magic": 9,
      Endurance: 3,
      Courage: 10
    },
    attacks: [
      {
        name: "Claws",
        attack: 17,
        type: "S",
        damage: "6d6",
        range: 2,
        effect: "",
        rof: 2
      },
      {
        name: "Bite",
        attack: 17,
        type: "P",
        damage: "7d6+2",
        range: 2,
        effect: "Bleed (50%)",
        rof: 1
      }
    ],
    dodgeDefense: 17,
    blockDefense: 19,
    magicDefense: 14
  },
  endrega: {
    stats: {
      INT: 1,
      REF: 6,
      DEX: 7,
      BODY: 8,
      SPD: 7,
      EMP: 1,
      CRA: 1,
      WILL: 6,
      LUCK: 0,
      STUN: 7
    },
    hp: 35,
    sta: 35,
    rec: 7,
    vigor: 0,
    armor: 8,
    run: 21,
    leap: 4,
    enc: 80,
    bounty: 30,
    skills: {
      Melee: 6,
      Brawling: 5,
      "Dodge/Escape": 6,
      Athletics: 5,
      Awareness: 5,
      Stealth: 7,
      "Wilderness Survival": 6,
      "Resist Magic": 6,
      Endurance: 6,
      Courage: 5
    },
    attacks: [
      {
        name: "Claws",
        attack: 11,
        type: "S",
        damage: "3d6",
        range: 2,
        effect: "",
        rof: 1
      }
    ],
    dodgeDefense: 12,
    blockDefense: 12,
    magicDefense: 12
  },
  arachas: {
    stats: {
      INT: 1,
      REF: 9,
      DEX: 6,
      BODY: 13,
      SPD: 5,
      EMP: 1,
      CRA: 1,
      WILL: 5,
      LUCK: 0,
      STUN: 9
    },
    hp: 90,
    sta: 45,
    rec: 9,
    vigor: 0,
    armor: 20,
    run: 15,
    leap: 3,
    enc: 130,
    bounty: 1000,
    skills: {
      Melee: 5,
      Brawling: 5,
      "Dodge/Escape": 8,
      Athletics: 5,
      Awareness: 6,
      Stealth: 6,
      "Wilderness Survival": 4,
      "Resist Magic": 9,
      Endurance: 5,
      Courage: 10
    },
    attacks: [
      {
        name: "Claws",
        attack: 14,
        type: "S",
        damage: "5d6",
        range: 2,
        effect: "Poison (25%)",
        rof: 2
      }
    ],
    dodgeDefense: 17,
    blockDefense: 14,
    magicDefense: 14
  },
  golem: {
    stats: {
      INT: 1,
      REF: 10,
      DEX: 6,
      BODY: 13,
      SPD: 4,
      EMP: 1,
      CRA: 1,
      WILL: 4,
      LUCK: 0,
      STUN: 8
    },
    hp: 80,
    sta: null,
    rec: 8,
    vigor: 0,
    armor: 20,
    run: 12,
    leap: 2,
    enc: 130,
    bounty: 1200,
    skills: {
      Brawling: 5,
      "Dodge/Escape": 4,
      Athletics: 2,
      Awareness: 8,
      Stealth: 2,
      "Wilderness Survival": 4,
      "Resist Magic": 10,
      Physique: 10
    },
    attacks: [
      {
        name: "Punch",
        attack: 15,
        type: "B",
        damage: "8d6",
        range: 2,
        effect: "",
        rof: 1
      }
    ],
    dodgeDefense: 14,
    blockDefense: 15,
    magicDefense: 14
  },
  fiend: {
    stats: {
      INT: 1,
      REF: 13,
      DEX: 10,
      BODY: 15,
      SPD: 7,
      EMP: 1,
      CRA: 1,
      WILL: 9,
      LUCK: 0,
      STUN: 11
    },
    hp: 110,
    sta: 55,
    rec: 11,
    vigor: 0,
    armor: 10,
    run: 21,
    leap: 4,
    enc: 150,
    bounty: 1500,
    skills: {
      Melee: 9,
      Brawling: 8,
      "Dodge/Escape": 7,
      Athletics: 5,
      Awareness: 10,
      Stealth: 1,
      "Wilderness Survival": 6,
      "Resist Magic": 10,
      Endurance: 7,
      Courage: 10,
      Physique: 10
    },
    attacks: [
      {
        name: "Claws",
        attack: 21,
        type: "S",
        damage: "6d6+2",
        range: 2,
        effect: "",
        rof: 2
      },
      {
        name: "Bite",
        attack: 21,
        type: "P",
        damage: "7d6",
        range: 2,
        effect: "Bleed (50%)",
        rof: 1
      },
      {
        name: "Horns",
        attack: 21,
        type: "P",
        damage: "8d6",
        range: 2,
        effect: "-1 ACC",
        rof: 1
      }
    ],
    dodgeDefense: 20,
    blockDefense: 22,
    magicDefense: 19
  },
  nekker: {
    stats: {
      INT: 2,
      REF: 5,
      DEX: 7,
      BODY: 3,
      SPD: 6,
      EMP: 2,
      CRA: 2,
      WILL: 4,
      LUCK: 0,
      STUN: 3
    },
    hp: 15,
    sta: 15,
    rec: 3,
    vigor: 0,
    armor: 0,
    run: 18,
    leap: 3,
    enc: 30,
    bounty: 10,
    skills: {
      Melee: 5,
      Brawling: 5,
      "Dodge/Escape": 6,
      Athletics: 7,
      Awareness: 8,
      Stealth: 8,
      "Wilderness Survival": 8,
      "Resist Magic": 4,
      "Resist Coercion": 9,
      Endurance: 6,
      Courage: 6
    },
    attacks: [
      {
        name: "Claws",
        attack: 10,
        type: "S",
        damage: "2d6",
        range: 2,
        effect: "",
        rof: 1
      }
    ],
    dodgeDefense: 11,
    blockDefense: 10,
    magicDefense: 8
  },
  rocktroll: {
    stats: {
      INT: 3,
      REF: 8,
      DEX: 7,
      BODY: 12,
      SPD: 4,
      EMP: 6,
      CRA: 7,
      WILL: 4,
      LUCK: 0,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    vigor: 0,
    armor: 20,
    run: 12,
    leap: 2,
    enc: 120,
    bounty: 800,
    skills: {
      Brawling: 8,
      "Dodge/Escape": 5,
      Athletics: 3,
      Awareness: 9,
      Stealth: 3,
      "Wilderness Survival": 7,
      "Resist Magic": 8,
      "Resist Coercion": 6,
      Endurance: 8,
      Courage: 10
    },
    attacks: [
      {
        name: "Punch",
        attack: 16,
        type: "B",
        damage: "6d6",
        range: 2,
        effect: "",
        rof: 2
      }
    ],
    dodgeDefense: 13,
    blockDefense: 16,
    magicDefense: 12
  },
  wyvern: {
    stats: {
      INT: 1,
      REF: 10,
      DEX: 10,
      BODY: 10,
      SPD: 7,
      EMP: 1,
      CRA: 1,
      WILL: 6,
      LUCK: 0,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    vigor: 0,
    armor: 10,
    run: 21,
    leap: 4,
    enc: 100,
    bounty: 1000,
    skills: {
      Melee: 8,
      Brawling: 7,
      "Dodge/Escape": 6,
      Athletics: 8,
      Awareness: 10,
      Stealth: 6,
      "Wilderness Survival": 9,
      "Resist Magic": 8,
      Endurance: 8,
      Courage: 8
    },
    attacks: [
      {
        name: "Claws",
        attack: 17,
        type: "S",
        damage: "6d6",
        range: 2,
        effect: "",
        rof: 2
      },
      {
        name: "Bite",
        attack: 17,
        type: "P",
        damage: "7d6",
        range: 2,
        effect: "Poison (25%)",
        rof: 1
      },
      {
        name: "Tail barbs",
        attack: 17,
        type: "S",
        damage: "5d6+2",
        range: 2,
        effect: "Poison (75%)",
        rof: 1
      }
    ],
    dodgeDefense: 16,
    blockDefense: 18,
    magicDefense: 14
  },
  katakan: {
    stats: {
      INT: 6,
      REF: 14,
      DEX: 12,
      BODY: 8,
      SPD: 10,
      EMP: 3,
      CRA: 3,
      WILL: 8,
      LUCK: 0,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    vigor: 0,
    armor: 0,
    run: 30,
    leap: 6,
    enc: 80,
    bounty: 1500,
    skills: {
      Melee: 8,
      Brawling: 7,
      "Dodge/Escape": 10,
      Athletics: 10,
      Awareness: 10,
      Stealth: 10,
      "Wilderness Survival": 8,
      "Resist Magic": 8,
      "Resist Coercion": 10,
      Endurance: 8,
      Courage: 8,
      Intimidate: 8
    },
    attacks: [
      {
        name: "Claws",
        attack: 21,
        type: "S",
        damage: "6d6",
        range: 2,
        effect: "Bleed (50%)",
        rof: 2
      },
      {
        name: "Bite",
        attack: 21,
        type: "P",
        damage: "7d6+2",
        range: 2,
        effect: "Bleed (100%)",
        rof: 1
      }
    ],
    dodgeDefense: 24,
    blockDefense: 22,
    magicDefense: 16
  }
};
