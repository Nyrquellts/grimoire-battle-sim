import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActionDispatcher, CombatFlow, Heroes, Store, defaultState } from '../../src/services/SimulationRuntime';
import { Registry } from '../../src/data/witcherContent';
import { HERO_ID, HeroRoster, actorFromSheet } from '../../src/services/PlayerCharacter';
import {
  STAT_IDS,
  buildHero,
  catalogueFrom,
  quickBuild,
  type HeroDraft
} from '../../src/services/CharacterBuilder';
import type { IState } from '../../src/entities/types';

/**
 * The playable hero: a finished sheet becomes a combat actor, the roster remembers who is playing,
 * and every race and profession the creator offers can actually take part in a fight.
 */

const catalogue = () => catalogueFrom(Registry);
const she = { subject: 'she', object: 'her', possessiveAdjective: 'her', possessivePronoun: 'hers', reflexive: 'herself' };

function draftFor(raceId: string, professionId: string, extra: Partial<HeroDraft> = {}): HeroDraft {
  return quickBuild({ raceId, professionId, name: 'Test Hero', ...extra }, catalogue());
}

function sheetFor(raceId: string, professionId: string, extra: Partial<HeroDraft> = {}) {
  return buildHero(draftFor(raceId, professionId, extra), catalogue()).sheet;
}

function freshRoster(): HeroRoster {
  return new HeroRoster({ registry: Registry, pronouns: () => ({ ...she }) });
}

