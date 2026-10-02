import { describe, expect, it } from 'vitest';
import { Registry } from '../../src/data/witcherContent';
import { HeroRoster } from '../../src/services/PlayerCharacter';
import {
  ARMOR_SLOTS, FIELD_KIT_ITEM_MAX, SKILL_CAP, STAT_IDS, STAT_MAX, STAT_MIN, STAT_TIERS,
  buildHero, catalogueFrom, normalizeDraft, quickBuild, rollStats,
  type Catalogue, type HeroDraft, type Roll
} from '../../src/services/CharacterBuilder';
import {
  applyCreatorAction, renderCreator, renderCreatorSheet, setCreatorField,
  type CreatorContext, type CreatorDeps, type CreatorModel
} from '../../src/ui/panels/CharacterPanel';

/**
 * The creator panel is a string renderer plus two pure reducers, so everything it does can be
 * checked without a DOM: what a button does to a draft, what the page says about the result, and
 * that nothing a player types reaches the markup unescaped. The rules themselves are pinned in
 * `characterBuilder.test.ts`; here the question is only whether the panel obeys them.
 */

const catalogue: Catalogue = catalogueFrom(Registry);
const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));

/** A roll that replays a fixed script, then repeats it. */
function scripted(...values: number[]): Roll {
  let index = 0;
  return () => values[index++ % values.length] ?? 1;
}

const context = (random: Roll = scripted(5)): CreatorContext => ({ catalogue, random });
const roster = (): HeroRoster => new HeroRoster({ registry: Registry, pronouns: () => ({}) });

function deps(overrides: Partial<CreatorDeps> = {}): CreatorDeps {
  const heroes = roster();
  return { esc, catalogue, presets: heroes.presets(), seated: heroes.current(), inCombat: false, ...overrides };
}

function model(draft: HeroDraft, extra: Partial<CreatorModel> = {}): CreatorModel {
  return { draft, notice: null, shareText: '', ...extra };
}

const hero = (raceId = 'human', professionId = 'bard', extra: Partial<HeroDraft> = {}): HeroDraft =>
  quickBuild({ raceId, professionId, name: 'Test Hero', ...extra }, catalogue);

const sheetOf = (draft: HeroDraft) => buildHero(draft, catalogue).sheet;
const lineOf = (draft: HeroDraft, name: string) => sheetOf(draft).skills.find(line => line.name === name);
const sumStats = (draft: HeroDraft): number => STAT_IDS.reduce((total, id) => total + draft.stats[id], 0);

/** A draft with nothing spent, so every budget has room. */
const blank = (professionId = 'bard', raceId = 'human'): HeroDraft =>
  normalizeDraft({ raceId, professionId, name: 'Blank' }, catalogue);

function act(action: string, value: string, draft: HeroDraft, random?: Roll): HeroDraft {
  const next = applyCreatorAction(action, value, draft, context(random));
  expect(next, `${action} should be a creator action`).not.toBeNull();
  return next as HeroDraft;
}

describe('choosing a people', () => {
  it('switches the people and keeps the name, looks and everything else', () => {
    const start = hero('human', 'bard', { region: 'Oxenfurt', appearance: { height: '180 cm', build: 'lean', hair: 'black', eyes: 'grey', skin: 'tan', notable: ['a scar'] } });
    const next = act('race', 'elf', start);

    expect(next.raceId).toBe('elf');
    expect(next.name).toBe('Test Hero');
    expect(next.region).toBe('Oxenfurt');
    expect(next.appearance.notable).toEqual(['a scar']);
    expect(next.professionId).toBe('bard');
  });

  it('moves an age left at the old default to the new people’s, but keeps one the player typed', () => {
    const human = catalogue.races.find(race => race.id === 'human');
    const elf = catalogue.races.find(race => race.id === 'elf');
    expect(human && elf).toBeTruthy();

    const atDefault = act('race', 'elf', hero('human', 'bard', { age: human?.defaultAge }));
    expect(atDefault.age).toBe(elf?.defaultAge);

    const typed = act('race', 'elf', hero('human', 'bard', { age: 41 }));
    expect(typed.age).toBe(41);
  });

  it('ignores a people that does not exist', () => {
    const start = hero();
    expect(act('race', 'gnome', start)).toEqual(start);
  });

  it('drops decoctions when the new people cannot take mutagens', () => {
    const witcher = hero('witcher', 'witcher', { fieldKit: { 'troll-decoction': 1 } });
    const next = act('race', 'human', quickBuild({ ...witcher, fieldKit: { 'troll-decoction': 1 } }, catalogue));
    expect(next.fieldKit['troll-decoction']).toBeUndefined();
  });
});

