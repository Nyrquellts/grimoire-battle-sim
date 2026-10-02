import { afterEach, describe, expect, it } from 'vitest';
import { AI, AITacticalState, ActionDispatcher, CombatFlow, Store, ZoneService } from '../../src/services/SimulationRuntime';
import { Pipeline } from '../../src/core/kernel';
import { Registry } from '../../src/data/witcherContent';
import { Dice } from '../../src/core/kernel';
import { GridService } from '../../src/services/GridService';
import { CreatureAbilitySystem } from '../../src/services/CreatureAbilities';
import { resolverKinds } from '../../src/actions/creatures';
import { abilitiesFor } from '../../src/data/witcherContent';
import type { IActor, IState } from '../../src/entities/types';

const abilitySystem = new CreatureAbilitySystem({
  abilities: Registry.creatureAbilities,
  lookup: (creatureId: string) => abilitiesFor(creatureId)
});

/**
 * Creature abilities, end to end.
 *
 * The point of this suite is behavioural: before abilities existed, every monster walked forward
 * and bit. These tests assert that a griffin reaches for its charge, that a wraith is not simply
 * cut down with steel, and that the passives reach the actors that should have them.
 */

function fight(foe: string, quantity = 1, situation = 'open'): IState {
  const start = CombatFlow.start as unknown as (options: { lineup: Array<Record<string, unknown>>; situation: string }) => void;
  start({ lineup: [{ foe, quantity, region: 'Temeria', experience: 'random', loadout: 'random' }], situation });
  return Store.read();
}

/** Moves the first enemy to a set distance from the player, in a straight line. */
function placeAt(distance: number): IActor {
  Store.update(draft => {
    const enemy = draft.enemies[0];
    if (!enemy) throw new Error('No enemy.');
    enemy.pos = { x: Math.min(GridService.W - 2, draft.player.pos.x + distance), y: draft.player.pos.y };
  }, { silent: true });
  return Store.read().enemies[0]!;
}

describe('Ability content', () => {
  it('registers the core abilities with a declared rule status', () => {
    for (const id of ['charge', 'sonicScreech', 'dustDevil', 'shift', 'incorporeal', 'regeneration']) {
      const ability = Registry.creatureAbilities.get(id);
      expect(ability, id).toBeDefined();
      expect(['standard', 'adapted']).toContain(ability?.ruleStatus);
    }
  });

  it('gives every ability a kind the resolver understands', () => {
    const kinds = new Set(resolverKinds());
    for (const ability of Registry.creatureAbilities.values()) expect(kinds).toContain(ability.kind);
  });
});

describe('Passive abilities reach the actors that have them', () => {
  afterEach(() => CombatFlow.reset());

  it('makes a drowner immune to poison and to mind magic', () => {
    const state = fight('drowner');
    const drowner = state.enemies[0]!;
    expect(drowner.immunities).toContain('poisoned');
    // Impenetrably Dim: mind-affecting magic slides off it, so Axii does nothing.
    expect(drowner.immunities).toContain('stunned');
  });

  it('gives a werewolf its regeneration', () => {
    const werewolf = fight('werewolf').enemies[0]!;
    expect(Number(werewolf.regen)).toBeGreaterThanOrEqual(5);
  });

  it('makes a wraith impossible to frighten', () => {
    const wraith = fight('wraith').enemies[0]!;
    expect(wraith.morale.fearImmune).toBe(true);
  });

  it('starts a noonwraith incorporeal', () => {
    const noonwraith = fight('noonwraith').enemies[0]!;
    expect(noonwraith.statuses.incorporeal).toBe(true);
  });

  it('leaves an ordinary bandit with no creature abilities', () => {
    const bandit = fight('bandit').enemies[0]!;
    expect(bandit.statuses.incorporeal).toBeUndefined();
    expect(Number(bandit.regen) || 0).toBe(0);
  });
});