describe('actorFromSheet', () => {
  it('makes a player-controlled humanoid with the sheet’s name', () => {
    const actor = actorFromSheet(sheetFor('human', 'man-at-arms'), she);
    expect(actor.id).toBe(HERO_ID);
    expect(actor.name).toBe('Test Hero');
    expect(actor.baseName).toBe('Test Hero');
    expect(actor.team).toBe('player');
    expect(actor.control).toBe('PLAYER');
    expect(actor.family).toBe('Human');
    expect(actor.anatomyId).toBe('humanoid');
  });

  it('gives every race the humanoid family, because it selects the hit-location model', () => {
    for (const race of ['human', 'elf', 'dwarf', 'witcher']) {
      expect(actorFromSheet(sheetFor(race, 'man-at-arms'), she).family).toBe('Human');
    }
  });

  it('carries each stat plus STUN, and every skill as a whole check value', () => {
    const sheet = sheetFor('human', 'bard');
    const actor = actorFromSheet(sheet, she);

    for (const id of STAT_IDS) expect(actor.stats?.[id]).toBe(sheet.stats[id]);
    expect(actor.stats?.STUN).toBe(sheet.derived.stun);
    for (const line of sheet.skills) expect(actor.skills?.[line.name]).toBe(line.check);
  });

  it('includes untrained skills at the bare stat rather than leaving them out', () => {
    const sheet = sheetFor('human', 'bard');
    const untrained = sheet.skills.find(line => line.level === 0);
    expect(untrained).toBeDefined();
    const actor = actorFromSheet(sheet, she);
    expect(actor.skills?.[untrained!.name]).toBe(sheet.stats[untrained!.stat]);
  });

  it('copies the derived vitals', () => {
    const sheet = sheetFor('witcher', 'witcher');
    const actor = actorFromSheet(sheet, she);
    expect(actor.hp).toBe(sheet.derived.hp);
    expect(actor.maxHp).toBe(sheet.derived.hp);
    expect(actor.sta).toBe(sheet.derived.sta);
    expect(actor.maxSta).toBe(sheet.derived.sta);
    expect(actor.rec).toBe(sheet.derived.rec);
    expect(actor.vigor).toBe(sheet.derived.vigor);
    expect(actor.toxicity).toBe(0);
    expect(actor.maxToxicity).toBe(100);
  });

  it('sets armour per location, keeping the maximum as a separate copy', () => {
    const sheet = sheetFor('human', 'man-at-arms');
    const actor = actorFromSheet(sheet, she);
    expect(actor.armorByLocation).toEqual(sheet.armorByLocation);
    expect(actor.armorMaxByLocation).toEqual(sheet.armorByLocation);

    actor.armorByLocation!.torso = 0;
    expect(actor.armorMaxByLocation!.torso).toBe(sheet.armorByLocation.torso);
  });

  it('gives a dwarf natural stopping power and everyone else none', () => {
    expect(actorFromSheet(sheetFor('dwarf', 'craftsman'), she).naturalSp).toBe(2);
    expect(actorFromSheet(sheetFor('human', 'craftsman'), she).naturalSp).toBe(0);
  });

  it('knows the basic Signs only when the profession does', () => {
    expect(actorFromSheet(sheetFor('witcher', 'witcher'), she).knownSigns).toEqual(['aard', 'igni', 'yrden', 'quen', 'axii']);
    expect(actorFromSheet(sheetFor('human', 'bard'), she).knownSigns).toEqual([]);
  });

  it('carries the weapons it was built with and draws a melee weapon first', () => {
    const sheet = sheetFor('human', 'man-at-arms');
    const actor = actorFromSheet(sheet, she);
    expect(actor.weapons).toEqual(sheet.weapons.map(weapon => weapon.id));
    expect(actor.weapons!.length).toBeGreaterThan(0);
    expect(Registry.weapons.get(String(actor.selectedWeapon))?.range).toBe('melee');
  });

  it('draws nothing when the hero owns no weapon at all', () => {
    const sheet = { ...sheetFor('human', 'bard'), weapons: [] };
    const actor = actorFromSheet(sheet, she);
    expect(actor.weapons).toEqual([]);
    expect('selectedWeapon' in actor).toBe(false);
  });

  it('carries rounds only when the hero owns a ranged weapon', () => {
    const armed = actorFromSheet(sheetFor('human', 'man-at-arms'), she);
    expect(armed.ammo).toEqual({ standard: 20 });
    const bare = actorFromSheet({ ...sheetFor('human', 'bard'), ammo: 0 }, she);
    expect(bare.ammo).toEqual({});
  });

  it('stocks the field kit into the bag for each kind', () => {
    const sheet = sheetFor('human', 'doctor');
    sheet.fieldKit = [
      { id: 'swallow', name: 'Swallow', kind: 'potion', count: 2 },
      { id: 'grapeshot', name: 'Grapeshot', kind: 'bomb', count: 1 },
      { id: 'cat', name: 'Cat', kind: 'potion', count: 1 }
    ];
    const inventory = actorFromSheet(sheet, she).inventory!;
    expect(inventory.potions).toEqual({ swallow: 2, cat: 1 });
    expect(inventory.bombs).toEqual({ grapeshot: 1 });
    expect(inventory.decoctions).toEqual({});
    expect(inventory.oils).toEqual({});
  });

  it('defends with its own Dodge and Resist Magic checks', () => {
    const sheet = sheetFor('elf', 'criminal');
    const actor = actorFromSheet(sheet, she);
    const check = (name: string) => sheet.skills.find(line => line.name === name)!.check;
    expect(actor.defenses?.dodge).toBe(check('Dodge / Escape'));
    expect(actor.defenses?.magic).toBe(check('Resist Magic'));
  });

  it('uses the pronouns it is given and does not share objects with the sheet', () => {
    const sheet = sheetFor('human', 'bard');
    const actor = actorFromSheet(sheet, she);
    expect((actor.identity?.pronouns as Record<string, string>).subject).toBe('she');

    actor.skills!.Awareness = 99;
    actor.appearance = { ...(actor.appearance as object) };
    expect(sheet.skills.find(line => line.name === 'Awareness')!.check).not.toBe(99);
  });
});