describe('choosing a calling', () => {
  it('refits the whole sheet to the new profession and keeps who the hero is', () => {
    const start = hero('human', 'bard', { gender: 'Female', region: 'Novigrad', temperament: 'nervous' });
    const next = act('profession', 'man-at-arms', start);

    expect(next.professionId).toBe('man-at-arms');
    expect(next.name).toBe('Test Hero');
    expect(next.gender).toBe('Female');
    expect(next.region).toBe('Novigrad');
    expect(next.temperament).toBe('nervous');
    expect(next.picks.combat).toHaveLength(5);
    expect(buildHero(next, catalogue).ok).toBe(true);
  });

  it('leaves a legal hero for every calling', () => {
    for (const profession of catalogue.professions) {
      const next = act('profession', profession.id, hero('human', 'bard'));
      expect(buildHero(next, catalogue).ok, profession.id).toBe(true);
    }
  });

  it('ignores a calling that does not exist', () => {
    const start = hero();
    expect(act('profession', 'jester', start)).toEqual(start);
  });
});

describe('attributes', () => {
  it('rolls all nine from the injected dice and switches to rolled mode', () => {
    const next = act('rollStats', '', hero(), scripted(7));
    expect(next.statMethod).toBe('roll');
    expect(next.stats).toEqual(rollStats(scripted(7)));
    expect(buildHero(next, catalogue).sheet.points.stats.spent).toBe(sumStats(next));
  });

  it('returns to a spent pool, spread by the calling, when asked to spend instead of roll', () => {
    const rolled = act('rollStats', '', hero(), scripted(9));
    const pooled = act('method', 'pool', rolled);
    expect(pooled.statMethod).toBe('pool');
    expect(sumStats(pooled)).toBe(STAT_TIERS[pooled.statTier]);
  });

  it('keeps the rolled stats when the player picks roll again from the method buttons', () => {
    const next = act('method', 'roll', hero(), scripted(6));
    expect(next.statMethod).toBe('roll');
    expect(next.stats).toEqual(rollStats(scripted(6)));
  });

  it('auto-assign refills a pool the player emptied', () => {
    const start = normalizeDraft({ ...hero(), stats: { INT: 1, REF: 1, DEX: 1, BODY: 1, SPD: 1, EMP: 1, CRA: 1, WILL: 1, LUCK: 1 } }, catalogue);
    const next = act('autoStats', '', start);
    expect(sumStats(next)).toBe(STAT_TIERS[next.statTier]);
  });

  it('moves one point at a time inside the pool', () => {
    const full = hero();
    expect(sumStats(full)).toBe(STAT_TIERS[full.statTier]);

    const lowered = act('statDown', 'INT', full);
    expect(lowered.stats.INT).toBe(full.stats.INT - 1);

    const raised = act('statUp', 'DEX', lowered);
    expect(raised.stats.DEX).toBe(lowered.stats.DEX + 1);
    expect(sumStats(raised)).toBe(STAT_TIERS[raised.statTier]);
  });

  it('refuses to spend past the pool, above the stat cap, or below the floor', () => {
    const full = hero();
    expect(act('statUp', 'INT', full)).toEqual(full);

    const room = normalizeDraft({ ...full, stats: { ...full.stats, INT: STAT_MAX, DEX: STAT_MIN } }, catalogue);
    expect(sumStats(room)).toBeLessThan(STAT_TIERS[room.statTier]);
    expect(act('statUp', 'INT', room)).toEqual(room);
    expect(act('statDown', 'DEX', room)).toEqual(room);
  });

  it('treats rolled attributes as fixed: the steppers do nothing until the player returns to a pool', () => {
    const rolled = act('rollStats', '', hero(), scripted(6));
    expect(act('statUp', 'INT', rolled)).toEqual(rolled);
    expect(act('statDown', 'INT', rolled)).toEqual(rolled);
  });

  it('ignores an attribute that does not exist', () => {
    const start = hero();
    expect(act('statUp', 'MANA', start)).toEqual(start);
  });

  it('applies the chosen pool size from the select', () => {
    const next = setCreatorField('statTier', 'legends', hero(), catalogue);
    expect(next?.statTier).toBe('legends');
  });
});

