import { describe, expect, it } from 'vitest';
import { Registry } from '../../src/data/witcherContent';
import {
  ARMOR_SLOTS, BASIC_SIGNS, FIELD_KIT_BASE, PACKAGE_POINTS, SKILL_CAP, STAT_IDS, STAT_TIERS, STARTING_AMMO,
  HERO_FILE_MAX, HERO_FORMAT, HERO_VERSION,
  buildHero, catalogueFrom, cleanText, deriveValues, exportHero, finalStats, importHero, newDraft, normalizeDraft,
  purchasableWeapons, quickBuild, rollCoin, rollStats, suggestName,
  type Catalogue, type HeroDraft, type Roll, type StatTier, type Stats
} from '../../src/services/CharacterBuilder';

/**
 * The character builder is pure rules over a catalogue, so these tests pin the rules down in
 * numbers: pool sizes, caps, costs, derived values, racial adjustments, and the guarantee that
 * every quick build is a legal hero. Content integrity is checked here too, because a profession
 * that names a skill the catalogue lacks would otherwise only fail when someone picked it.
 */

const catalogue: Catalogue = catalogueFrom(Registry);

/** A roll that replays a fixed script, then repeats it. */
function scripted(...values: number[]): Roll {
  let index = 0;
  return () => values[index++ % values.length] ?? 1;
}

const named = (overrides: Partial<HeroDraft> = {}): Partial<HeroDraft> => ({ name: 'Test Hero', ...overrides });

describe('catalogue content', () => {
  it('holds the four races, nine professions and a full armour table', () => {
    expect(catalogue.races.map(race => race.id)).toEqual(['human', 'elf', 'dwarf', 'witcher']);
    expect(catalogue.professions.map(profession => profession.id)).toEqual(
      ['bard', 'craftsman', 'criminal', 'doctor', 'mage', 'man-at-arms', 'merchant', 'priest', 'witcher']
    );
    expect(catalogue.armor).toHaveLength(27);
    for (const slot of ARMOR_SLOTS) expect(catalogue.armor.filter(piece => piece.slot === slot)).toHaveLength(9);
  });

  it('only refers to skills, weapons, armour and groups that exist', () => {
    const skills = new Set(catalogue.skills.map(skill => skill.name));
    const groups = new Set(catalogue.skills.map(skill => skill.group).filter(Boolean));
    for (const profession of catalogue.professions) {
      const owner = `profession ${profession.id}`;
      for (const name of [...profession.fixed, ...profession.focus, ...profession.pickups, profession.defining.name]) {
        expect(skills.has(name), `${owner} names unknown skill ${name}`).toBe(true);
      }
      for (const slot of profession.picks) {
        expect(groups.has(slot.from), `${owner} pick slot ${slot.id} uses unknown group ${slot.from}`).toBe(true);
        expect(slot.defaults).toHaveLength(slot.count);
        for (const name of slot.defaults) expect(skills.has(name), `${owner} default ${name}`).toBe(true);
      }
      for (const item of [...profession.kit.items, ...profession.kit.special]) {
        if (item.weapon) expect(catalogue.weapons.has(item.weapon), `${owner} weapon ${item.weapon}`).toBe(true);
        if (item.armor) expect(catalogue.armor.some(piece => piece.id === item.armor), `${owner} armour ${item.armor}`).toBe(true);
      }
      for (const label of profession.kit.quick) {
        expect(profession.kit.items.some(item => item.label === label), `${owner} quick kit ${label}`).toBe(true);
      }
      expect([...profession.statOrder].sort()).toEqual([...STAT_IDS].sort());
      expect(profession.kit.quick.length).toBeLessThanOrEqual(profession.kit.pick);
    }
    for (const race of catalogue.races) {
      expect(skills.has(race.homeLanguage), `race ${race.id} home language`).toBe(true);
      for (const name of Object.keys(race.skillBonus)) expect(skills.has(name), `race ${race.id} bonus ${name}`).toBe(true);
    }
  });

  it('keeps defining skills to their own profession', () => {
    const defining = catalogue.skills.filter(skill => skill.profession);
    expect(defining).toHaveLength(catalogue.professions.length);
    for (const skill of defining) {
      const profession = catalogue.professions.find(row => row.id === skill.profession);
      expect(profession?.defining.name).toBe(skill.name);
    }
  });

  it('gives every purchasable weapon a combat skill the catalogue knows', () => {
    const combat = new Set(catalogue.skills.filter(skill => skill.group === 'combat').map(skill => skill.name));
    const buyable = purchasableWeapons(catalogue);
    expect(buyable.length).toBeGreaterThanOrEqual(30);
    for (const weapon of buyable) expect(combat.has(String(weapon.combatSkill)), `${weapon.id} skill ${weapon.combatSkill}`).toBe(true);
    expect(catalogue.weapons.get('battleAxe')?.combatSkill).toBe('Melee');
    expect(catalogue.weapons.get('longBow')?.combatSkill).toBe('Archery');
    expect(catalogue.weapons.get('dagger')?.combatSkill).toBe('Small Blades');
    expect(catalogue.weapons.get('crossbow')?.combatSkill).toBe('Crossbow');
    expect(catalogue.weapons.get('witchersSteel')?.combatSkill).toBe('Swordsmanship');
  });

  it('keeps well-known characters out of the name pools', () => {
    const famous = [
      'geralt', 'yennefer', 'ciri', 'triss', 'jaskier', 'dandelion', 'vesemir', 'eskel', 'lambert', 'zoltan', 'regis',
      'cahir', 'iorveth', 'roche', 'dijkstra', 'fringilla', 'keira', 'morvran', 'assire', 'emhyr', 'foltest', 'philippa',
      'eist', 'letho', 'avallach', 'cerys', 'saskia', 'vernon', 'shani', 'milva', 'angouleme', 'essi', 'cirilla', 'rivia'
    ];
    for (const race of catalogue.races) {
      const pool = [...race.names.male, ...race.names.female, ...race.names.family].map(name => name.toLowerCase());
      for (const name of famous) expect(pool.includes(name), `${race.id} pool contains ${name}`).toBe(false);
    }
  });
});