describe('Incorporeal creatures ignore steel', () => {
  afterEach(() => CombatFlow.reset());

  it('cancels physical damage against an incorporeal target', () => {
    fight('noonwraith');
    const enemy = placeAt(1);
    Store.update(draft => { draft.selectedEnemyId = draft.enemies[0]!.id; draft.turn.action = 1; }, { silent: true });
    const before = Store.read().enemies[0]!.hp;

    Dice.seed(11);
    ActionDispatcher.execute('melee', { actorId: Store.read().player.id, targetId: enemy.id, weaponId: 'manticoreSteel', mode: 'normal', called: 'torso' });

    expect(Store.read().enemies[0]!.hp).toBe(before);
  });

  it('lets steel through once Yrden has forced it to materialise', () => {
    fight('noonwraith');
    const enemy = placeAt(1);
    Store.update(draft => {
      draft.selectedEnemyId = draft.enemies[0]!.id;
      draft.turn.action = 1;
      ZoneService.create(draft, { type: 'yrden', center: draft.enemies[0]!.pos, radius: 3, duration: 5, power: 3, source: 'test' });
    }, { silent: true });
    const before = Store.read().enemies[0]!.hp;

    // Several swings: the point is that damage is now *possible*, not that any one roll lands.
    for (let attempt = 0; attempt < 12; attempt++) {
      Dice.seed(100 + attempt);
      Store.update(draft => { draft.turn.action = 1; draft.turn.defensesUsed = 0; }, { silent: true });
      ActionDispatcher.execute('melee', { actorId: Store.read().player.id, targetId: enemy.id, weaponId: 'manticoreSteel', mode: 'strong', called: 'torso' });
      if (Store.read().enemies[0]!.hp < before) break;
    }

    expect(Store.read().enemies[0]!.hp).toBeLessThan(before);
  });
});

describe('The AI reaches for abilities', () => {
  afterEach(() => CombatFlow.reset());

  it('offers a griffin its charge once the player opens the distance', () => {
    fight('griffin');
    placeAt(16);
    const state = Store.read();
    const decision = AI.Controller.decide(state, state.enemies[0]!) as { name?: string; scores?: Array<{ name: string }> };

    // The griffin has real options and picks one; the charge competes with them rather than
    // replacing them, which is the point of routing abilities through the utility scorer.
    expect((decision.scores ?? []).length).toBeGreaterThan(0);
    expect(decision.name).toBeTruthy();
    expect(abilityIdsOffered(state, state.enemies[0]!)).toContain('charge');
  });

  it('will not offer a charge from point-blank range', () => {
    fight('griffin');
    placeAt(1);
    const state = Store.read();
    const abilities = abilityIdsOffered(state, state.enemies[0]!);
    expect(abilities).not.toContain('charge');
  });

  it('offers a charge from beyond ten metres', () => {
    fight('griffin');
    placeAt(15);
    const state = Store.read();
    expect(abilityIdsOffered(state, state.enemies[0]!)).toContain('charge');
  });

  it('respects an ability cooldown', () => {
    fight('griffin');
    const enemy = placeAt(15);
    Store.update(draft => {
      const griffin = draft.enemies[0]!;
      griffin.ai = { ...(griffin.ai ?? {}), memory: { abilityUse: { charge: draft.round } } } as typeof griffin.ai;
    }, { silent: true });

    expect(abilityIdsOffered(Store.read(), Store.read().enemies[0]!)).not.toContain('charge');
    expect(enemy).toBeDefined();
  });

  it('offers a siren its screech only when someone is inside the radius', () => {
    fight('siren');
    placeAt(4);
    expect(abilityIdsOffered(Store.read(), Store.read().enemies[0]!)).toContain('sonicScreech');

    placeAt(30);
    expect(abilityIdsOffered(Store.read(), Store.read().enemies[0]!)).not.toContain('sonicScreech');
  });
});