describe('skills', () => {
  it('charges a hard pick-up skill two points a level and an easy one a single point', () => {
    const start = blank();
    const hard = catalogue.skills.find(skill => skill.hard && !skill.profession && skill.group !== 'languages');
    const easy = catalogue.skills.find(skill => !skill.hard && !skill.profession && skill.group !== 'combat' && skill.group !== 'languages');
    expect(hard && easy).toBeTruthy();

    const afterHard = act('skillUp', hard?.name ?? '', start);
    expect(lineOf(afterHard, hard?.name ?? '')?.purchased).toBe(1);
    expect(sheetOf(afterHard).points.pickup.spent).toBe(2);

    const afterEasy = act('skillUp', easy?.name ?? '', afterHard);
    expect(sheetOf(afterEasy).points.pickup.spent).toBe(3);
  });

  it('stops at the skill cap', () => {
    const skill = catalogue.skills.find(row => !row.hard && !row.profession && row.group !== 'languages' && row.group !== 'combat');
    const name = skill?.name ?? '';
    const capped = normalizeDraft({ ...blank(), levels: { [name]: SKILL_CAP } }, catalogue);
    expect(act('skillUp', name, capped)).toEqual(capped);
  });

  it('stops when the pick-up budget is spent, and gives the points back when a skill is lowered', () => {
    const start = hero();
    const pickup = sheetOf(start).skills.filter(line => line.role === 'pickup' && line.purchased > 0);
    expect(pickup.length).toBeGreaterThan(0);

    const target = pickup[0]?.name ?? '';
    expect(sheetOf(start).points.pickup.spent).toBe(sheetOf(start).points.pickup.budget);
    expect(act('skillUp', target, start)).toEqual(start);

    const lowered = act('skillDown', target, start);
    expect(lineOf(lowered, target)?.purchased).toBe((pickup[0]?.purchased ?? 0) - 1);
    expect(sheetOf(lowered).points.pickup.spent).toBeLessThan(sheetOf(lowered).points.pickup.budget);
  });

  it('keeps one point in every package skill, but lets a pick-up skill go to nothing', () => {
    const built = hero();
    const packaged = sheetOf(built).skills.find(line => line.role !== 'pickup');
    expect(packaged).toBeTruthy();
    const name = packaged?.name ?? '';
    const start = normalizeDraft({ ...built, levels: { ...built.levels, [name]: 1 } }, catalogue);
    expect(act('skillDown', name, start)).toEqual(start);

    const easy = catalogue.skills.find(skill => !skill.hard && !skill.profession && skill.group !== 'combat' && skill.group !== 'languages')?.name ?? '';
    const single = normalizeDraft({ ...blank(), levels: { [easy]: 1 } }, catalogue);
    expect(lineOf(single, easy)?.purchased).toBe(1);
    expect(lineOf(act('skillDown', easy, single), easy)?.purchased).toBe(0);
  });

  it('ignores a skill that does not exist', () => {
    const start = hero();
    expect(act('skillUp', 'Teleportation', start)).toEqual(start);
    expect(act('skillDown', 'Teleportation', start)).toEqual(start);
  });

  it('keeps every sequence of steps legal: no skill step can overspend a budget', () => {
    let draft = hero();
    const names = sheetOf(draft).skills.map(line => line.name);
    for (let step = 0; step < 120; step += 1) {
      const name = names[step % names.length] ?? '';
      draft = act(step % 3 === 0 ? 'skillDown' : 'skillUp', name, draft);
      const { points } = sheetOf(draft);
      expect(points.pickup.spent).toBeLessThanOrEqual(points.pickup.budget);
      expect(points.package.spent).toBeLessThanOrEqual(points.package.budget);
    }
  });
});