describe('HeroRoster', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/default-player.json', import.meta.url), 'utf8'));

  it('seats the default veteran exactly as the original sheet was written', () => {
    expect(freshRoster().create()).toEqual(fixture);
  });

  it('lists the veteran first, then each creator-built premade', () => {
    const cards = freshRoster().presets();
    expect(cards.map(card => card.id)).toEqual(['nikhail', 'isra-vale', 'maren-coldbrook', 'borgar-hammerfall', 'aelis-moonwater']);
    expect(cards[0]).toMatchObject({ kind: 'veteran', name: 'Nikhail' });
    expect(cards.slice(1).every(card => card.kind === 'fresh' && card.label.length > 0)).toBe(true);
  });

  it('names a premade once when its race and profession share a name', () => {
    const card = freshRoster().presets().find(candidate => candidate.id === 'isra-vale')!;
    expect(card.label).toBe('Witcher');
    expect(freshRoster().presets().find(candidate => candidate.id === 'borgar-hammerfall')!.label.startsWith('Dwarf ')).toBe(true);
  });

  it('builds every premade without a single error', () => {
    const roster = freshRoster();
    for (const card of roster.presets().filter(candidate => candidate.kind === 'fresh')) {
      const draft = roster.presetDraft(card.id)!;
      const result = roster.preview(draft);
      expect(result.issues.filter(issue => issue.level === 'error'), card.id).toEqual([]);
      expect(result.sheet.name).toBe(card.name);
    }
  });

  it('keeps every premade’s temperament registered as a personality profile', () => {
    const roster = freshRoster();
    for (const card of roster.presets()) {
      roster.choose(card.id);
      expect(Registry.personalityProfiles.has(String(roster.create().personalityProfile)), card.id).toBe(true);
    }
  });

  it('chooses a premade by id and refuses an unknown one without changing the choice', () => {
    const roster = freshRoster();
    expect(roster.choose('maren-coldbrook')).toBe(true);
    expect(roster.current()).toEqual({ kind: 'preset', id: 'maren-coldbrook', name: 'Maren Coldbrook' });
    expect(roster.choose('no-such-hero')).toBe(false);
    expect(roster.current().id).toBe('maren-coldbrook');
    expect(roster.create().name).toBe('Maren Coldbrook');
  });

  it('chooses a creator draft once it builds, and reports why when it does not', () => {
    const roster = freshRoster();
    const good = roster.use(draftFor('elf', 'bard', { name: 'Lark' }));
    expect(good.ok).toBe(true);
    expect(roster.current()).toEqual({ kind: 'custom', id: null, name: 'Lark' });
    expect(roster.create().name).toBe('Lark');

    const greedy = { ...draftFor('elf', 'bard', { name: 'Greedy' }), stats: Object.fromEntries(STAT_IDS.map(id => [id, 10])) } as unknown as HeroDraft;
    const bad = roster.use(greedy);
    expect(bad.ok).toBe(false);
    expect(bad.issues.some(issue => issue.field === 'stats')).toBe(true);
    expect(roster.current().name).toBe('Lark');
  });

  it('hands out a fresh actor on every call', () => {
    const roster = freshRoster();
    const first = roster.create();
    first.hp = 1;
    first.inventory!.bombs!.grapeshot = 0;
    const second = roster.create();
    expect(second.hp).toBe(45);
    expect(second.inventory!.bombs!.grapeshot).toBe(2);
  });

  it('puts the choice in the player’s seat during setup and never mid-battle', () => {
    const roster = freshRoster();
    roster.choose('aelis-moonwater');

    const setup = structuredClone(defaultState()) as IState;
    expect(roster.seat(setup)).toBe(true);
    expect(setup.player.name).toBe('Aelis Moonwater');
    expect(setup.ui.weapon).toBe(setup.player.selectedWeapon ?? '');
    expect(setup.ui.attackPane).toBe('melee');

    const fighting = structuredClone(defaultState()) as IState;
    fighting.phase = 'combat';
    expect(roster.seat(fighting)).toBe(false);
    expect(fighting.player.name).toBe('Nikhail');
  });

  it('hands the creator the draft behind the hero in the seat, when there is one', () => {
    const roster = freshRoster();
    expect(roster.draft()).toBeNull();

    roster.choose('isra-vale');
    expect(roster.draft()?.name).toBe('Isra Vale');

    expect(roster.use(draftFor('elf', 'bard', { name: 'Custom One' })).ok).toBe(true);
    const copy = roster.draft();
    expect(copy?.name).toBe('Custom One');
    copy!.name = 'Changed';
    expect(roster.draft()?.name).toBe('Custom One');
  });

  it('can reopen a premade’s draft in the creator, but not a veteran’s', () => {
    const roster = freshRoster();
    expect(roster.presetDraft('nikhail')).toBeNull();
    expect(roster.presetDraft('isra-vale')?.name).toBe('Isra Vale');
  });
});