describe('derived values', () => {
  const human = catalogue.races.find(race => race.id === 'human');
  const dwarf = catalogue.races.find(race => race.id === 'dwarf');
  const mage = catalogue.professions.find(profession => profession.id === 'mage');
  const flat = (value: number): Stats => Object.fromEntries(STAT_IDS.map(id => [id, value])) as Stats;

  it('follows the BODY and WILL average for health, stamina, recovery and stun', () => {
    const stats = { ...flat(6), BODY: 8, WILL: 5, SPD: 7 };
    const derived = deriveValues(finalStats(stats, human!), human!, mage!);
    expect(derived).toMatchObject({ hp: 30, sta: 30, rec: 6, stun: 6, run: 21, leap: 4, enc: 80, vigor: 5, naturalSp: 0 });
  });

  it('rounds the average down', () => {
    const stats = { ...flat(6), BODY: 7, WILL: 6 };
    expect(deriveValues(stats, human!, mage!).rec).toBe(6);
    expect(deriveValues({ ...stats, BODY: 5, WILL: 4 }, human!, mage!).hp).toBe(20);
  });

  it('gives dwarves natural armour and extra carrying capacity', () => {
    const derived = deriveValues(flat(6), dwarf!, mage!);
    expect(derived.naturalSp).toBe(2);
    expect(derived.enc).toBe(60 + 25);
  });

  it('applies witcher mutations without breaking the ceiling or the floor', () => {
    const witcher = catalogue.races.find(race => race.id === 'witcher')!;
    const stats = finalStats({ ...flat(8), REF: 10, DEX: 10, EMP: 3 }, witcher);
    expect(stats.REF).toBe(11);
    expect(stats.DEX).toBe(11);
    expect(stats.EMP).toBe(1);
    expect(stats.BODY).toBe(8);
  });
});

describe('rolling', () => {
  it('re-rolls ones and twos when rolling stats', () => {
    const stats = rollStats(scripted(1, 2, 5, 1, 2, 9, 10, 3, 7, 2, 4, 6, 1, 8));
    expect(Object.values(stats).every(value => value >= 3 && value <= 10)).toBe(true);
    expect(stats.INT).toBe(5);
    expect(stats.REF).toBe(9);
  });

  it('adds two six-sided dice for starting coin', () => {
    expect(rollCoin(scripted(3, 4))).toBe(7);
    expect(rollCoin(scripted(6, 6))).toBe(12);
  });

  it('builds names from the race pools and is repeatable for a given roll', () => {
    const first = suggestName(catalogue, 'elf', 'Female', scripted(2, 3));
    const second = suggestName(catalogue, 'elf', 'Female', scripted(2, 3));
    expect(first).toBe(second);
    const elf = catalogue.races.find(race => race.id === 'elf')!;
    const [given, family] = first.split(' ');
    expect(elf.names.female).toContain(given);
    expect(elf.names.family).toContain(family);
  });
});