describe('profession picks', () => {
  it('swaps a single-choice slot for the new choice and trains it at level one', () => {
    const start = hero('human', 'bard');
    expect(start.picks.language).toEqual(['Elder Speech']);

    const next = act('pick', 'language|Dwarven', start);
    expect(next.picks.language).toEqual(['Dwarven']);
    expect(next.levels['Elder Speech']).toBeUndefined();
    expect(next.levels.Dwarven).toBeGreaterThanOrEqual(1);
  });

  it('a multi-choice slot takes up to its count, and replaces the oldest when full', () => {
    const start = hero('human', 'man-at-arms');
    expect(start.picks.combat).toHaveLength(5);
    const missing = catalogue.skills.find(skill => skill.group === 'combat' && !start.picks.combat?.includes(skill.name));
    expect(missing).toBeTruthy();

    const next = act('pick', `combat|${missing?.name}`, start);
    expect(next.picks.combat).toHaveLength(5);
    expect(next.picks.combat).toContain(missing?.name);
    expect(next.picks.combat).not.toContain(start.picks.combat?.[0]);
  });

  it('un-picks a choice that is tapped again', () => {
    const start = hero('human', 'man-at-arms');
    const first = start.picks.combat?.[0] ?? '';
    const next = act('pick', `combat|${first}`, start);
    expect(next.picks.combat).toHaveLength(4);
    expect(next.picks.combat).not.toContain(first);
    expect(buildHero(next, catalogue).issues.some(issue => issue.field === 'picks.combat')).toBe(true);
  });

  it('ignores choices the slot does not offer', () => {
    const start = hero('human', 'bard');
    expect(act('pick', 'language|Swordsmanship', start)).toEqual(start);
    expect(act('pick', 'nowhere|Dwarven', start)).toEqual(start);
  });
});

describe('kit, coin and gear', () => {
  it('takes and drops calling kit items up to the limit', () => {
    const start = normalizeDraft({ ...blank('merchant'), kit: [] }, catalogue);
    const labels = catalogue.professions.find(row => row.id === 'merchant')?.kit.items.map(item => item.label) ?? [];

    let draft = start;
    for (const label of labels) draft = act('kit', label, draft);
    expect(draft.kit).toHaveLength(3);

    const dropped = act('kit', draft.kit[0] ?? '', draft);
    expect(dropped.kit).toHaveLength(2);
  });

  it('a one-item kit swaps instead of stacking', () => {
    // No shipped profession has a pick of one, so exercise the rule on a copy of the catalogue.
    const single: Catalogue = {
      ...catalogue,
      professions: catalogue.professions.map(row => row.id === 'merchant' ? { ...row, kit: { ...row.kit, pick: 1 } } : row)
    };
    const first = applyCreatorAction('kit', 'Dagger', blank('merchant'), { catalogue: single, random: scripted(5) });
    const second = applyCreatorAction('kit', 'Journal', first as HeroDraft, { catalogue: single, random: scripted(5) });
    expect(second?.kit).toEqual(['Journal']);
  });

  it('rolls starting coin with the injected dice, and can take the average', () => {
    const rolled = act('rollCoin', '', hero(), scripted(6, 5));
    expect(rolled.coinRoll).toBe(11);
    expect(act('averageCoin', '', rolled).coinRoll).toBe(7);
  });

  it('buys a weapon it can afford and sells it back', () => {
    const start = normalizeDraft({ ...blank('man-at-arms'), coinRoll: 7 }, catalogue);
    const bought = act('weapon', 'dagger', start);
    expect(bought.weapons).toEqual(['dagger']);
    expect(sheetOf(bought).coin.spent).toBe(50);
    expect(sheetOf(bought).weapons.some(weapon => weapon.id === 'dagger')).toBe(true);

    const sold = act('weapon', 'dagger', bought);
    expect(sold.weapons).toEqual([]);
    expect(sheetOf(sold).coin.spent).toBe(0);
  });

  it('refuses a weapon the hero cannot pay for, and one that is not for sale', () => {
    const poor = normalizeDraft({ ...blank('witcher', 'witcher'), coinRoll: 2 }, catalogue);
    expect(act('weapon', 'monsterCrossbow', poor)).toEqual(poor);
    expect(act('weapon', 'nothing', poor)).toEqual(poor);
  });

  it('never lets any sequence of purchases overspend the coin', () => {
    let draft = hero('human', 'witcher');
    const ids = [...catalogue.weapons.values()].filter(weapon => weapon.cost !== undefined).map(weapon => weapon.id);
    for (let step = 0; step < 60; step += 1) {
      draft = act('weapon', ids[(step * 7) % ids.length] ?? '', draft);
      const { coin } = sheetOf(draft);
      expect(coin.spent).toBeLessThanOrEqual(coin.total);
    }
  });

  it('sets, replaces and clears armour through the slot selects', () => {
    const start = normalizeDraft({ ...blank('mage'), coinRoll: 12 }, catalogue);
    const cheap = catalogue.armor.find(piece => piece.slot === 'head');
    expect(cheap).toBeTruthy();

    const worn = setCreatorField('armor:head', cheap?.id ?? '', start, catalogue);
    expect(worn?.armor.head).toBe(cheap?.id);
    const bare = setCreatorField('armor:head', '', worn as HeroDraft, catalogue);
    expect(bare?.armor.head).toBeUndefined();

    expect(setCreatorField('armor:neck', 'x', start, catalogue)).toBeNull();
    const wrongSlot = catalogue.armor.find(piece => piece.slot === 'legs');
    expect(setCreatorField('armor:head', wrongSlot?.id ?? '', start, catalogue)?.armor.head).toBeUndefined();
  });

  it('builds the field kit within its point budget and the per-item cap', () => {
    let draft = hero('witcher', 'witcher');
    for (let step = 0; step < 40; step += 1) {
      draft = act('fieldUp', 'cat', draft);
      draft = act('fieldUp', 'troll-decoction', draft);
      const { points } = sheetOf(draft);
      expect(points.fieldKit.spent).toBeLessThanOrEqual(points.fieldKit.budget);
    }
    expect(draft.fieldKit.cat ?? 0).toBeLessThanOrEqual(FIELD_KIT_ITEM_MAX);

    const lowered = act('fieldDown', 'cat', draft);
    expect((lowered.fieldKit.cat ?? 0)).toBe((draft.fieldKit.cat ?? 0) - 1);
    expect(act('fieldDown', 'swallow', blank('witcher', 'witcher'))).toEqual(blank('witcher', 'witcher'));
  });

  it('keeps decoctions out of reach of a people that cannot take mutagens', () => {
    const start = hero('human', 'bard');
    expect(act('fieldUp', 'troll-decoction', start).fieldKit['troll-decoction']).toBeUndefined();
  });
});