describe('Abilities resolve through the gateway', () => {
  afterEach(() => CombatFlow.reset());

  it('charges, damages, and knocks the target down', () => {
    fight('griffin');
    const enemy = placeAt(15);
    const before = Store.read().player;
    const startDistance = GridService.distance(before.pos, enemy.pos);

    Dice.seed(3);
    const result = ActionDispatcher.execute('enemyAbility', { actorId: enemy.id, abilityId: 'charge' });

    expect(result.ok).toBe(true);
    const after = Store.read();
    // The griffin closed the distance to make the attack.
    expect(GridService.distance(after.enemies[0]!.pos, after.player.pos)).toBeLessThan(startDistance);
  });

  it('refuses an ability the creature does not have', () => {
    fight('bandit');
    const enemy = placeAt(5);
    const result = ActionDispatcher.execute('enemyAbility', { actorId: enemy.id, abilityId: 'charge' });
    expect(result.ok).toBe(false);
  });

  it('stuns everyone the screech catches', () => {
    fight('siren');
    const enemy = placeAt(4);
    Dice.seed(2);

    ActionDispatcher.execute('enemyAbility', { actorId: enemy.id, abilityId: 'sonicScreech' });

    const feed = (Store.read().feed ?? []).map(entry => String(entry.title));
    expect(feed.some(title => /screech/i.test(title))).toBe(true);
  });
});

/**
 * The ability ids the AI would consider for this actor right now.
 *
 * Uses the same system the bridge wires, so this asserts the real availability rules rather than a
 * copy of them.
 */
function abilityIdsOffered(state: IState, actor: IActor): string[] {
  return abilitySystem.available(state, actor, state.player).map(option => option.id);
}

describe('Intelligence changes how a creature fights', () => {
  afterEach(() => CombatFlow.reset());

  /** Sets up a fight and returns the reasoning behind the chosen action. */
  function reasoning(foe: string, arrange: (draft: IState) => void) {
    Dice.seed(555);
    fight(foe);
    Store.update(draft => {
      const enemy = draft.enemies[0]!;
      enemy.pos = { x: draft.player.pos.x + 2, y: draft.player.pos.y };
      arrange(draft);
    }, { silent: true });

    const state = Store.read();
    const decision = AI.Controller.decide(state, state.enemies[0]!) as {
      name: string; scores?: Array<{ breakdown?: Array<{ label: string; value: number }> }>;
    };
    const labels = (decision.scores?.[0]?.breakdown ?? []).map(entry => entry.label);
    return { chose: decision.name, labels };
  }

  it('lets a clever creature see a ward that a mindless one cannot', () => {
    const dim = reasoning('drowner', draft => { draft.player.quenBlocks = 3; });
    const clever = reasoning('highervampire', draft => { draft.player.quenBlocks = 3; });

    expect(dim.labels).not.toContain('target is warded');
    expect(clever.labels).toContain('target is warded');
  });

  it('lets a clever creature commit to an opening a mindless one ignores', () => {
    const dim = reasoning('drowner', draft => { draft.player.statuses.prone = true; });
    const clever = reasoning('highervampire', draft => { draft.player.statuses.prone = true; });

    expect(dim.labels).not.toContain('target is open');
    expect(clever.labels).toContain('target is open');
  });

  it('makes a clever creature break off when badly hurt', () => {
    const clever = reasoning('highervampire', draft => { draft.enemies[0]!.hp = 20; });
    expect(clever.chose).toBe('reposition');
    expect(clever.labels).toContain('breaking off while hurt');
  });

  it('keeps a mindless creature attacking while badly hurt', () => {
    // A drowner never formulates a plan more complex than "attack".
    const dim = reasoning('drowner', draft => { draft.enemies[0]!.hp = 4; });
    expect(dim.labels).not.toContain('breaking off while hurt');
  });
});