describe('normalizeDraft', () => {
  it('turns arbitrary input into a valid draft', () => {
    const draft = normalizeDraft({
      name: '  <b>Mira</b>\n\tof   the   Fen  ',
      gender: 'robot' as never,
      age: -50,
      temperament: 'furious',
      raceId: 'goblin',
      professionId: 'wizard',
      statTier: 'godlike' as never,
      stats: { INT: 99, REF: -3, DEX: 'x' as never } as never,
      levels: { Awareness: 40, 'Not A Skill': 3, Busking: 2, Swordsmanship: -1 },
      weapons: ['dagger', 'notAWeapon', 'dagger'],
      armor: { head: 'plateArmor', torso: 'plateArmor', legs: 'gambeson' },
      fieldKit: { 'swallow': 99, 'nope': 2 }
    }, catalogue);
    expect(draft.name).toBe('bMira/b of the Fen');
    expect(draft.gender).toBe('Male');
    expect(draft.age).toBe(14);
    expect(draft.temperament).toBe('disciplined');
    expect(draft.raceId).toBe(catalogue.races[0]?.id);
    expect(draft.professionId).toBe(catalogue.professions[0]?.id);
    expect(draft.statTier).toBe('average');
    expect(draft.stats.INT).toBe(10);
    expect(draft.stats.REF).toBe(1);
    expect(draft.stats.DEX).toBe(6);
    expect(draft.levels.Awareness).toBe(SKILL_CAP);
    expect(draft.levels['Not A Skill']).toBeUndefined();
    expect(draft.levels.Swordsmanship).toBeUndefined();
    expect(draft.weapons).toEqual(['dagger']);
    expect(draft.armor).toEqual({ torso: 'plateArmor' });
    expect(draft.fieldKit).toEqual({ swallow: 3 });
  });

  it('strips markup and control characters from free text', () => {
    expect(cleanText('<script>alert(1)</script>\u0000Name', 40)).toBe('scriptalert(1)/script Name');
    expect(cleanText('x'.repeat(100), 40)).toHaveLength(40);
    expect(cleanText(undefined, 40)).toBe('');
  });

  it('only lets a profession hold its own defining skill', () => {
    const draft = normalizeDraft({ professionId: 'bard', levels: { Busking: 3, 'Witcher Training': 3 } }, catalogue);
    expect(draft.levels.Busking).toBe(3);
    expect(draft.levels['Witcher Training']).toBeUndefined();
  });

  it('keeps only the allowed number of kit picks and drops decoctions for non-mutants', () => {
    const labels = catalogue.professions.find(row => row.id === 'bard')!.kit.items.map(item => item.label);
    const draft = normalizeDraft({ professionId: 'bard', kit: [...labels, 'Bogus'] }, catalogue);
    expect(draft.kit).toEqual(labels.slice(0, 5));
    const decoction = catalogue.alchemy.find(item => item.kind === 'decoction')!;
    const human = normalizeDraft({ raceId: 'human', fieldKit: { [decoction.id]: 2 } }, catalogue);
    const witcher = normalizeDraft({ raceId: 'witcher', fieldKit: { [decoction.id]: 2 } }, catalogue);
    expect(human.fieldKit[decoction.id]).toBeUndefined();
    expect(witcher.fieldKit[decoction.id]).toBe(2);
  });

  it('survives being given nothing at all', () => {
    const draft = normalizeDraft(undefined, catalogue);
    expect(draft.name).toBe('');
    expect(Object.keys(draft.stats)).toHaveLength(STAT_IDS.length);
  });
});