describe('the hero in the live game', () => {
  beforeEach(() => { Heroes.choose('nikhail'); CombatFlow.reset(); });
  afterEach(() => { Heroes.choose('nikhail'); CombatFlow.reset(); });

  it('starts as the default veteran', () => {
    expect(defaultState().player.name).toBe('Nikhail');
    expect(Store.read().player.id).toBe('nikhail');
  });

  it('keeps the chosen hero through a reset and into the next battle', () => {
    Heroes.choose('maren-coldbrook');
    CombatFlow.reset();
    expect(Store.read().player.name).toBe('Maren Coldbrook');

    CombatFlow.start({ lineup: [{ foe: 'bandit', quantity: 1, region: 'Temeria', experience: 'random', loadout: 'random' }], situation: 'open' } as never);
    expect(Store.read().player.name).toBe('Maren Coldbrook');
    expect(Store.read().ui.weapon).toBe(Store.read().player.selectedWeapon);
  });

  it('lets the default action actor follow the hero in the seat', () => {
    Heroes.choose('isra-vale');
    CombatFlow.reset();
    const state = Store.read();
    expect(state.player.id).toBe(HERO_ID);
    expect(ActionDispatcher.validate('recover', {}, state).reason ?? '').not.toMatch(/Unknown actor/i);
  });
});

describe('every hero the creator can make can fight', () => {
  const races = ['human', 'elf', 'dwarf', 'witcher'];
  const professions = ['bard', 'craftsman', 'criminal', 'doctor', 'mage', 'man-at-arms', 'merchant', 'priest', 'witcher'];

  afterEach(() => { Heroes.choose('nikhail'); CombatFlow.reset(); });

  function enterFight(draft: HeroDraft): IState {
    expect(Heroes.use(draft).ok).toBe(true);
    CombatFlow.reset();
    CombatFlow.start({ lineup: [{ foe: 'bandit', quantity: 1, region: 'Temeria', experience: 'random', loadout: 'random' }], situation: 'open' } as never);
    Store.update(draft2 => {
      const enemy = draft2.enemies[0]!;
      enemy.pos = { x: draft2.player.pos.x + 1, y: draft2.player.pos.y };
      draft2.selectedEnemyId = enemy.id;
    }, { silent: true });
    return Store.read();
  }

  for (const race of races) {
    for (const profession of professions) {
      it(`${race} ${profession} strikes, with a weapon or bare-handed`, () => {
        const state = enterFight(draftFor(race, profession));
        const target = state.enemies[0]!;
        const weaponId = state.player.selectedWeapon;
        const attack = weaponId
          ? ActionDispatcher.execute('melee', { actorId: state.player.id, targetId: target.id, weaponId, mode: 'normal', called: 'random' })
          : ActionDispatcher.execute('barehanded', { actorId: state.player.id, targetId: target.id, move: 'punch', mode: 'normal' });
        expect(attack.ok, attack.reason).toBe(true);
        expect((Store.read().feed ?? []).length).toBeGreaterThan(0);
      });
    }
  }

  it('lets a hero shoot a bow bought at creation, with its own Archery skill and standard rounds', () => {
    const draft = draftFor('elf', 'man-at-arms');
    draft.weapons = ['longBow'];
    const built = buildHero(draft, catalogue());
    expect(built.ok, built.issues.map(issue => issue.message).join(' / ')).toBe(true);

    const state = enterFight(built.draft);
    Store.update(d => { d.enemies[0]!.pos = { x: d.player.pos.x + 5, y: d.player.pos.y }; }, { silent: true });
    const before = Store.read().player.ammo as Record<string, number>;
    const shot = ActionDispatcher.execute('ranged', { actorId: state.player.id, targetId: state.enemies[0]!.id, weaponId: 'longBow', mode: 'normal', called: 'random' });
    expect(shot.ok, shot.reason).toBe(true);
    expect((Store.read().player.ammo as Record<string, number>).standard).toBe(before.standard! - 1);
  });

  it('casts a Sign it knows and is refused one it has not learned', () => {
    const known = enterFight(draftFor('witcher', 'witcher'));
    expect(ActionDispatcher.validate('sign', { actorId: known.player.id, signId: 'quen', cost: 1 }, known).ok).toBe(true);

    const bard = enterFight(draftFor('human', 'bard'));
    const refused = ActionDispatcher.validate('sign', { actorId: bard.player.id, signId: 'quen', cost: 1 }, bard);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/has not learned Quen/);
  });
});
