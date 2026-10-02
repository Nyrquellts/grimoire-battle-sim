import { describe, expect, it } from 'vitest';
import {
  AttackService, Dice, EncounterFactory, Registry, Store, baseActor, defaultState
} from '../../src/services/SimulationRuntime';
import { isPlayerControlled } from '../../src/entities/Actor';
import type { AttackOutcome } from '../../src/services/Attack';
import type { IActor, IState } from '../../src/entities/types';

/**
 * Regression tests for KNOWN_ISSUES C — the engine branched on `actor.id === 'nikhail'`.
 *
 * The simulation must resolve combat from actor *data* (skills, control mode, weapon properties),
 * never from an actor's identity. Renaming the player character must not change a single roll.
 *
 * Nikhail remains valid content: a character definition, the default PC, and the subject of
 * narration when he is actually fighting. He is simply not required for the engine to work.
 */

/** Mechanical outcome only — narration legitimately mentions whichever actor is fighting. */
function mechanics(attack: AttackOutcome) {
  const results = attack.results;
  return results.map(result => ({
    hit: result.hit ?? false,
    attackTotal: result.roll?.total,
    defenseTotal: result.defense?.roll?.total,
    dealt: result.damage?.dealt,
    raw: result.damage?.raw,
    location: result.location?.id,
    critical: result.critical?.tier ?? null
  }));
}

/** Renames the player actor in place, keeping every stat, skill, and item identical. */
function renamePlayer(state: IState, id: string, name: string): void {
  state.player.id = id;
  state.player.name = name;
  state.player.baseName = name;
}

function silverTarget(): IActor {
  const target = baseActor({
    name: 'Silver Test', family: 'Vampire', hp: 120, armor: 0,
    stats: { BODY: 8, STUN: 8, REF: 6, DEX: 6 },
    defenses: { dodge: 6, block: 6, parry: 6, magic: 6 }
  });
  target.silver = true;
  target.pos = { x: 5, y: 8 };
  return target;
}

function plainTarget(): IActor {
  const target = baseActor({
    name: 'Plain Test', family: 'Human', hp: 120, armor: 0,
    stats: { BODY: 8, STUN: 8, REF: 6, DEX: 6 },
    defenses: { dodge: 6, block: 6, parry: 6, magic: 6 }
  });
  target.pos = { x: 5, y: 8 };
  return target;
}

/** Runs one attack from a fixed seed, optionally renaming the player first. */
function attackWith(options: {
  seed: number;
  weaponId: string;
  rename?: { id: string; name: string };
  target?: () => IActor;
}) {
  Dice.seed(options.seed);
  const state = defaultState();
  if (options.rename) renamePlayer(state, options.rename.id, options.rename.name);
  const target = (options.target ?? plainTarget)();
  state.enemies = [target];
  return AttackService.attack(state, {
    actorId: state.player.id,
    targetId: target.id,
    weaponId: options.weaponId,
    mode: 'normal',
    called: 'torso'
  });
}

describe('combat resolves from actor data, not actor identity', () => {
  for (const weaponId of ['manticoreSteel', 'manticoreSilver', 'sipar', 'zerrikanianCrossbow']) {
    it(`produces an identical ${weaponId} attack for a renamed player`, () => {
      const asDefault = attackWith({ seed: 778899, weaponId });
      const asStranger = attackWith({ seed: 778899, weaponId, rename: { id: 'pc-2', name: 'Sera of Highmarsh' } });
      expect(mechanics(asStranger)).toEqual(mechanics(asDefault));
    });
  }

  it('applies the silver bonus from weapon data for any wielder', () => {
    const asDefault = attackWith({ seed: 4242, weaponId: 'manticoreSilver', target: silverTarget });
    const asStranger = attackWith({ seed: 4242, weaponId: 'manticoreSilver', rename: { id: 'pc-3', name: 'Rhea' }, target: silverTarget });
    expect(mechanics(asStranger)).toEqual(mechanics(asDefault));
  });

  it('adds silver damage only against silver-vulnerable targets', () => {
    const weapon = Registry.weapons.get('manticoreSilver');
    expect(weapon?.silverDamage, 'the silver bonus must live in weapon data').toBeTruthy();

    const versusSilver = mechanics(attackWith({ seed: 1357, weaponId: 'manticoreSilver', target: silverTarget }));
    const versusPlain = mechanics(attackWith({ seed: 1357, weaponId: 'manticoreSilver', target: plainTarget }));
    const silverRaw = versusSilver[0]?.raw ?? 0;
    const plainRaw = versusPlain[0]?.raw ?? 0;
    expect(versusSilver[0]?.hit).toBe(true);
    expect(versusPlain[0]?.hit).toBe(true);
    expect(silverRaw).toBeGreaterThan(plainRaw);
  });

  it('resolves weapon skill from the weapon, not from who is holding it', () => {
    // A stat-block combatant uses their flat attack value; a character sheet uses skills. The
    // discriminator is the presence of `attack`, which is data, not a name.
    const statBlock = EncounterFactory.foe('bandit', 'standard', { region: 'Temeria', experience: 'trained', loadout: 'sword' });
    expect(typeof statBlock.attack).toBe('number');
    expect(defaultState().player.attack).toBeUndefined();

    for (const [weaponId, skill] of [
      ['zerrikanianCrossbow', 'Crossbow'],
      ['sipar', 'Melee (Shield)'],
      ['manticoreSteel', 'Swordsmanship'],
      ['manticoreSilver', 'Swordsmanship']
    ] as const) {
      expect(Registry.weapons.get(weaponId)?.combatSkill, `${weaponId} should declare its skill`).toBe(skill);
    }
  });
});

describe('player-controlled actors are identified by control mode', () => {
  it('recognises the default player character', () => {
    expect(isPlayerControlled(defaultState().player)).toBe(true);
  });

  it('still recognises them after a rename', () => {
    const state = defaultState();
    renamePlayer(state, 'pc-99', 'Someone Else');
    expect(isPlayerControlled(state.player)).toBe(true);
  });

  it('does not treat generated hostiles as player-controlled', () => {
    const enemy = EncounterFactory.foe('bandit', 'standard', { region: 'Temeria', experience: 'trained', loadout: 'sword' });
    expect(isPlayerControlled(enemy)).toBe(false);
  });
});

describe('state validation does not require one specific character', () => {
  it('accepts a battle whose player character has a different id', () => {
    const saved = Store.snapshot();
    try {
      const state = defaultState();
      renamePlayer(state, 'pc-4', 'Eldrin');
      // validateState runs on every Store write; a rename must not trip it.
      expect(() => Store.replace(state, { silent: true, clearHistory: true })).not.toThrow();
      expect(Store.read().player.id).toBe('pc-4');
    } finally {
      Store.replace(saved, { silent: true, clearHistory: true });
    }
  });

  it('still rejects a battle with no player character', () => {
    const saved = Store.snapshot();
    try {
      const state = defaultState();
      state.player.id = '';
      expect(() => Store.replace(state, { silent: true, clearHistory: true })).toThrow();
    } finally {
      Store.replace(saved, { silent: true, clearHistory: true });
    }
  });
});