describe('quick builds', () => {
  const combos = catalogue.races.flatMap(race => catalogue.professions.map(profession => [race.id, profession.id] as const));

  it.each(combos)('%s %s builds without errors', (raceId, professionId) => {
    for (const tier of Object.keys(STAT_TIERS) as StatTier[]) {
      const draft = quickBuild(named({ raceId, professionId, statTier: tier }), catalogue);
      const result = buildHero(draft, catalogue);
      expect(result.issues.filter(issue => issue.level === 'error'), `${raceId}/${professionId}/${tier}`).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.sheet.points.stats.spent).toBe(STAT_TIERS[tier]);
      expect(result.sheet.points.package.spent).toBe(PACKAGE_POINTS);
      expect(result.sheet.points.pickup.spent).toBe(result.sheet.points.pickup.budget);
      expect(result.sheet.coin.left).toBeGreaterThanOrEqual(0);
      expect(result.sheet.points.fieldKit.spent).toBeLessThanOrEqual(result.sheet.points.fieldKit.budget);
      for (const id of STAT_IDS) expect(draft.stats[id]).toBeLessThanOrEqual(10);
      for (const line of result.sheet.skills) expect(line.purchased).toBeLessThanOrEqual(SKILL_CAP);
    }
  });

  it('never buys a pick-up level on a package skill or the other way round', () => {
    for (const profession of catalogue.professions) {
      const { sheet } = buildHero(quickBuild(named({ professionId: profession.id }), catalogue), catalogue);
      for (const line of sheet.skills) {
        if (line.role === 'package' || line.role === 'defining') {
          expect(line.purchased, `${profession.id} ${line.name}`).toBeGreaterThanOrEqual(1);
        }
      }
      const defining = sheet.skills.filter(line => line.role === 'defining').map(line => line.name);
      expect(defining).toEqual([profession.defining.name]);
    }
  });

  it('keeps identity fields the player set', () => {
    const draft = quickBuild(named({ name: 'Kestrel', age: 31, region: 'Skellige', gender: 'Female', raceId: 'elf', professionId: 'criminal' }), catalogue);
    expect(draft).toMatchObject({ name: 'Kestrel', age: 31, region: 'Skellige', gender: 'Female', raceId: 'elf', professionId: 'criminal' });
  });

  it('ranks stats by the profession priorities', () => {
    const draft = quickBuild(named({ professionId: 'witcher', raceId: 'witcher' }), catalogue);
    expect(draft.stats.REF).toBeGreaterThanOrEqual(draft.stats.DEX);
    expect(draft.stats.DEX).toBeGreaterThanOrEqual(draft.stats.BODY);
    expect(draft.stats.EMP).toBeLessThanOrEqual(draft.stats.LUCK);
  });

  it('is repeatable and independent of its input object', () => {
    const input = named({ professionId: 'doctor' });
    const first = quickBuild(input, catalogue);
    const second = quickBuild(input, catalogue);
    expect(second).toEqual(first);
    expect(input).toEqual(named({ professionId: 'doctor' }));
  });

  it('stocks a starter field kit that respects who can use decoctions', () => {
    const witcher = quickBuild(named({ professionId: 'witcher', raceId: 'witcher' }), catalogue);
    expect(witcher.fieldKit.swallow).toBe(2);
    const bard = quickBuild(named({ professionId: 'bard', raceId: 'human' }), catalogue);
    const decoctions = new Set(catalogue.alchemy.filter(item => item.kind === 'decoction').map(item => item.id));
    for (const id of Object.keys(bard.fieldKit)) expect(decoctions.has(id)).toBe(false);
  });

  it('produces a complete draft from newDraft', () => {
    const draft = newDraft(catalogue, scripted(1, 4, 3, 7), 'dwarf', 'man-at-arms');
    expect(draft.name).not.toBe('');
    expect(draft.raceId).toBe('dwarf');
    expect(buildHero(draft, catalogue).ok).toBe(true);
  });
});

