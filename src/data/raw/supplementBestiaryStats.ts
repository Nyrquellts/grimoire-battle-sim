/**
 * Supplement bestiary stat blocks.
 *
 * A supplement block is richer than a core block: `Dodge Base`, `Reposition Base` and `Block Base`
 * are given outright, and each attack carries its own `ATK Base`, reliability, range and ROF. So
 * unlike `coreBestiaryStats.ts`, nothing here is derived.
 *
 * Supplement blocks carry no skill lists, which is why these rows have none.
 *
 * `attacks: []` on the core animals is deliberate. Their rows share one weapons table between two
 * creatures, so their stats are carried here and their attacks are left to the profile in
 * `witcherData.ts`.
 */

/** One attack from a supplement stat block. */
export interface SupplementAttack {
  name: string;
  /** The ATK base. */
  attack: number;
  type: string;
  damage: string;
  /** Reliability, where one is given. */
  rel: number | null;
  /** Metres; melee reach is 2. */
  range: number;
  effect: string;
  rof: number;
}

/** One creature's stat block. */
export interface SupplementStatBlock {
  stats: Record<string, number>;
  hp: number;
  sta: number | null;
  rec: number | null;
  run: number | null;
  leap: number | null;
  enc: number | null;
  armor: number;
  regen: number;
  dodgeDefense: number | null;
  repositionDefense: number | null;
  blockDefense: number | null;
  resistances: string[];
  immunities: string[];
  attacks: SupplementAttack[];
  /** Present only for the core animals, which carry a skill list. */
  skills?: Record<string, number>;
}

