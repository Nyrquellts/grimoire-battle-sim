import { afterEach, describe, expect, it } from 'vitest';
import {
  attackRequest,
  handleAttackChoice,
  meleeChoice,
  rangedChoice,
  renderAttackPalette,
  type AttackPanelDeps
} from '../../src/ui/panels/AttackPanel';
import { ActionDispatcher, CombatFlow, Heroes, Store, defaultState } from '../../src/services/SimulationRuntime';
import { Registry } from '../../src/data/witcherContent';
import { buildHero, catalogueFrom, quickBuild, type HeroDraft } from '../../src/services/CharacterBuilder';
import type { IActor, IState } from '../../src/entities/types';

/**
 * The Attack palette draws from whatever the hero carries, so a hero out of the creator is played
 * through the same controls as the premade veteran. Rendering is a string and clicks are plain
 * data, so none of this needs a DOM.
 */

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"]/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character);

const bandit = { id: 'bandit-1', name: 'Roadside Bandit' } as IActor;

function deps(over: Partial<AttackPanelDeps> = {}): AttackPanelDeps {
  return { esc, weapons: Registry.weapons, alchemy: Registry.alchemy.values(), lock: '', target: bandit, canAct: true, ...over };
}

/** A copy of the default state, with the hero edited by `edit` and the Attack tab on `pane`. */
function stateWith(pane: string, edit: (hero: IActor) => void = () => undefined): IState {
  const state = structuredClone(defaultState());
  state.ui.palette = 'attack';
  state.ui.attackPane = pane;
  state.selectedEnemyId = bandit.id;
  edit(state.player);
  return state;
}

function fakeStore(state: IState) {
  let current = state;
  return {
    read: () => current,
    update(mutator: (draft: IState) => void) {
      const draft = structuredClone(current) as IState;
      mutator(draft);
      current = draft;
      return draft;
    }
  };
}

const catalogue = () => catalogueFrom(Registry);

/** A bard's kit carries no crossbow, so what the test buys is the whole of his arsenal. */
function draftWith(weapons: string[]): HeroDraft {
  const draft = quickBuild({ raceId: 'human', professionId: 'bard', name: 'Test Hero' }, catalogue());
  draft.coinRoll = 12;
  draft.weapons = weapons;
  const built = buildHero(draft, catalogue());
  expect(built.ok, built.issues.map(issue => issue.message).join(' / ')).toBe(true);
  return built.draft;
}