describe('building a sheet', () => {
  it('adds racial bonuses and a free home language on top of purchases', () => {
    const elf = buildHero(quickBuild(named({ raceId: 'elf', professionId: 'merchant' }), catalogue), catalogue).sheet;
    const archery = elf.skills.find(line => line.name === 'Archery')!;
    expect(archery.bonus).toBe(2);
    expect(archery.level).toBe(archery.purchased + 2);
    expect(archery.check).toBe(elf.stats.DEX + archery.level);
    expect(elf.skills.find(line => line.name === 'Elder Speech')?.bonus).toBe(8);

    const human = buildHero(quickBuild(named({ raceId: 'human', professionId: 'merchant' }), catalogue), catalogue).sheet;
    expect(human.skills.find(line => line.name === 'Common Speech')?.bonus).toBe(8);
    expect(human.skills.find(line => line.name === 'Deduction')?.bonus).toBe(1);
  });

  it('charges two points per level for hard skills and one for the rest', () => {
    const base = quickBuild(named({ professionId: 'witcher', raceId: 'witcher' }), catalogue);
    const spent = (levels: Record<string, number>): number => buildHero({ ...base, levels }, catalogue).sheet.points.package.spent;
    const low = { ...base.levels, Alchemy: 1, Awareness: 1 };
    expect(spent({ ...low, Alchemy: 2 }) - spent(low)).toBe(2);
    expect(spent({ ...low, Awareness: 2 }) - spent(low)).toBe(1);
  });

  it('reports a pool that is over budget as an error and an unspent one as a warning', () => {
    const base = quickBuild(named(), catalogue);
    const full = Object.fromEntries(STAT_IDS.map(id => [id, 10])) as Stats;
    const over = buildHero({ ...base, stats: full }, catalogue);
    expect(over.issues.find(issue => issue.field === 'stats')?.level).toBe('error');
    const empty = Object.fromEntries(STAT_IDS.map(id => [id, 1])) as Stats;
    const short = buildHero({ ...base, stats: empty }, catalogue);
    expect(short.issues.find(issue => issue.field === 'stats')?.level).toBe('warning');
  });

  it('accepts rolled stats down to the lowest possible roll and rejects anything lower', () => {
    const base = quickBuild(named(), catalogue);
    const low = Object.fromEntries(STAT_IDS.map(id => [id, 3])) as Stats;
    expect(buildHero({ ...base, statMethod: 'roll', stats: low }, catalogue).issues.some(issue => issue.field === 'stats')).toBe(false);
    const tooLow = { ...low, LUCK: 2 };
    expect(buildHero({ ...base, statMethod: 'roll', stats: tooLow }, catalogue).issues.some(issue => issue.field === 'stats' && issue.level === 'error')).toBe(true);
  });

  it('requires a name', () => {
    const result = buildHero(quickBuild({}, catalogue), catalogue);
    expect(result.ok).toBe(false);
    expect(result.issues.find(issue => issue.field === 'name')?.level).toBe('error');
  });

  it('requires at least one level in every package skill', () => {
    const base = quickBuild(named({ professionId: 'bard' }), catalogue);
    const levels = { ...base.levels };
    delete levels.Charisma;
    const result = buildHero({ ...base, levels }, catalogue);
    expect(result.ok).toBe(false);
    expect(result.issues.some(issue => issue.field === 'levels.Charisma')).toBe(true);
  });

  it('flags unmade profession picks', () => {
    const base = quickBuild(named({ professionId: 'man-at-arms' }), catalogue);
    const result = buildHero({ ...base, picks: { combat: ['Melee'] } }, catalogue);
    expect(result.ok).toBe(false);
    expect(result.issues.some(issue => issue.field === 'picks.combat')).toBe(true);
  });

  it('warns about a witcher race with another profession and the reverse', () => {
    const a = buildHero(quickBuild(named({ raceId: 'witcher', professionId: 'bard' }), catalogue), catalogue);
    const b = buildHero(quickBuild(named({ raceId: 'human', professionId: 'witcher' }), catalogue), catalogue);
    expect(a.issues.some(issue => issue.field === 'professionId' && issue.level === 'warning')).toBe(true);
    expect(b.issues.some(issue => issue.field === 'raceId' && issue.level === 'warning')).toBe(true);
    expect(a.ok && b.ok).toBe(true);
  });

  it('notes magic the simulation cannot play yet', () => {
    const mage = buildHero(quickBuild(named({ professionId: 'mage' }), catalogue), catalogue);
    expect(mage.issues.some(issue => issue.level === 'note' && issue.field === 'magic')).toBe(true);
    expect(mage.sheet.simulatedMagic).toBe(false);
    const witcher = buildHero(quickBuild(named({ professionId: 'witcher', raceId: 'witcher' }), catalogue), catalogue);
    expect(witcher.issues.some(issue => issue.field === 'magic')).toBe(false);
  });

  it('knows the five basic Signs only for witchers', () => {
    const witcher = buildHero(quickBuild(named({ professionId: 'witcher', raceId: 'witcher' }), catalogue), catalogue).sheet;
    expect(witcher.knownSigns).toEqual([...BASIC_SIGNS]);
    for (const profession of catalogue.professions.filter(row => row.id !== 'witcher')) {
      expect(buildHero(quickBuild(named({ professionId: profession.id }), catalogue), catalogue).sheet.knownSigns).toEqual([]);
    }
  });

  it('spreads armour over the hit locations', () => {
    const base = quickBuild(named({ professionId: 'bard' }), catalogue);
    const draft = { ...base, coinRoll: 12, armor: { head: 'chainCoif', torso: 'brigandine', legs: 'armoredTrousers' } };
    const { sheet } = buildHero(draft, catalogue);
    expect(sheet.armorByLocation).toEqual({ head: 12, torso: 12, rightArm: 12, leftArm: 12, rightLeg: 12, leftLeg: 12 });
    const { sheet: bare } = buildHero({ ...base, armor: {} }, catalogue);
    expect(bare.armorByLocation.torso).toBe(0);
  });

  it('prices purchases against the coin roll and treats kit pieces as free', () => {
    const base = quickBuild(named({ professionId: 'witcher', raceId: 'witcher' }), catalogue);
    const free = buildHero({ ...base, weapons: [], armor: {} }, catalogue).sheet;
    expect(free.coin.total).toBe(50 * base.coinRoll);
    expect(free.coin.spent).toBe(0);
    expect(free.armor.torso?.id).toBe('doubleWovenGambeson');
    expect(free.weapons.map(weapon => weapon.id)).toContain('witchersSteel');
    expect(free.weapons.map(weapon => weapon.id)).toContain('witchersSilver');

    const costly = buildHero({ ...base, coinRoll: 2, weapons: ['torrwr'], armor: {} }, catalogue);
    expect(costly.sheet.coin.spent).toBe(1075);
    expect(costly.ok).toBe(false);
    expect(costly.issues.some(issue => issue.field === 'coin')).toBe(true);

    const upgraded = buildHero({ ...base, coinRoll: 12, armor: { torso: 'nilfgaardianPlateArmor' } }, catalogue).sheet;
    expect(upgraded.armor.torso?.id).toBe('nilfgaardianPlateArmor');
    expect(upgraded.coin.spent).toBe(850);
  });

  it('issues ammunition only to heroes with a ranged weapon', () => {
    const melee = buildHero({ ...quickBuild(named({ professionId: 'bard' }), catalogue), weapons: [] }, catalogue).sheet;
    const ranged = buildHero({ ...quickBuild(named({ professionId: 'bard' }), catalogue), weapons: ['longBow'], coinRoll: 12 }, catalogue).sheet;
    expect(melee.ammo).toBe(0);
    expect(ranged.ammo).toBe(STARTING_AMMO);
  });

  it('sizes the field kit by Alchemy skill', () => {
    const doctor = quickBuild(named({ professionId: 'doctor' }), catalogue);
    const low = buildHero({ ...doctor, levels: { ...doctor.levels, Alchemy: 2 } }, catalogue).sheet;
    const high = buildHero({ ...doctor, levels: { ...doctor.levels, Alchemy: 6 } }, catalogue).sheet;
    expect(low.points.fieldKit.budget).toBe(FIELD_KIT_BASE + 1);
    expect(high.points.fieldKit.budget).toBe(FIELD_KIT_BASE + 3);
    const stocked = buildHero({ ...doctor, fieldKit: { swallow: 3, thunderbolt: 3, grapeshot: 3, 'beast-oil': 3 } }, catalogue);
    expect(stocked.issues.some(issue => issue.field === 'fieldKit' && issue.level === 'error')).toBe(true);
  });

  it('does not change the draft it is given', () => {
    const draft = quickBuild(named({ professionId: 'priest' }), catalogue);
    const snapshot = JSON.parse(JSON.stringify(draft));
    buildHero(draft, catalogue);
    expect(JSON.parse(JSON.stringify(draft))).toEqual(snapshot);
  });
});