describe('quick build, randomize and names', () => {
  it('quick build refits the sheet but keeps who the hero is', () => {
    const messy = normalizeDraft({ ...hero(), levels: {}, weapons: [], kit: [] }, catalogue);
    const next = act('quick', '', messy);
    expect(buildHero(next, catalogue).ok).toBe(true);
    expect(next.name).toBe('Test Hero');
  });

  it('randomize makes a whole new legal hero from the injected dice, and keeps the chosen pool size', () => {
    const next = act('randomize', '', hero('human', 'bard', { statTier: 'heroes' }), scripted(2, 3, 1, 4));
    expect(buildHero(next, catalogue).ok).toBe(true);
    expect(next.statTier).toBe('heroes');
    expect(next.name.length).toBeGreaterThan(0);
  });

  it('randomize is deterministic for the same dice', () => {
    const a = act('randomize', '', hero(), scripted(3, 1, 2));
    const b = act('randomize', '', hero(), scripted(3, 1, 2));
    expect(a).toEqual(b);
  });

  it('suggests a name that fits the people and gender', () => {
    const next = act('suggestName', '', hero('elf', 'bard', { name: '', gender: 'Female' }), scripted(1));
    expect(next.name.length).toBeGreaterThan(0);
    expect(next.name.length).toBeLessThanOrEqual(40);
  });

  it('leaves the draft to the shell for actions the panel does not own', () => {
    for (const action of ['use', 'play', 'edit', 'export', 'import', 'nothing']) {
      expect(applyCreatorAction(action, '', hero(), context())).toBeNull();
    }
  });
});