describe('the Attack palette for the premade veteran', () => {
  it('offers each melee weapon he carries, with its damage', () => {
    const html = renderAttackPalette(stateWith('melee'), deps());
    for (const id of ['manticoreSteel', 'manticoreSilver', 'sipar']) expect(html).toContain(`data-choice="weapon" data-value="${id}"`);
    expect(html).toContain('5d6+6');
    expect(html).not.toContain('zerrikanianCrossbow');
  });

  it('highlights the weapon in hand and falls back to the first one carried', () => {
    const silver = stateWith('melee');
    silver.ui.weapon = 'manticoreSilver';
    expect(renderAttackPalette(silver, deps())).toMatch(/weapon-choice active" data-choice="weapon" data-value="manticoreSilver"/);
    expect(meleeChoice(silver, deps())?.id).toBe('manticoreSilver');

    const stale = stateWith('melee');
    stale.ui.weapon = 'a-sword-he-lost';
    expect(meleeChoice(stale, deps())?.id).toBe('manticoreSteel');
  });

  it('lets him strike only on his turn with someone selected', () => {
    const state = stateWith('melee');
    expect(renderAttackPalette(state, deps())).toMatch(/data-choice="melee" >/);
    expect(renderAttackPalette(state, deps({ target: undefined }))).toMatch(/data-choice="melee" disabled/);
    expect(renderAttackPalette(state, deps({ canAct: false }))).toMatch(/data-choice="melee" disabled/);
  });

  it('names the ranged tab after his weapon and counts his rounds', () => {
    const html = renderAttackPalette(stateWith('ranged'), deps());
    expect(html).toContain('data-choice="attackPane" data-value="ranged">Crossbow<');
    expect(html).toContain('loaded · 30 bolts');
    expect(html).toContain('data-choice="reload"');
  });

  it('reports an empty crossbow after a shot', () => {
    expect(renderAttackPalette(stateWith('ranged', hero => { hero.crossbowLoaded = false; }), deps())).toContain('empty · 30 bolts');
  });

  it('offers each kind of bolt with its own count', () => {
    const html = renderAttackPalette(stateWith('ranged'), deps());
    expect(html).toContain('data-choice="ammoType" data-value="standard"');
    expect(html).toContain('data-choice="ammoType" data-value="bodkin"');
    expect(html).toContain('20 bolts');
    expect(html).toContain('5 bolts');
  });

  it('lists exactly the bombs he carries', () => {
    const html = renderAttackPalette(stateWith('bombs'), deps());
    const carried = [...Registry.alchemy.values()].filter(item => item.kind === 'bomb');
    expect(carried.length).toBeGreaterThan(0);
    for (const bomb of carried) expect(html).toContain(`data-choice="bomb" data-value="${bomb.id}"`);
    expect(html).toContain('×2');
  });

  it('disables a bomb that has run out', () => {
    const [first] = [...Registry.alchemy.values()].filter(item => item.kind === 'bomb');
    const html = renderAttackPalette(stateWith('bombs', hero => { hero.inventory!.bombs![first!.id] = 0; }), deps());
    expect(html).toMatch(new RegExp(`data-choice="bomb" data-value="${first!.id}" disabled`));
  });
});

describe('the Attack palette for a hero from the creator', () => {
  it('shows an archer’s bow, arrows and no reload', () => {
    const state = stateWith('ranged', hero => { hero.weapons = ['longBow']; hero.selectedWeapon = 'longBow'; hero.ammo = { standard: 14 }; });
    const html = renderAttackPalette(state, deps());
    expect(html).toContain('data-value="ranged">Bow<');
    expect(html).toContain('14 arrows');
    expect(html).not.toContain('data-choice="reload"');
    expect(html).not.toContain('data-choice="ammoType"');
    expect(html).not.toContain('loaded ·');
  });

  it('says so, rather than showing a stranger’s sword, when no melee weapon is carried', () => {
    const state = stateWith('melee', hero => { hero.weapons = ['longBow']; hero.selectedWeapon = 'longBow'; });
    const html = renderAttackPalette(state, deps());
    expect(html).toContain('No melee weapon carried');
    expect(html).not.toContain('manticore');
    expect(html).not.toContain('data-choice="melee"');
  });

  it('says so when no ranged weapon is carried', () => {
    const state = stateWith('ranged', hero => { hero.weapons = ['armingSword']; hero.selectedWeapon = 'armingSword'; hero.ammo = {}; });
    expect(renderAttackPalette(state, deps())).toContain('No ranged weapon carried');
  });

  it('keeps the Brawl tab for an unarmed hero', () => {
    const state = stateWith('brawl', hero => { hero.weapons = []; delete hero.selectedWeapon; });
    const html = renderAttackPalette(state, deps());
    expect(html).toContain('data-choice="brawl" data-value="punch"');
    expect(html).toContain('data-choice="brawl" data-value="disarm"');
  });

  it('does not stumble on a hero with no bombs or no consumable bag at all', () => {
    expect(renderAttackPalette(stateWith('bombs', hero => { hero.inventory = {}; }), deps())).toContain('No bombs carried');
    expect(renderAttackPalette(stateWith('bombs', hero => { delete hero.inventory; }), deps())).toContain('No bombs carried');
  });

  it('lets the player pick between two ranged weapons and shoots the one chosen', () => {
    const state = stateWith('ranged', hero => { hero.weapons = ['longBow', 'handCrossbow']; hero.selectedWeapon = 'longBow'; hero.ammo = { standard: 9 }; });
    const store = fakeStore(state);
    const html = renderAttackPalette(store.read(), deps());
    expect(html).toContain('data-choice="rangedWeapon" data-value="longBow"');
    expect(html).toContain('data-choice="rangedWeapon" data-value="handCrossbow"');
    expect(rangedChoice(store.read(), deps())?.id).toBe('longBow');

    expect(handleAttackChoice('rangedWeapon', 'handCrossbow', store)).toBe(true);
    expect(rangedChoice(store.read(), deps())?.id).toBe('handCrossbow');
    expect(attackRequest('ranged', store.read(), undefined, deps())?.[1].weaponId).toBe('handCrossbow');
  });

  it('escapes weapon names it draws', () => {
    const weapons = { get: (id: string) => id === 'x' ? { id: 'x', name: '<script>alert(1)</script>', damage: '1d6', range: 'melee' } : undefined };
    const html = renderAttackPalette(stateWith('melee', hero => { hero.weapons = ['x']; hero.selectedWeapon = 'x'; }), deps({ weapons }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('what a click asks for', () => {
  it('asks to strike with the weapon chosen, in the mode and place chosen', () => {
    const store = fakeStore(stateWith('melee'));
    handleAttackChoice('weapon', 'sipar', store);
    handleAttackChoice('mode', 'strong', store);
    handleAttackChoice('called', 'head', store);
    expect(attackRequest('melee', store.read(), undefined, deps())).toEqual(['melee', {
      actorId: 'nikhail', targetId: 'bandit-1', weaponId: 'sipar', mode: 'strong', called: 'head'
    }]);
  });

  it('keeps the weapon in hand and the weapon highlighted in step', () => {
    const store = fakeStore(stateWith('melee'));
    handleAttackChoice('weapon', 'manticoreSilver', store);
    expect(store.read().player.selectedWeapon).toBe('manticoreSilver');
    expect(store.read().ui.weapon).toBe('manticoreSilver');
  });

  it('asks to shoot the weapon carried, naming a kind of round only when one was picked', () => {
    const store = fakeStore(stateWith('ranged'));
    expect(attackRequest('ranged', store.read(), undefined, deps())).toEqual(['ranged', {
      actorId: 'nikhail', targetId: 'bandit-1', weaponId: 'zerrikanianCrossbow', mode: 'normal', called: 'random'
    }]);

    handleAttackChoice('ammoType', 'bodkin', store);
    expect(attackRequest('ranged', store.read(), undefined, deps())?.[1].ammoType).toBe('bodkin');
  });

  it('ignores a kind of round that has run out', () => {
    const store = fakeStore(stateWith('ranged', hero => { hero.ammo = { standard: 4, bodkin: 0 }; }));
    handleAttackChoice('ammoType', 'bodkin', store);
    expect(attackRequest('ranged', store.read(), undefined, deps())?.[1]).not.toHaveProperty('ammoType');
  });

  it('names the weapon to reload', () => {
    expect(attackRequest('reload', stateWith('ranged'), undefined, deps())).toEqual(['reload', { actorId: 'nikhail', weaponId: 'zerrikanianCrossbow' }]);
  });

  it('builds brawl and bomb requests from the control’s value', () => {
    const state = stateWith('brawl');
    expect(attackRequest('brawl', state, 'sweep', deps())).toEqual(['barehanded', { actorId: 'nikhail', targetId: 'bandit-1', move: 'sweep', mode: 'normal' }]);
    expect(attackRequest('bomb', state, 'grapeshot', deps())).toEqual(['bomb', { actorId: 'nikhail', targetId: 'bandit-1', itemId: 'grapeshot' }]);
  });

  it('refuses to build a strike or a shot the hero has no weapon for', () => {
    const unarmed = stateWith('melee', hero => { hero.weapons = []; delete hero.selectedWeapon; });
    expect(attackRequest('melee', unarmed, undefined, deps())).toBeNull();
    expect(attackRequest('ranged', unarmed, undefined, deps())).toBeNull();
    expect(attackRequest('reload', unarmed, undefined, deps())).toBeNull();
  });

  it('leaves clicks it does not own to someone else', () => {
    const store = fakeStore(stateWith('melee'));
    expect(handleAttackChoice('sign', 'quen', store)).toBe(false);
    expect(attackRequest('sign', store.read(), 'quen', deps())).toBeNull();
    expect(attackRequest('potion', store.read(), 'swallow', deps())).toBeNull();
  });
});

describe('the palette in the live game', () => {
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

  it('lets a creator hero strike with the weapon the palette offers', () => {
    const state = enterFight(draftWith(['armingSword']));
    const lookup = deps({ target: state.enemies[0] });
    expect(renderAttackPalette(state, lookup)).toContain('data-choice="weapon" data-value="armingSword"');

    const request = attackRequest('melee', state, undefined, lookup)!;
    const result = ActionDispatcher.execute(request[0], request[1]);
    expect(result.ok, result.reason).toBe(true);
    expect(Store.read().feed?.length ?? 0).toBeGreaterThan(0);
  });

  it('lets a creator archer shoot through the request the palette builds', () => {
    const state = enterFight(draftWith(['longBow']));
    Store.update(d => { d.enemies[0]!.pos = { x: d.player.pos.x + 5, y: d.player.pos.y }; }, { silent: true });
    const before = (Store.read().player.ammo as Record<string, number>).standard!;

    const request = attackRequest('ranged', Store.read(), undefined, deps({ target: state.enemies[0] }))!;
    expect(request[1].weaponId).toBe('longBow');
    const result = ActionDispatcher.execute(request[0], request[1]);
    expect(result.ok, result.reason).toBe(true);
    expect((Store.read().player.ammo as Record<string, number>).standard).toBe(before - 1);
  });
});