describe('exporting and importing a hero', () => {
  const sample = (): HeroDraft => quickBuild(named({ raceId: 'elf', professionId: 'criminal', name: 'Sable Veyra', region: 'Border Marches' }), catalogue);
  const wrap = (hero: unknown, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ format: HERO_FORMAT, version: HERO_VERSION, hero, ...extra });

  it('writes a labelled, readable document', () => {
    const text = exportHero(sample(), catalogue);
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe(HERO_FORMAT);
    expect(parsed.version).toBe(HERO_VERSION);
    expect(parsed.hero.name).toBe('Sable Veyra');
    expect(text.split(String.fromCharCode(10)).length).toBeGreaterThan(10);
  });

  it('gives back exactly the hero that was exported', () => {
    const draft = sample();
    const result = importHero(exportHero(draft, catalogue), catalogue);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft).toEqual(normalizeDraft(draft, catalogue));
      expect(result.notes).toEqual([]);
      expect(buildHero(result.draft, catalogue).ok).toBe(true);
    }
  });

  it('round-trips a hero with bought gear and a stocked field kit', () => {
    const base = quickBuild(named({ professionId: 'doctor' }), catalogue);
    const draft: HeroDraft = { ...base, coinRoll: 12, weapons: ['dagger'], fieldKit: { swallow: 2 } };
    const result = importHero(exportHero(draft, catalogue), catalogue);
    expect(result.ok && result.draft.weapons).toEqual(['dagger']);
    expect(result.ok && result.draft.fieldKit).toEqual({ swallow: 2 });
  });

  it('asks for something to read', () => {
    for (const text of ['', '   ', `  ${String.fromCharCode(10)} `]) {
      const result = importHero(text, catalogue);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/paste a hero/i);
    }
  });

  it('refuses text that is not JSON, not a hero file, or from a newer version', () => {
    const cases: Array<[string, RegExp]> = [
      ['{ nope', /not valid JSON/i],
      ['[1,2,3]', /hero file/i],
      ['"just a string"', /hero file/i],
      [JSON.stringify({ hero: {} }), /hero file/i],
      [JSON.stringify({ format: 'something-else', version: 1, hero: {} }), /hero file/i],
      [wrap({}, { version: HERO_VERSION + 1 }), /newer version/i],
      [JSON.stringify({ format: HERO_FORMAT, version: 1 }), /hero file/i],
      [wrap('a hero'), /hero file/i]
    ];
    for (const [text, expected] of cases) {
      const result = importHero(text, catalogue);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.error).toMatch(expected);
    }
  });

  it('refuses a document too large to be a hero', () => {
    const result = importHero(wrap({ name: 'x'.repeat(HERO_FILE_MAX) }), catalogue);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });

  it('repairs what it does not recognise and says what it dropped', () => {
    const draft = sample();
    const result = importHero(wrap({ ...draft, raceId: 'goblin', weapons: ['dagger', 'moonblade'], armor: { head: 'no-such-helm' }, fieldKit: { 'no-such-potion': 3 } }), catalogue);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.raceId).toBe(catalogue.races[0]?.id);
    expect(result.draft.weapons).not.toContain('moonblade');
    expect(result.draft.armor.head).toBeUndefined();
    expect(result.notes.join(' ')).toMatch(/goblin/);
    expect(result.notes.join(' ')).toMatch(/weapon/i);
    expect(result.notes.join(' ')).toMatch(/armour/i);
    expect(result.notes.join(' ')).toMatch(/field kit/i);
  });

  it('survives fields of the wrong shape without throwing', () => {
    const hostile = {
      name: { toString: 'no' }, gender: 7, age: 'ancient', region: [1, 2], temperament: null,
      appearance: 'tall', raceId: 4, professionId: [], statMethod: {}, statTier: 'godlike',
      stats: 'strong', picks: ['a'], levels: [1, 2, 3], kit: 'sword', coinRoll: 'rich',
      weapons: 12, armor: 'plate', fieldKit: 9
    };
    expect(() => importHero(wrap(hostile), catalogue)).not.toThrow();
    const result = importHero(wrap(hostile), catalogue);
    expect(result.ok).toBe(true);
    if (result.ok) expect(buildHero(result.draft, catalogue).sheet.name).toBeTypeOf('string');
  });

  it('cannot be used to pollute object prototypes', () => {
    importHero('{"format":"' + HERO_FORMAT + '","version":1,"hero":{"__proto__":{"polluted":true},"levels":{"__proto__":{"polluted":true}},"name":"X"}}', catalogue);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('strips markup from text fields the way the creator does', () => {
    const result = importHero(wrap({ ...sample(), name: '<img src=x onerror=alert(1)>Mara' }), catalogue);
    expect(result.ok && result.draft.name).not.toMatch(/[<>]/);
  });
});