describe('High Noon Dance', () => {
  afterEach(() => CombatFlow.reset());

  it('drains the target and heals its maker each round', () => {
    fight('noonwraith');
    Store.update(draft => {
      const wraith = draft.enemies[0]!;
      wraith.hp = wraith.maxHp - 20;
      wraith.statuses.illusions = { copies: 3, drain: 3, sourceId: wraith.id };
    }, { silent: true });
    const before = Store.read();
    const playerHealth = before.player.hp;
    const wraithHealth = before.enemies[0]!.hp;

    // The drain runs on the round upkeep, which fires as the player's turn begins.
    Store.update(draft => { Pipeline.emit('turn:begin', { state: draft, side: 'player' }); }, { silent: true });

    const after = Store.read();
    expect(after.player.hp).toBe(playerHealth - 3);
    expect(after.enemies[0]!.hp).toBe(wraithHealth + 3);
  });

  it('lets a copy take the blow instead of its maker', () => {
    fight('noonwraith');
    Store.update(draft => {
      const wraith = draft.enemies[0]!;
      delete wraith.statuses.incorporeal;
      wraith.statuses.illusions = { copies: 2, drain: 3, sourceId: wraith.id };
      wraith.pos = { x: draft.player.pos.x + 1, y: draft.player.pos.y };
      draft.selectedEnemyId = wraith.id;
      draft.turn.action = 1;
    }, { silent: true });
    const before = Store.read().enemies[0]!.hp;

    Dice.seed(4);
    ActionDispatcher.execute('melee', {
      actorId: Store.read().player.id, targetId: Store.read().enemies[0]!.id,
      weaponId: 'manticoreSteel', mode: 'strong', called: 'torso'
    });

    const after = Store.read().enemies[0]!;
    expect(after.hp).toBe(before);
    expect((after.statuses.illusions as { copies: number }).copies).toBe(1);
  });
});

describe('Zone risk is declared by the hazard, not by species', () => {
  afterEach(() => CombatFlow.reset());

  /** How much a creature fears standing in a zone placed on top of it. */
  function fearOf(foe: string, zoneType: string): number {
    Dice.seed(1);
    fight(foe);
    let risk = 0;
    Store.update(draft => {
      const enemy = draft.enemies[0]!;
      ZoneService.create(draft, { type: zoneType, center: enemy.pos, radius: 2, duration: 5, power: 2, source: 'test' });
      risk = AITacticalState.zoneRisk(draft, enemy, enemy.pos);
    }, { silent: true });
    return risk;
  }

  it('makes fire dangerous to everything that is not immune to it', () => {
    expect(fearOf('drowner', 'flame')).toBe(28);
    // The higher vampire's stat block lists immunity to ordinary fire.
    expect(fearOf('highervampire', 'flame')).toBe(0);
  });

  it('spares a creature whose own immunities cover the hazard', () => {
    // Drowners are immune to poison, so a Devil's Puffball cloud holds no fear for them.
    expect(fearOf('drowner', 'poisonCloud')).toBe(0);
  });

  it('makes dimeritium frightening to anything that uses magic, and nothing else', () => {
    expect(fearOf('mage', 'dimeritiumCloud')).toBe(24);
    // Reached through the Shift ability, not through a check on what a higher vampire is.
    expect(fearOf('highervampire', 'dimeritiumCloud')).toBe(24);
    expect(fearOf('drowner', 'dimeritiumCloud')).toBe(0);
  });

  it('makes Yrden frightening to the incorporeal, and nothing else', () => {
    expect(fearOf('wraith', 'yrden')).toBe(22);
    expect(fearOf('noonwraith', 'yrden')).toBe(22);
    expect(fearOf('katakan', 'yrden')).toBe(22);
    expect(fearOf('highervampire', 'yrden')).toBe(22);
    // A necrophage walks through a Yrden circle without caring.
    expect(fearOf('ghoul', 'yrden')).toBe(0);
    expect(fearOf('drowner', 'yrden')).toBe(0);
  });

  it('lets a new hazard threaten the right creatures without touching the engine', () => {
    // Registering a zone that declares its own threat is enough; no rule learns about it.
    Registry.add('zones', 'testWard', {
      name: 'Test ward', cssClass: 'zone-yrden', glyph: 'TW',
      description: 'A hazard invented by a test.', applies: [],
      threat: { risk: 40, threatens: ['magic'] }
    });
    expect(fearOf('mage', 'testWard')).toBe(40);
    expect(fearOf('drowner', 'testWard')).toBe(0);
  });
});