/** Stat blocks, keyed by the simulator's bestiary id. */
export const SUPPLEMENT_BESTIARY_STATS: Record<string, SupplementStatBlock> = 
{
  bullvore: {
    stats: {
      INT: 2,
      REF: 5,
      DEX: 4,
      BODY: 12,
      SPD: 3,
      EMP: 1,
      CRA: 2,
      WILL: 6,
      STUN: 9
    },
    hp: 90,
    sta: 45,
    rec: 9,
    run: 9,
    leap: 1,
    enc: 120,
    armor: 8,
    regen: 4,
    dodgeDefense: 13,
    repositionDefense: 10,
    blockDefense: 14,
    resistances: [],
    immunities: [
      "Poison",
      "Bleeding"
    ],
    attacks: [
      {
        name: "Claw Slash",
        attack: 14,
        type: "S",
        damage: "3d6+3",
        rel: 15,
        range: 2,
        effect: "",
        rof: 2
      },
      {
        name: "Horn Gore",
        attack: 14,
        type: "P",
        damage: "5d6",
        rel: 15,
        range: 2,
        effect: "Bleed (50%)",
        rof: 1
      }
    ]
  },
  foglet: {
    stats: {
      INT: 5,
      REF: 8,
      DEX: 8,
      BODY: 7,
      SPD: 6,
      EMP: 3,
      CRA: 3,
      WILL: 6,
      STUN: 6
    },
    hp: 60,
    sta: 30,
    rec: 6,
    run: 18,
    leap: 3,
    enc: 70,
    armor: 0,
    regen: 0,
    dodgeDefense: 15,
    repositionDefense: 16,
    blockDefense: 15,
    resistances: [],
    immunities: [],
    attacks: [
      {
        name: "Claw Slash",
        attack: 15,
        type: "S",
        damage: "3d6+2",
        rel: 10,
        range: 2,
        effect: "",
        rof: 2
      }
    ]
  },
  rotfiend: {
    stats: {
      INT: 1,
      REF: 6,
      DEX: 6,
      BODY: 5,
      SPD: 11,
      EMP: 1,
      CRA: 1,
      WILL: 5,
      STUN: 5
    },
    hp: 25,
    sta: 25,
    rec: 5,
    run: 33,
    leap: 6,
    enc: 50,
    armor: 0,
    regen: 0,
    dodgeDefense: 12,
    repositionDefense: 12,
    blockDefense: 12,
    resistances: [],
    immunities: [
      "Poison",
      "Bleeding"
    ],
    attacks: [
      {
        name: "Claw Slash",
        attack: 12,
        type: "S",
        damage: "3d6",
        rel: 10,
        range: 2,
        effect: "",
        rof: 1
      }
    ]
  },
  barghest: {
    stats: {
      INT: 1,
      REF: 5,
      DEX: 7,
      BODY: 5,
      SPD: 8,
      EMP: 1,
      CRA: 1,
      WILL: 5,
      STUN: 5
    },
    hp: 25,
    sta: 25,
    rec: 5,
    run: 24,
    leap: 4,
    enc: 50,
    armor: 0,
    regen: 5,
    dodgeDefense: 11,
    repositionDefense: 13,
    blockDefense: 12,
    resistances: [],
    immunities: [
      "Poison",
      "Fire",
      "Fear",
      "Disease"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 12,
        type: "P",
        damage: "2d6",
        rel: 15,
        range: 2,
        effect: "",
        rof: 1
      }
    ]
  },
  hym: {
    stats: {
      INT: 7,
      REF: 5,
      DEX: 4,
      BODY: 7,
      SPD: 5,
      EMP: 3,
      CRA: 1,
      WILL: 12,
      STUN: 9
    },
    hp: 90,
    sta: 45,
    rec: 9,
    run: 15,
    leap: 3,
    enc: 70,
    armor: 0,
    regen: 5,
    dodgeDefense: 16,
    repositionDefense: 17,
    blockDefense: 16,
    resistances: [],
    immunities: [
      "Bleeding",
      "Freeze",
      "Poison"
    ],
    attacks: [
      {
        name: "Claw Slash",
        attack: 16,
        type: "S",
        damage: "5d6",
        rel: null,
        range: 2,
        effect: "Long Reach, Shadow Claws",
        rof: 2
      }
    ]
  },
  pesta: {
    stats: {
      INT: 5,
      REF: 8,
      DEX: 6,
      BODY: 7,
      SPD: 7,
      EMP: 1,
      CRA: 1,
      WILL: 9,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    run: 21,
    leap: 4,
    enc: 70,
    armor: 0,
    regen: 0,
    dodgeDefense: 18,
    repositionDefense: 16,
    blockDefense: 16,
    resistances: [],
    immunities: [
      "Incorporeal",
      "Bleed",
      "Poison"
    ],
    attacks: [
      {
        name: "Claw Slash",
        attack: 16,
        type: "S",
        damage: "4d6",
        rel: 10,
        range: 2,
        effect: "Disease (50%)",
        rof: 2
      }
    ]
  },
  bear: {
    stats: {
      INT: 1,
      REF: 7,
      DEX: 6,
      BODY: 12,
      SPD: 7,
      EMP: 1,
      CRA: 1,
      WILL: 5,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    run: 21,
    leap: 4,
    enc: 120,
    armor: 10,
    regen: 0,
    dodgeDefense: 13,
    repositionDefense: 10,
    blockDefense: 15,
    resistances: [
      "Bludgeoning"
    ],
    immunities: [],
    attacks: [
      {
        name: "Bite",
        attack: 15,
        type: "P",
        damage: "8d6",
        rel: 15,
        range: 2,
        effect: "Crushing Force, Bleed (75%)",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 15,
        type: "S",
        damage: "4d6+5",
        rel: 15,
        range: 2,
        effect: "Crushing Force",
        rof: 2
      }
    ]
  },
  boar: {
    stats: {
      INT: 1,
      REF: 5,
      DEX: 4,
      BODY: 8,
      SPD: 5,
      EMP: 1,
      CRA: 1,
      WILL: 6,
      STUN: 7
    },
    hp: 35,
    sta: 35,
    rec: 7,
    run: 15,
    leap: 3,
    enc: 80,
    armor: 5,
    regen: 0,
    dodgeDefense: 10,
    repositionDefense: 8,
    blockDefense: 11,
    resistances: [],
    immunities: [],
    attacks: [
      {
        name: "Tusk Gore",
        attack: 11,
        type: "P",
        damage: "3d6",
        rel: 15,
        range: 2,
        effect: "Bleeding (30%)",
        rof: 1
      }
    ]
  },
  panther: {
    stats: {
      INT: 1,
      REF: 7,
      DEX: 7,
      BODY: 5,
      SPD: 8,
      EMP: 1,
      CRA: 1,
      WILL: 6,
      STUN: 5
    },
    hp: 25,
    sta: 25,
    rec: 5,
    run: 24,
    leap: 4,
    enc: 50,
    armor: 0,
    regen: 0,
    dodgeDefense: 12,
    repositionDefense: 16,
    blockDefense: 15,
    resistances: [],
    immunities: [],
    attacks: [
      {
        name: "Bite",
        attack: 15,
        type: "P",
        damage: "4d6+4",
        rel: 10,
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 15,
        type: "S",
        damage: "2d6+2",
        rel: 10,
        range: 2,
        effect: "Bleed (30%)",
        rof: 2
      }
    ]
  },
  archespore: {
    stats: {
      INT: 1,
      REF: 6,
      DEX: 5,
      BODY: 5,
      SPD: 6,
      EMP: 1,
      CRA: 1,
      WILL: 5,
      STUN: 5
    },
    hp: 25,
    sta: 25,
    rec: 5,
    run: 18,
    leap: null,
    enc: 5,
    armor: 0,
    regen: 0,
    dodgeDefense: 12,
    repositionDefense: 17,
    blockDefense: 12,
    resistances: [],
    immunities: [
      "Poison"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 12,
        type: "P",
        damage: "2d6+2",
        rel: 10,
        range: 2,
        effect: "Long Reach",
        rof: 1
      }
    ]
  },
  botchling: {
    stats: {
      INT: 1,
      REF: 8,
      DEX: 9,
      BODY: 5,
      SPD: 7,
      EMP: 1,
      CRA: 1,
      WILL: 8,
      STUN: 6
    },
    hp: 60,
    sta: 30,
    rec: 6,
    run: 21,
    leap: 4,
    enc: 50,
    armor: 0,
    regen: 0,
    dodgeDefense: 16,
    repositionDefense: 17,
    blockDefense: 16,
    resistances: [],
    immunities: [],
    attacks: [
      {
        name: "Bite",
        attack: 16,
        type: "P",
        damage: "3d6",
        rel: 10,
        range: 2,
        effect: "Improved Armor Piercing, Drain Blood",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 16,
        type: "S",
        damage: "5d6+4",
        rel: 15,
        range: 2,
        effect: "",
        rof: 2
      }
    ]
  },
  vendigo: {
    stats: {
      INT: 5,
      REF: 9,
      DEX: 11,
      BODY: 10,
      SPD: 9,
      EMP: 1,
      CRA: 2,
      WILL: 10,
      STUN: 10
    },
    hp: 100,
    sta: 50,
    rec: 10,
    run: 27,
    leap: 5,
    enc: 100,
    armor: 10,
    regen: 0,
    dodgeDefense: 16,
    repositionDefense: 19,
    blockDefense: 20,
    resistances: [],
    immunities: [
      "Charm",
      "Freeze",
      "Disease"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 20,
        type: "P",
        damage: "7d6",
        rel: 15,
        range: 2,
        effect: "Disease (60%)",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 20,
        type: "S",
        damage: "5d6+4",
        rel: 15,
        range: 2,
        effect: "Bleed (50%), Disease (25%)",
        rof: 2
      }
    ]
  },
  harpy: {
    stats: {
      INT: 1,
      REF: 4,
      DEX: 5,
      BODY: 5,
      SPD: 3,
      EMP: 2,
      CRA: 2,
      WILL: 4,
      STUN: 4
    },
    hp: 20,
    sta: 20,
    rec: 4,
    run: 9,
    leap: 1,
    enc: 50,
    armor: 0,
    regen: 0,
    dodgeDefense: 6,
    repositionDefense: 7,
    blockDefense: 12,
    resistances: [],
    immunities: [],
    attacks: [
      {
        name: "Claw Slash",
        attack: 12,
        type: "S",
        damage: "2d6+4",
        rel: 10,
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Wing Buffet",
        attack: 12,
        type: "B",
        damage: "1d6+2",
        rel: 10,
        range: 2,
        effect: "Stagger (30%)",
        rof: 1
      }
    ]
  },
  manticore: {
    stats: {
      INT: 1,
      REF: 12,
      DEX: 10,
      BODY: 15,
      SPD: 10,
      EMP: 1,
      CRA: 1,
      WILL: 6,
      STUN: 10
    },
    hp: 110,
    sta: 55,
    rec: 11,
    run: 30,
    leap: 6,
    enc: 150,
    armor: 15,
    regen: 0,
    dodgeDefense: 17,
    repositionDefense: 18,
    blockDefense: 20,
    resistances: [],
    immunities: [
      "Poison"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 20,
        type: "P",
        damage: "8d6",
        rel: 15,
        range: 2,
        effect: "Armor Piercing",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 20,
        type: "S",
        damage: "5d6+1",
        rel: 15,
        range: 2,
        effect: "Bleed (75%)",
        rof: 2
      },
      {
        name: "Tail Strike",
        attack: 20,
        type: "P",
        damage: "6d6+3",
        rel: 10,
        range: 2,
        effect: "Long Reach, Bohun Upas Poison",
        rof: 1
      },
      {
        name: "Wing Buffet",
        attack: 20,
        type: "B",
        damage: "4d6",
        rel: 10,
        range: 2,
        effect: "Knock-Down (50%)",
        rof: 2
      }
    ]
  },
  succubus: {
    stats: {
      INT: 5,
      REF: 7,
      DEX: 8,
      BODY: 12,
      SPD: 6,
      EMP: 10,
      CRA: 4,
      WILL: 8,
      STUN: 10
    },
    hp: 100,
    sta: 150,
    rec: 10,
    run: 18,
    leap: 3,
    enc: 120,
    armor: 0,
    regen: 0,
    dodgeDefense: 14,
    repositionDefense: 15,
    blockDefense: 16,
    resistances: [],
    immunities: [
      "Magical Charms"
    ],
    attacks: [
      {
        name: "Headbutt",
        attack: 13,
        type: "B",
        damage: "5d6",
        rel: 15,
        range: 2,
        effect: "Crushing Force, Stun (-2)",
        rof: 1
      },
      {
        name: "Kick",
        attack: 16,
        type: "B",
        damage: "4d6+4",
        rel: 10,
        range: 2,
        effect: "Crushing Force, Knock-Down (50%)",
        rof: 1
      },
      {
        name: "Punch",
        attack: 16,
        type: "B",
        damage: "3d6+3",
        rel: 10,
        range: 2,
        effect: "Crushing Force",
        rof: 2
      }
    ]
  },
  barbegazi: {
    stats: {
      INT: 1,
      REF: 4,
      DEX: 4,
      BODY: 5,
      SPD: 4,
      EMP: 1,
      CRA: 1,
      WILL: 3,
      STUN: 4
    },
    hp: 20,
    sta: 20,
    rec: 4,
    run: 12,
    leap: 2,
    enc: 50,
    armor: 3,
    regen: 0,
    dodgeDefense: 10,
    repositionDefense: 7,
    blockDefense: 11,
    resistances: [
      "Slashing"
    ],
    immunities: [
      "Freeze",
      "Snow & Ice Conditions"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 11,
        type: "P",
        damage: "2d6+3",
        rel: 10,
        range: 2,
        effect: "",
        rof: 1
      }
    ]
  },
  frightener: {
    stats: {
      INT: 1,
      REF: 9,
      DEX: 7,
      BODY: 18,
      SPD: 8,
      EMP: 1,
      CRA: 1,
      WILL: 6,
      STUN: 10
    },
    hp: 120,
    sta: 60,
    rec: 12,
    run: 24,
    leap: 8,
    enc: 180,
    armor: 30,
    regen: 0,
    dodgeDefense: 15,
    repositionDefense: 9,
    blockDefense: 17,
    resistances: [
      "Piercing",
      "Slashing",
      "Bludgeoning"
    ],
    immunities: [
      "Bleed",
      "Fire",
      "Freeze",
      "Stun"
    ],
    attacks: []
  },
  giantcentipede: {
    stats: {
      INT: 1,
      REF: 7,
      DEX: 6,
      BODY: 5,
      SPD: 6,
      EMP: 1,
      CRA: 1,
      WILL: 4,
      STUN: 4
    },
    hp: 20,
    sta: 20,
    rec: 4,
    run: 18,
    leap: 3,
    enc: 50,
    armor: 8,
    regen: 0,
    dodgeDefense: 10,
    repositionDefense: 11,
    blockDefense: 11,
    resistances: [],
    immunities: [
      "Bleeding"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 10,
        type: "P",
        damage: "3d6",
        rel: 10,
        range: 2,
        effect: "Poison (30%)",
        rof: 1
      }
    ]
  },
  earthelemental: {
    stats: {
      INT: 1,
      REF: 6,
      DEX: 5,
      BODY: 13,
      SPD: 3,
      EMP: 1,
      CRA: 1,
      WILL: 9,
      STUN: 10
    },
    hp: 110,
    sta: 55,
    rec: 11,
    run: 15,
    leap: 3,
    enc: 130,
    armor: 20,
    regen: 0,
    dodgeDefense: 12,
    repositionDefense: 9,
    blockDefense: 14,
    resistances: [
      "Fire"
    ],
    immunities: [
      "Bleeding",
      "Poison",
      "Knock-Down"
    ],
    attacks: [
      {
        name: "Punch",
        attack: 14,
        type: "B",
        damage: "8d6",
        rel: 20,
        range: 2,
        effect: "Crushing Force",
        rof: 2
      }
    ]
  },
  fireelemental: {
    stats: {
      INT: 1,
      REF: 7,
      DEX: 6,
      BODY: 11,
      SPD: 5,
      EMP: 1,
      CRA: 1,
      WILL: 9,
      STUN: 10
    },
    hp: 100,
    sta: 50,
    rec: 10,
    run: 15,
    leap: 3,
    enc: 100,
    armor: 15,
    regen: 0,
    dodgeDefense: 14,
    repositionDefense: 10,
    blockDefense: 16,
    resistances: [],
    immunities: [
      "Bleeding",
      "Poison",
      "Knock-Down"
    ],
    attacks: [
      {
        name: "Punch",
        attack: 16,
        type: "B",
        damage: "5d6",
        rel: 20,
        range: 2,
        effect: "Crushing Force, Fire (50%)",
        rof: 2
      }
    ]
  },
  iceelemental: {
    stats: {
      INT: 1,
      REF: 6,
      DEX: 5,
      BODY: 13,
      SPD: 3,
      EMP: 1,
      CRA: 1,
      WILL: 9,
      STUN: 10
    },
    hp: 110,
    sta: 55,
    rec: 11,
    run: 15,
    leap: 3,
    enc: 130,
    armor: 20,
    regen: 0,
    dodgeDefense: 14,
    repositionDefense: 10,
    blockDefense: 15,
    resistances: [],
    immunities: [
      "Bleeding",
      "Poison",
      "Knock-Down"
    ],
    attacks: [
      {
        name: "Punch",
        attack: 15,
        type: "B",
        damage: "8d6",
        rel: 20,
        range: 2,
        effect: "Crushing Force, Freeze (50%)",
        rof: 1
      }
    ]
  },
  godling: {
    stats: {
      INT: 4,
      REF: 8,
      DEX: 9,
      BODY: 3,
      SPD: 8,
      EMP: 7,
      CRA: 4,
      WILL: 5,
      STUN: 4
    },
    hp: 20,
    sta: 20,
    rec: 4,
    run: 24,
    leap: 4,
    enc: 30,
    armor: 0,
    regen: 0,
    dodgeDefense: 13,
    repositionDefense: 15,
    blockDefense: 8,
    resistances: [],
    immunities: [],
    attacks: [
      {
        name: "Punch",
        attack: 8,
        type: "B",
        damage: "1d6-2",
        rel: 5,
        range: 2,
        effect: "",
        rof: 1
      }
    ]
  },
  leshen: {
    stats: {
      INT: 7,
      REF: 9,
      DEX: 9,
      BODY: 12,
      SPD: 5,
      EMP: 4,
      CRA: 2,
      WILL: 10,
      STUN: 10
    },
    hp: 110,
    sta: 55,
    rec: 11,
    run: 15,
    leap: 3,
    enc: 120,
    armor: 16,
    regen: 0,
    dodgeDefense: 16,
    repositionDefense: 12,
    blockDefense: 18,
    resistances: [
      "Slashing"
    ],
    immunities: [
      "Magical Charm"
    ],
    attacks: [
      {
        name: "Claw Slash",
        attack: 18,
        type: "S",
        damage: "7d6",
        rel: 20,
        range: 2,
        effect: "",
        rof: 2
      }
    ]
  },
  shaelmaar: {
    stats: {
      INT: 1,
      REF: 6,
      DEX: 4,
      BODY: 12,
      SPD: 5,
      EMP: 1,
      CRA: 1,
      WILL: 5,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    run: 15,
    leap: 3,
    enc: 120,
    armor: 20,
    regen: 0,
    dodgeDefense: 14,
    repositionDefense: 8,
    blockDefense: 15,
    resistances: [
      "Slashing"
    ],
    immunities: [
      "Knock-Down",
      "Blinding"
    ],
    attacks: [
      {
        name: "Claw Slash",
        attack: 15,
        type: "S",
        damage: "5d6+2",
        rel: 20,
        range: 2,
        effect: "",
        rof: 2
      }
    ]
  },
  cyclops: {
    stats: {
      INT: 4,
      REF: 7,
      DEX: 6,
      BODY: 15,
      SPD: 6,
      EMP: 4,
      CRA: 5,
      WILL: 8,
      STUN: 10
    },
    hp: 110,
    sta: 110,
    rec: 11,
    run: 18,
    leap: 6,
    enc: 300,
    armor: 15,
    regen: 0,
    dodgeDefense: 16,
    repositionDefense: 14,
    blockDefense: 15,
    resistances: [],
    immunities: [
      "Knock-Down",
      "Stagger"
    ],
    attacks: [
      {
        name: "Club Smash",
        attack: 15,
        type: "B",
        damage: "7d6+8",
        rel: 20,
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Punch",
        attack: 16,
        type: "B",
        damage: "6d6",
        rel: 15,
        range: 2,
        effect: "",
        rof: 1
      }
    ]
  },
  knocker: {
    stats: {
      INT: 4,
      REF: 6,
      DEX: 6,
      BODY: 10,
      SPD: 6,
      EMP: 4,
      CRA: 8,
      WILL: 6,
      STUN: 8
    },
    hp: 40,
    sta: 80,
    rec: 8,
    run: 18,
    leap: 3,
    enc: 200,
    armor: 3,
    regen: 3,
    dodgeDefense: 15,
    repositionDefense: 14,
    blockDefense: 13,
    resistances: [],
    immunities: [],
    attacks: [
      {
        name: "Punch",
        attack: 13,
        type: "B",
        damage: "2d6+4",
        rel: 10,
        range: 2,
        effect: "",
        rof: 1
      }
    ]
  },
  troll: {
    stats: {
      INT: 2,
      REF: 7,
      DEX: 4,
      BODY: 14,
      SPD: 4,
      EMP: 6,
      CRA: 9,
      WILL: 5,
      STUN: 9
    },
    hp: 90,
    sta: 45,
    rec: 9,
    run: 12,
    leap: 2,
    enc: 140,
    armor: 12,
    regen: 3,
    dodgeDefense: 14,
    repositionDefense: 10,
    blockDefense: 15,
    resistances: [
      "Bludgeoning",
      "Piercing"
    ],
    immunities: [
      "Knock-Down",
      "Bleeding"
    ],
    attacks: [
      {
        name: "Punch",
        attack: 14,
        type: "B",
        damage: "5d6+2",
        rel: 15,
        range: 2,
        effect: "Stun (-0)",
        rof: 2
      }
    ]
  },
  cockatrice: {
    stats: {
      INT: 1,
      REF: 8,
      DEX: 9,
      BODY: 12,
      SPD: 7,
      EMP: 1,
      CRA: 1,
      WILL: 4,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    run: 21,
    leap: 4,
    enc: 120,
    armor: 8,
    regen: 0,
    dodgeDefense: 15,
    repositionDefense: 16,
    blockDefense: 17,
    resistances: [
      "Poison"
    ],
    immunities: [],
    attacks: [
      {
        name: "Bite",
        attack: 17,
        type: "P",
        damage: "5d6",
        rel: 15,
        range: 2,
        effect: "Poison (50%)",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 17,
        type: "S",
        damage: "4d6+3",
        rel: 10,
        range: 2,
        effect: "Bleeding (50%)",
        rof: 2
      },
      {
        name: "Tail Swipe",
        attack: 17,
        type: "S",
        damage: "4d6+3",
        rel: 5,
        range: 2,
        effect: "Bleeding (75%), Long Reach",
        rof: 1
      },
      {
        name: "Wing Buffet",
        attack: 17,
        type: "B",
        damage: "2d6",
        rel: 5,
        range: 2,
        effect: "Stagger (25%)",
        rof: 1
      }
    ]
  },
  phoenix: {
    stats: {
      INT: 5,
      REF: 9,
      DEX: 10,
      BODY: 10,
      SPD: 10,
      EMP: 5,
      CRA: 3,
      WILL: 8,
      STUN: 9
    },
    hp: 90,
    sta: 45,
    rec: 9,
    run: 30,
    leap: 6,
    enc: 100,
    armor: 10,
    regen: 0,
    dodgeDefense: 17,
    repositionDefense: 16,
    blockDefense: 16,
    resistances: [],
    immunities: [
      "Fire",
      "Freeze"
    ],
    attacks: [
      {
        name: "Beak",
        attack: 16,
        type: "P",
        damage: "6d6",
        rel: 15,
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Wing Buffet",
        attack: 16,
        type: "B",
        damage: "3d6",
        rel: 10,
        range: 2,
        effect: "Fire (50%), Stagger (25%)",
        rof: 1
      }
    ]
  },
  slyzard: {
    stats: {
      INT: 1,
      REF: 12,
      DEX: 10,
      BODY: 11,
      SPD: 8,
      EMP: 1,
      CRA: 1,
      WILL: 7,
      STUN: 9
    },
    hp: 90,
    sta: 45,
    rec: 9,
    run: 24,
    leap: 4,
    enc: 110,
    armor: 16,
    regen: 0,
    dodgeDefense: 17,
    repositionDefense: 19,
    blockDefense: 18,
    resistances: [
      "Piercing",
      "Slashing",
      "Fire"
    ],
    immunities: [],
    attacks: [
      {
        name: "Bite",
        attack: 20,
        type: "P",
        damage: "7d6+2",
        rel: 20,
        range: 2,
        effect: "Armor Piercing",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 20,
        type: "S",
        damage: "6d6+2",
        rel: 15,
        range: 2,
        effect: "Bleed (50%)",
        rof: 2
      }
    ]
  },
  bruxa: {
    stats: {
      INT: 6,
      REF: 14,
      DEX: 14,
      BODY: 11,
      SPD: 12,
      EMP: 6,
      CRA: 5,
      WILL: 8,
      STUN: 9
    },
    hp: 90,
    sta: 45,
    rec: 9,
    run: 36,
    leap: 7,
    enc: 110,
    armor: 10,
    regen: 0,
    dodgeDefense: 20,
    repositionDefense: 22,
    blockDefense: 24,
    resistances: [
      "Stun",
      "Bleed",
      "Poison"
    ],
    immunities: [
      "Magic Scanning"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 24,
        type: "P",
        damage: "5d6+3",
        rel: 10,
        range: 2,
        effect: "",
        rof: 1
      }
    ]
  },
  garkain: {
    stats: {
      INT: 1,
      REF: 11,
      DEX: 10,
      BODY: 8,
      SPD: 8,
      EMP: 1,
      CRA: 1,
      WILL: 7,
      STUN: 7
    },
    hp: 70,
    sta: 35,
    rec: 7,
    run: 24,
    leap: 4,
    enc: 80,
    armor: 0,
    regen: 0,
    dodgeDefense: 21,
    repositionDefense: 17,
    blockDefense: 18,
    resistances: [
      "Stun"
    ],
    immunities: [
      "Fear"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 18,
        type: "P",
        damage: "5d6",
        rel: 10,
        range: 2,
        effect: "Bleed (75%)",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 18,
        type: "S",
        damage: "4d6+4",
        rel: 15,
        range: 2,
        effect: "Bleed (25%)",
        rof: 2
      }
    ]
  },
  plumard: {
    stats: {
      INT: 1,
      REF: 5,
      DEX: 6,
      BODY: 1,
      SPD: 7,
      EMP: 1,
      CRA: 1,
      WILL: 4,
      STUN: 2
    },
    hp: 10,
    sta: 10,
    rec: 2,
    run: 21,
    leap: 4,
    enc: 10,
    armor: 0,
    regen: 0,
    dodgeDefense: 13,
    repositionDefense: 15,
    blockDefense: 10,
    resistances: [],
    immunities: [],
    attacks: [
      {
        name: "Bite",
        attack: 10,
        type: "P",
        damage: "2d6",
        rel: 10,
        range: 2,
        effect: "Drain Blood",
        rof: 1
      }
    ]
  },
  truedragon: {
    stats: {
      INT: 7,
      REF: 14,
      DEX: 13,
      BODY: 20,
      SPD: 10,
      EMP: 8,
      CRA: 5,
      WILL: 10,
      STUN: 10
    },
    hp: 150,
    sta: 80,
    rec: 16,
    run: 30,
    leap: 12,
    enc: 500,
    armor: 25,
    regen: 20,
    dodgeDefense: 24,
    repositionDefense: 22,
    blockDefense: 23,
    resistances: [],
    immunities: [
      "Bleeding",
      "Knock-Down",
      "Fire"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 23,
        type: "P",
        damage: "10d6",
        rel: 20,
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 23,
        type: "S",
        damage: "8d6",
        rel: 20,
        range: 2,
        effect: "",
        rof: 1
      },
      {
        name: "Wing Buffet",
        attack: 23,
        type: "B",
        damage: "5d6+3",
        rel: 15,
        range: 2,
        effect: "",
        rof: 1
      }
    ]
  },
  highervampire: {
    stats: {
      INT: 10,
      REF: 15,
      DEX: 16,
      BODY: 12,
      SPD: 12,
      EMP: 8,
      CRA: 7,
      WILL: 8,
      STUN: 10
    },
    hp: 100,
    sta: 60,
    rec: 12,
    run: 36,
    leap: 7,
    enc: 120,
    armor: 8,
    regen: 20,
    dodgeDefense: 25,
    repositionDefense: 26,
    blockDefense: 24,
    resistances: [
      "Magical Charms"
    ],
    immunities: [
      "Silver",
      "Magical Scanning",
      "Fire"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 24,
        type: "P",
        damage: "6d6",
        rel: 15,
        range: 2,
        effect: "",
        rof: 1
      }
    ]
  },
  bes: {
    stats: {
      INT: 5,
      REF: 12,
      DEX: 12,
      BODY: 10,
      SPD: 7,
      EMP: 2,
      CRA: 2,
      WILL: 10,
      STUN: 10
    },
    hp: 100,
    sta: 50,
    rec: 10,
    run: 21,
    leap: 5,
    enc: 100,
    armor: 0,
    regen: 0,
    dodgeDefense: 17,
    repositionDefense: 20,
    blockDefense: 22,
    resistances: [],
    immunities: [
      "Fire",
      "Poison",
      "Bleed"
    ],
    attacks: []
  },
  casglydd: {
    stats: {
      INT: 10,
      REF: 9,
      DEX: 6,
      BODY: 5,
      SPD: 6,
      EMP: 4,
      CRA: 8,
      WILL: 12,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    run: 18,
    leap: 4,
    enc: 50,
    armor: 15,
    regen: 0,
    dodgeDefense: 16,
    repositionDefense: 12,
    blockDefense: 19,
    resistances: [],
    immunities: [
      "Fear",
      "Blinding"
    ],
    attacks: []
  },
  greatbear: {
    stats: {
      INT: 1,
      REF: 7,
      DEX: 6,
      BODY: 12,
      SPD: 7,
      EMP: 1,
      CRA: 1,
      WILL: 5,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    run: 21,
    leap: 4,
    enc: 120,
    armor: 14,
    regen: 0,
    dodgeDefense: 12,
    repositionDefense: 10,
    blockDefense: 15,
    resistances: [
      "Bludgeoning"
    ],
    immunities: [],
    attacks: [
      {
        name: "Bite",
        attack: 17,
        type: "P",
        damage: "8d6",
        rel: 15,
        range: 2,
        effect: "Crushing Force, Bleed (75%)",
        rof: 1
      },
      {
        name: "Claw Slash",
        attack: 17,
        type: "S",
        damage: "4d6+5",
        rel: 15,
        range: 2,
        effect: "Crushing Force",
        rof: 2
      }
    ]
  },
  livingarmor: {
    stats: {
      INT: 1,
      REF: 8,
      DEX: 6,
      BODY: 8,
      SPD: 4,
      EMP: 1,
      CRA: 1,
      WILL: 4
    },
    hp: 60,
    sta: null,
    rec: 6,
    run: 12,
    leap: 2,
    enc: 80,
    armor: 5,
    regen: 0,
    dodgeDefense: 12,
    repositionDefense: 10,
    blockDefense: 16,
    resistances: [
      "Based on Armor Used"
    ],
    immunities: [
      "Poison",
      "Bleeding",
      "Charm"
    ],
    attacks: [
      {
        name: "Fist",
        attack: 16,
        type: "B",
        damage: "1d6+2",
        rel: 15,
        range: 2,
        effect: "",
        rof: 2
      }
    ]
  },
  corpseamalgam: {
    stats: {
      INT: 1,
      REF: 8,
      DEX: 6,
      BODY: 12,
      SPD: 6,
      EMP: 1,
      CRA: 1,
      WILL: 8,
      STUN: 10
    },
    hp: 100,
    sta: 50,
    rec: 10,
    run: 18,
    leap: 4,
    enc: 120,
    armor: 0,
    regen: 0,
    dodgeDefense: 12,
    repositionDefense: 13,
    blockDefense: 16,
    resistances: [
      "Bludgeoning",
      "Piercing"
    ],
    immunities: [
      "Poison",
      "Bleeding"
    ],
    attacks: [
      {
        name: "Fists",
        attack: 16,
        type: "B",
        damage: "5d6",
        rel: 10,
        range: 2,
        effect: "Long Reach, Crushing Force",
        rof: 2
      }
    ]
  },
  marilwyd: {
    stats: {
      INT: 5,
      REF: 10,
      DEX: 10,
      BODY: 10,
      SPD: 5,
      EMP: 3,
      CRA: 3,
      WILL: 8,
      STUN: 9
    },
    hp: 90,
    sta: 45,
    rec: 9,
    run: 15,
    leap: 3,
    enc: 100,
    armor: 5,
    regen: 0,
    dodgeDefense: 18,
    repositionDefense: 18,
    blockDefense: 18,
    resistances: [],
    immunities: [
      "Poison",
      "Bleeding",
      "Freeze"
    ],
    attacks: [
      {
        name: "Bite",
        attack: 18,
        type: "P",
        damage: "5d6+4",
        rel: 10,
        range: 100,
        effect: "Improved Armor Piercing, Freeze (100%)",
        rof: 1
      },
      {
        name: "Spine Whip",
        attack: 18,
        type: "B",
        damage: "4d6+4",
        rel: 20,
        range: 100,
        effect: "Stagger (30%)",
        rof: 3
      },
      {
        name: "Slam",
        attack: 18,
        type: "B",
        damage: "4d6+4",
        rel: 15,
        range: 2,
        effect: "Stagger (50%)",
        rof: 1
      }
    ]
  },
  penitent: {
    stats: {
      INT: 6,
      REF: 8,
      DEX: 8,
      BODY: 8,
      SPD: 6,
      EMP: 1,
      CRA: 1,
      WILL: 8,
      STUN: 8
    },
    hp: 80,
    sta: 40,
    rec: 8,
    run: 18,
    leap: 3,
    enc: 80,
    armor: 0,
    regen: 0,
    dodgeDefense: 16,
    repositionDefense: 18,
    blockDefense: 17,
    resistances: [],
    immunities: [
      "Charm",
      "Coercion",
      "Fear"
    ],
    attacks: [
      {
        name: "Penitent Lantern",
        attack: 15,
        type: "E",
        damage: "4d6",
        rel: 10,
        range: 2,
        effect: "Fire (75%)",
        rof: 1
      }
    ]
  },
  dog: {
    stats: {
      INT: 1,
      REF: 3,
      DEX: 5,
      BODY: 3,
      SPD: 5,
      EMP: 4,
      CRA: 1,
      WILL: 5,
      STUN: 4
    },
    hp: 20,
    sta: 20,
    rec: 4,
    run: 15,
    leap: 3,
    enc: 30,
    armor: 0,
    regen: 0,
    dodgeDefense: 9,
    repositionDefense: 9,
    blockDefense: 7,
    resistances: [],
    immunities: [],
    skills: {
      Melee: 4,
      "Dodge/Escape": 6,
      Athletics: 8,
      Awareness: 7,
      Stealth: 6,
      "Wilderness Survival": 3,
      Endurance: 4,
      Courage: 5
    },
    attacks: []
  },
  horse: {
    stats: {
      INT: 1,
      REF: 4,
      DEX: 5,
      BODY: 12,
      SPD: 12,
      EMP: 4,
      CRA: 1,
      WILL: 4,
      STUN: 8
    },
    hp: 40,
    sta: 40,
    rec: 8,
    run: 36,
    leap: 7,
    enc: 120,
    armor: 0,
    regen: 0,
    dodgeDefense: 10,
    repositionDefense: 10,
    blockDefense: 12,
    resistances: [],
    immunities: [],
    skills: {
      Melee: 8,
      "Dodge/Escape": 6,
      Athletics: 6,
      Awareness: 6,
      Stealth: 2,
      "Wilderness Survival": 2,
      Endurance: 9,
      Courage: 10
    },
    attacks: []
  },
  warhorse: {
    stats: {
      INT: 1,
      REF: 6,
      DEX: 6,
      BODY: 14,
      SPD: 11,
      EMP: 3,
      CRA: 1,
      WILL: 6,
      STUN: 10
    },
    hp: 50,
    sta: 50,
    rec: 10,
    run: 33,
    leap: 6,
    enc: 140,
    armor: 0,
    regen: 0,
    dodgeDefense: 14,
    repositionDefense: 14,
    blockDefense: 12,
    resistances: [],
    immunities: [],
    skills: {
      Melee: 6,
      "Dodge/Escape": 8,
      Athletics: 6,
      Awareness: 5,
      Stealth: 3,
      "Wilderness Survival": 2,
      Endurance: 6,
      Courage: 6
    },
    attacks: []
  }
};