describe('typed fields', () => {
  it('names the hero, trims the text and caps its length', () => {
    const start = hero();
    expect(setCreatorField('name', '  Ysolde of the Vale  ', start, catalogue)?.name).toBe('Ysolde of the Vale');
    expect(setCreatorField('name', 'x'.repeat(200), start, catalogue)?.name).toHaveLength(40);
  });

  it('keeps an empty name empty, so the sheet can ask for one', () => {
    const next = setCreatorField('name', '', hero(), catalogue) as HeroDraft;
    expect(next.name).toBe('');
    const result = buildHero(next, catalogue);
    expect(result.ok).toBe(false);
    expect(result.issues.some(issue => issue.field === 'name' && issue.level === 'error')).toBe(true);
  });

  it('edits identity, looks and marks', () => {
    let draft = hero();
    draft = setCreatorField('region', 'Skellige', draft, catalogue) as HeroDraft;
    draft = setCreatorField('temperament', 'aggressive', draft, catalogue) as HeroDraft;
    draft = setCreatorField('gender', 'Nonbinary', draft, catalogue) as HeroDraft;
    draft = setCreatorField('age', '57', draft, catalogue) as HeroDraft;
    draft = setCreatorField('hair', 'silver braid', draft, catalogue) as HeroDraft;
    draft = setCreatorField('eyes', 'amber', draft, catalogue) as HeroDraft;
    draft = setCreatorField('notable', 'torn ear, rune tattoo, , limp, scar, extra', draft, catalogue) as HeroDraft;

    expect(draft.region).toBe('Skellige');
    expect(draft.temperament).toBe('aggressive');
    expect(draft.gender).toBe('Nonbinary');
    expect(draft.age).toBe(57);
    expect(draft.appearance.hair).toBe('silver braid');
    expect(draft.appearance.eyes).toBe('amber');
    expect(draft.appearance.notable).toEqual(['torn ear', 'rune tattoo', 'limp', 'scar']);
  });

  it('cleans rubbish: unknown genders, temperaments, and ages out of range', () => {
    const start = hero();
    expect((setCreatorField('gender', 'Robot', start, catalogue) as HeroDraft).gender).toBe('Male');
    expect((setCreatorField('temperament', 'furious', start, catalogue) as HeroDraft).temperament).toBe('disciplined');
    expect((setCreatorField('age', '3', start, catalogue) as HeroDraft).age).toBe(14);
    expect((setCreatorField('age', '99999', start, catalogue) as HeroDraft).age).toBe(500);
    expect(typeof (setCreatorField('age', 'abc', start, catalogue) as HeroDraft).age).toBe('number');
  });

  it('strips markup out of every typed field before it is stored', () => {
    let draft = hero();
    draft = setCreatorField('name', '<img src=x onerror=alert(1)>Bob', draft, catalogue) as HeroDraft;
    draft = setCreatorField('region', '<b>Here</b>', draft, catalogue) as HeroDraft;
    draft = setCreatorField('notable', '<script>x</script>', draft, catalogue) as HeroDraft;
    expect(JSON.stringify(draft)).not.toMatch(/[<>]/);
  });

  it('ignores fields the creator does not edit', () => {
    expect(setCreatorField('hp', '9999', hero(), catalogue)).toBeNull();
    expect(setCreatorField('__proto__', 'x', hero(), catalogue)).toBeNull();
  });
});