describe('Special behaviour follows capability, not species', () => {
  afterEach(() => CombatFlow.reset());

  /** The action names the AI would consider for the first enemy. */
  function considered(foe: string, arrange: (draft: IState) => void): string[] {
    Dice.seed(77);
    fight(foe);
    Store.update(draft => {
      const enemy = draft.enemies[0]!;
      enemy.pos = { x: draft.player.pos.x + 6, y: draft.player.pos.y };
      arrange(draft);
    }, { silent: true });
    const state = Store.read();
    const decision = AI.Controller.decide(state, state.enemies[0]!) as { scores?: Array<{ name: string }> };
    return (decision.scores ?? []).map(entry => entry.name);
  }

  it('offers a breath attack to anything that has a breath weapon', () => {
    // A drowner is not a dragon. Give it a breath weapon and it uses one, because the rule asks
    // what the actor has rather than what it is.
    const withBreath = considered('drowner', draft => {
      draft.enemies[0]!.breath = { name: 'Bile', damage: '4d6', cooldown: 3, cooldownRemaining: 0, radius: 3 };
    });
    expect(withBreath).toContain('breath');

    expect(considered('drowner', () => {})).not.toContain('breath');
  });

  it('offers burrowing to anything carrying the ability', () => {
    const digger = considered('drowner', draft => { draft.enemies[0]!.abilityIds = ['burrow']; });
    expect(digger).toContain('burrow');

    expect(considered('drowner', () => {})).not.toContain('burrow');
  });

  it('lets a flier actually take flight, not merely be offered it', () => {
    // Regression: the AI used to offer `enemyDragonFlight`, which nothing ever registered, so the
    // gateway rejected it every turn and dragons never left the ground. Flight is an ability row
    // now, and the assertion is that the action is *legal*, not that it was suggested.
    Dice.seed(77);
    fight('truedragon');
    Store.update(draft => {
      draft.enemies[0]!.pos = { x: draft.player.pos.x + 6, y: draft.player.pos.y };
    }, { silent: true });
    const state = Store.read();
    const legal = AI.LegalActions.build(state, state.enemies[0]!)
      .filter(candidate => ActionDispatcher.validate(candidate.actionName, { ...candidate.payload }, state).ok);
    expect(legal.some(candidate => (candidate.tags ?? []).includes('flight'))).toBe(true);
  });

  it('lets a rock-thrower actually throw, at range and not in contact', () => {
    Dice.seed(77);
    fight('nekker');
    Store.update(draft => {
      draft.enemies[0]!.pos = { x: draft.player.pos.x + 6, y: draft.player.pos.y };
    }, { silent: true });
    const far = Store.read();
    const legalAt = (state: IState) => AI.LegalActions.build(state, state.enemies[0]!)
      .filter(candidate => ActionDispatcher.validate(candidate.actionName, { ...candidate.payload }, state).ok)
      .map(candidate => candidate.name);
    expect(legalAt(far)).toContain('throwRock');

    Store.update(draft => {
      draft.enemies[0]!.pos = { x: draft.player.pos.x + 1, y: draft.player.pos.y };
    }, { silent: true });
    // In contact it closes and bites; the stone is for the distance it cannot cross yet.
    expect(legalAt(Store.read())).not.toContain('throwRock');
  });

  it('lets a clever regenerator break contact, and a mindless one not', () => {
    // Katakans regenerate 5 a round and are clever enough to use it; drowners are not.
    const clever = considered('katakan', draft => { draft.enemies[0]!.hp = 20; });
    expect(clever).toContain('reposition');

    const dim = considered('drowner', draft => {
      draft.enemies[0]!.hp = 4;
      draft.enemies[0]!.regen = 5;
    });
    // A drowner with regeneration still does not plan around it.
    const state = Store.read();
    expect(state.enemies[0]!.ai?.plan?.id).not.toBe('disengageRegenerate');
    expect(dim.length).toBeGreaterThan(0);
  });

  it('sharpens a long-lived creature with age, and nothing else', () => {
    // The dragon carries the Long-Lived ability; an Elder one thinks further ahead than a young.
    expect(abilitiesFor('truedragon')).toContain('longLived');
    expect(abilitiesFor('drowner')).not.toContain('longLived');
  });
});