describe('rendering the creator', () => {
  it('shows every section, every people, every calling and every premade hero', () => {
    const html = renderCreator(model(hero()), deps());
    for (const heading of ['Choose a hero or build your own', 'Who are they?', 'Which people?', 'Which calling?', 'How are they made?', 'What can they do?', 'What do they carry?', 'Keep or share']) {
      expect(html, heading).toContain(heading);
    }
    for (const race of catalogue.races) expect(html).toContain(`data-creator="race" data-value="${race.id}"`);
    for (const profession of catalogue.professions) expect(html).toContain(`data-creator="profession" data-value="${profession.id}"`);
    for (const preset of roster().presets()) expect(html).toContain(`data-value="${preset.id}"`);
  });

  it('marks the chosen people and calling as pressed', () => {
    const html = renderCreator(model(hero('dwarf', 'craftsman')), deps());
    expect(html).toMatch(/pick-card active"[^>]*data-creator="race" data-value="dwarf" aria-pressed="true"/);
    expect(html).toMatch(/pick-card active"[^>]*data-creator="profession" data-value="craftsman" aria-pressed="true"/);
    expect(html).toMatch(/data-creator="race" data-value="elf" aria-pressed="false"/);
  });

  it('prints the hero’s name and the live numbers on the sheet', () => {
    const draft = hero('human', 'man-at-arms', { name: 'Ysolde' });
    const sheet = sheetOf(draft);
    const html = renderCreatorSheet(model(draft), deps());

    expect(html).toContain('Ysolde');
    expect(html).toContain(`<b>${sheet.derived.hp}</b>`);
    for (const id of STAT_IDS) expect(html).toContain(`<small>${id}</small><b>${sheet.stats[id]}</b>`);
    for (const weapon of sheet.weapons) expect(html).toContain(weapon.name);
    for (const slot of ARMOR_SLOTS) expect(html).toContain({ head: 'Head', torso: 'Torso and arms', legs: 'Legs' }[slot]);
    expect(html).toContain(`${sheet.coin.spent} of ${sheet.coin.total} crowns spent`);
  });

  it('says a legal hero is ready and offers to use them', () => {
    const html = renderCreatorSheet(model(hero()), deps());
    expect(html).toContain('Ready for battle.');
    expect(html).toMatch(/data-creator="use" >Use this hero/);
    expect(html).not.toMatch(/data-creator="use" disabled/);
  });

  it('turns the use button off and lists the problems while the hero is illegal', () => {
    const html = renderCreatorSheet(model(normalizeDraft({ ...hero(), name: '' }, catalogue)), deps());
    expect(html).toContain('Give your hero a name.');
    expect(html).toMatch(/data-creator="use" disabled/);
    expect(html).toContain('Fix the problems above to use this hero.');
    expect(html).not.toContain('Ready for battle.');
  });

  it('lists problems before warnings and warnings before notes', () => {
    const draft = normalizeDraft({ ...blank('mage'), name: '' }, catalogue);
    const html = renderCreatorSheet(model(draft), deps());
    const error = html.indexOf('issue error');
    const warning = html.indexOf('issue warning');
    const note = html.indexOf('issue note');
    expect(error).toBeGreaterThan(-1);
    expect(warning).toBeGreaterThan(error);
    expect(note).toBeGreaterThan(warning);
  });

  it('says a hero waits for the next battle while one is running', () => {
    expect(renderCreatorSheet(model(hero()), deps({ inCombat: true }))).toContain('joins the next one');
    expect(renderCreatorSheet(model(hero()), deps({ inCombat: false }))).toContain('You will fight the next battle as this hero.');
  });

  it('reads Update when the hero in the seat is the one on screen', () => {
    const html = renderCreatorSheet(model(hero('human', 'bard', { name: 'Marta' })), deps({ seated: { kind: 'custom', id: null, name: 'Marta' } }));
    expect(html).toContain('Update this hero');
  });

  it('shows the notice the shell hands it, with its tone', () => {
    const good = renderCreatorSheet(model(hero(), { notice: { tone: 'ok', text: 'Hero imported.' } }), deps());
    expect(good).toContain('creator-notice ok');
    expect(good).toContain('Hero imported.');
    const bad = renderCreatorSheet(model(hero(), { notice: { tone: 'bad', text: 'That is not a hero file.' } }), deps());
    expect(bad).toContain('creator-notice bad');
  });

  it('marks the active premade and offers a copy to edit only for fresh heroes', () => {
    const heroes = roster();
    const html = renderCreator(model(hero()), deps({ seated: heroes.current(), presets: heroes.presets() }));
    const seated = heroes.current();
    expect(html).toMatch(new RegExp(`hero-card active[\\s\\S]*?${seated.name}`));
    for (const preset of heroes.presets()) {
      const edit = `data-creator="edit" data-value="${preset.id}"`;
      expect(html.includes(edit), preset.id).toBe(preset.kind === 'fresh');
    }
  });

  it('shows the hero the player built in the shelf once they hold the seat', () => {
    const html = renderCreator(model(hero()), deps({ seated: { kind: 'custom', id: null, name: 'Marta' } }));
    expect(html).toContain('Marta');
    expect(html).toContain('Built in the creator');
    expect(html).not.toMatch(/hero-card active[^>]*>[\s\S]{0,80}Veteran/);
  });

  it('shows the share box with whatever text the shell holds', () => {
    const html = renderCreator(model(hero(), { shareText: '{"format":"grimoire-hero"}' }), deps());
    expect(html).toContain('id="creatorShare"');
    expect(html).toContain('{&quot;format&quot;:&quot;grimoire-hero&quot;}');
    expect(html).toContain('data-creator="export"');
    expect(html).toContain('data-creator="import"');
  });

  it('disables a step the rules would refuse, and enables it when there is room', () => {
    const full = renderCreator(model(hero()), deps());
    expect(full).toMatch(/data-creator="statUp" data-value="INT" aria-label="Increase Intelligence" disabled/);
    const room = renderCreator(model(normalizeDraft({ ...hero(), stats: { ...hero().stats, INT: 1 } }, catalogue)), deps());
    expect(room).toMatch(/data-creator="statUp" data-value="DEX" aria-label="Increase Dexterity" >/);
    expect(room).toMatch(/data-creator="statDown" data-value="INT" aria-label="Decrease Intelligence" disabled/);
  });

  it('shows no steppers for rolled attributes, and a roll-again button', () => {
    const rolled = act('rollStats', '', hero(), scripted(7));
    const html = renderCreator(model(rolled), deps());
    expect(html).not.toContain('data-creator="statUp"');
    expect(html).toContain('data-creator="rollStats"');
    expect(html).not.toContain('data-creator="autoStats"');
  });

  it('shows a weapon the hero cannot afford as disabled, and one in the free kit as already carried', () => {
    const draft = normalizeDraft({ ...blank('witcher', 'witcher'), coinRoll: 2 }, catalogue);
    const html = renderCreator(model(draft), deps());
    expect(html).toMatch(/data-creator="weapon" data-value="monsterCrossbow" aria-pressed="false" disabled/);

    const kitHtml = renderCreator(model(hero('human', 'man-at-arms')), deps());
    expect(kitHtml).toMatch(/data-creator="weapon" data-value="kord" aria-pressed="false" disabled>[\s\S]*?in kit/);
  });

  it('says which people cannot take decoctions and locks those rows', () => {
    const human = renderCreator(model(hero('human', 'bard')), deps());
    expect(human).toContain('This people cannot take decoctions.');
    expect(human).toMatch(/field-row locked/);

    const witcher = renderCreator(model(hero('witcher', 'witcher')), deps());
    expect(witcher).not.toContain('This people cannot take decoctions.');
    expect(witcher).not.toMatch(/field-row locked/);
  });

  it('names the calling once when the people and the calling share a name', () => {
    const witcher = renderCreatorSheet(model(hero('witcher', 'witcher')), deps());
    expect(witcher).toContain('<small>Witcher · ');
    expect(witcher).not.toContain('Witcher Witcher');

    const dwarf = renderCreatorSheet(model(hero('dwarf', 'craftsman')), deps());
    expect(dwarf).toContain('<small>Dwarf Craftsman · ');
  });

  it('reads weapon effects the way a player would, not as raw ids', () => {
    const html = renderCreator(model(hero()), deps());
    for (const label of ['bleeding 25%', 'long reach', 'stun −2', 'focus 1', 'armor piercing']) expect(html, label).toContain(label);
    expect(html).not.toMatch(/Bleeding25|bleeding25|LongReach|longreach|Stun-2|stun-2/);
  });

  it('is deterministic: the same draft renders the same page', () => {
    const draft = hero('elf', 'mage');
    expect(renderCreator(model(draft), deps())).toBe(renderCreator(model(draft), deps()));
  });

  it('renders every race and calling combination without throwing', () => {
    for (const race of catalogue.races) {
      for (const profession of catalogue.professions) {
        const html = renderCreator(model(hero(race.id, profession.id)), deps());
        expect(html.length, `${race.id}/${profession.id}`).toBeGreaterThan(1000);
        expect(html).not.toMatch(/undefined|NaN|\[object/);
      }
    }
  });
});

describe('escaping', () => {
  const hostile = '"><img src=x onerror=alert(1)>';

  it('escapes the name wherever it appears', () => {
    const draft = { ...hero(), name: hostile };
    const html = renderCreator(model(draft), deps({ seated: { kind: 'custom', id: null, name: hostile } }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes every typed field, the share text and the notice', () => {
    const draft: HeroDraft = {
      ...hero(),
      region: hostile,
      appearance: { height: hostile, build: hostile, hair: hostile, eyes: hostile, skin: hostile, notable: [hostile] }
    };
    const html = renderCreator(
      model(draft, { shareText: `</textarea><script>alert(1)</script>`, notice: { tone: 'bad', text: hostile } }),
      deps()
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('</textarea><');
  });

  it('escapes premade hero text from the registry', () => {
    const html = renderCreator(model(hero()), deps({ presets: [{ id: 'x', name: hostile, summary: hostile, kind: 'fresh', label: hostile }] }));
    expect(html).not.toContain('<img');
  });
});

describe('the premade shelf and the roster agree', () => {
  it('lists the veteran first, then each fresh hero, with the roster’s own labels', () => {
    const presets = roster().presets();
    expect(presets[0]?.kind).toBe('veteran');
    const html = renderCreator(model(hero()), deps({ presets }));
    for (const preset of presets) expect(html).toContain(esc(preset.label));
  });

  it('every fresh premade opens in the creator as a legal hero', () => {
    const heroes = roster();
    for (const preset of heroes.presets().filter(card => card.kind === 'fresh')) {
      const draft = heroes.presetDraft(preset.id);
      expect(draft, preset.id).not.toBeNull();
      expect(buildHero(draft as HeroDraft, catalogue).ok, preset.id).toBe(true);
    }
  });
});
