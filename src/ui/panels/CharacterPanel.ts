import {
  ARMOR_SLOTS,
  FIELD_KIT_ITEM_MAX,
  GENDERS,
  NAME_MAX,
  SKILL_CAP,
  STAT_IDS,
  STAT_MAX,
  STAT_MIN,
  STAT_TIERS,
  TEMPERAMENTS,
  buildHero,
  callingLabel,
  fieldKitCost,
  newDraft,
  normalizeDraft,
  packageSkills,
  pickChoices,
  purchasableWeapons,
  quickBuild,
  rollCoin,
  rollStats,
  skillCost,
  suggestName,
  type ArmorSlot,
  type BuildResult,
  type Budget,
  type Catalogue,
  type Gender,
  type HeroDraft,
  type Issue,
  type ProfessionRow,
  type RaceRow,
  type Roll,
  type SkillLine,
  type StatId,
  type StatTier,
  type WeaponRow
} from '../../services/CharacterBuilder';
import type { PresetCard } from '../../services/PlayerCharacter';

/**
 * The character creator: name a hero, choose a people and a calling, spend the points, kit them out.
 *
 * Presentation only, and DOM-free like the other panels. `renderCreator` turns a draft into a
 * string; `applyCreatorAction` and `setCreatorField` are the pure reducers behind its buttons and
 * inputs. Every rule — pools, caps, costs, legality — lives in `CharacterBuilder`. The panel asks it
 * for the live sheet and the issue list and never decides a number itself.
 *
 * The draft is ephemeral view state held by the shell, not combat truth, so it is not in the store.
 */

export interface CreatorNotice {
  tone: 'ok' | 'bad';
  text: string;
}

/** What the creator is showing: the draft being edited and the last message to the player. */
export interface CreatorModel {
  draft: HeroDraft;
  notice: CreatorNotice | null;
  /** The text in the share box: what Export wrote, or what the player pasted. */
  shareText: string;
}

export interface CreatorDeps {
  esc(value: unknown): string;
  catalogue: Catalogue;
  presets: PresetCard[];
  /** Who holds the player's seat right now. */
  seated: { kind: 'preset' | 'custom'; id: string | null; name: string };
  /** A battle is running, so a new hero waits for the next one. */
  inCombat: boolean;
}

export interface CreatorContext {
  catalogue: Catalogue;
  /** Returns an integer from 1 to `sides`. Injected so tests are exact. */
  random: Roll;
}

const STAT_NAMES: Record<StatId, string> = {
  INT: 'Intelligence', REF: 'Reflexes', DEX: 'Dexterity', BODY: 'Body', SPD: 'Speed',
  EMP: 'Empathy', CRA: 'Craft', WILL: 'Will', LUCK: 'Luck'
};

const TIER_LABELS: Record<StatTier, string> = { average: 'Average', skilled: 'Skilled', heroes: 'Heroic', legends: 'Legendary' };
const SLOT_LABELS: Record<ArmorSlot, string> = { head: 'Head', torso: 'Torso and arms', legs: 'Legs' };
const KIND_LABELS: Record<string, string> = { potion: 'Potions', decoction: 'Decoctions', bomb: 'Bombs', oil: 'Oils' };
const WEAPON_GROUPS: Array<[string, string]> = [
  ['Swordsmanship', 'Swords'], ['Small Blades', 'Knives and daggers'], ['Melee', 'Axes and maces'],
  ['Staff/Spear', 'Staves and spears'], ['Archery', 'Bows'], ['Crossbow', 'Crossbows']
];
const APPEARANCE_FIELDS = ['height', 'build', 'hair', 'eyes', 'skin'] as const;

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const clampInt = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
/** Reads a weapon effect id the way a player would: `LongReach` is "long reach", `Bleeding25` is "bleeding 25%". */
function effectLabel(id: string): string {
  const match = /^([A-Za-z]+?)(-?\d+)$/.exec(id);
  const base = (match?.[1] ?? id).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  if (!match) return base;
  const amount = Number(match[2]);
  return base === 'focus' || base === 'stun' ? `${base} ${amount < 0 ? '−' : ''}${Math.abs(amount)}` : `${base} ${amount}%`;
}
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function oneOf<T>(list: readonly T[], random: Roll): T | undefined {
  return list.length ? list[clampInt(random(list.length), 1, list.length) - 1] : undefined;
}

// --- actions -----------------------------------------------------------------------------------

/**
 * Applies a creator button to a draft and returns the new draft, or null when the action is not
 * one the reducer owns (the shell handles play, use, export and import itself).
 *
 * Steps that would break a budget or a cap return the draft unchanged, so the buttons cannot walk
 * a hero into an illegal state; the renderer disables them for the same reasons.
 */
export function applyCreatorAction(action: string, value: string, draft: HeroDraft, ctx: CreatorContext): HeroDraft | null {
  const { catalogue, random } = ctx;
  const keep = (next: Partial<HeroDraft>): HeroDraft => normalizeDraft({ ...draft, ...next }, catalogue);
  const professionOf = (): ProfessionRow | undefined => catalogue.professions.find(row => row.id === draft.professionId);

  switch (action) {
    case 'race': {
      const next = catalogue.races.find(row => row.id === value);
      if (!next) return draft;
      const previous = catalogue.races.find(row => row.id === draft.raceId);
      // An age left at the old people's default follows the new people.
      return keep({ raceId: next.id, age: previous && draft.age === previous.defaultAge ? next.defaultAge : draft.age });
    }
    case 'profession': {
      if (!catalogue.professions.some(row => row.id === value)) return draft;
      // A new calling means a new package, picks and kit, so the whole sheet is refitted.
      return quickBuild({ ...draft, professionId: value }, catalogue);
    }

    case 'method':
      return value === 'roll'
        ? keep({ statMethod: 'roll', stats: rollStats(random) })
        : keep({ statMethod: 'pool', stats: quickBuild({ ...draft, statMethod: 'pool' }, catalogue).stats });
    case 'rollStats':
      return keep({ statMethod: 'roll', stats: rollStats(random) });
    case 'autoStats':
      return keep({ statMethod: 'pool', stats: quickBuild(draft, catalogue).stats });
    case 'statUp':
    case 'statDown': {
      const id = STAT_IDS.find(stat => stat === value);
      if (!id || draft.statMethod !== 'pool') return draft;
      const current = draft.stats[id];
      const up = action === 'statUp';
      if (up ? current >= STAT_MAX || sum(STAT_IDS.map(stat => draft.stats[stat])) >= STAT_TIERS[draft.statTier] : current <= STAT_MIN) return draft;
      return keep({ stats: { ...draft.stats, [id]: current + (up ? 1 : -1) } });
    }

    case 'skillUp':
    case 'skillDown': {
      const sheet = buildHero(draft, catalogue).sheet;
      const line = sheet.skills.find(skill => skill.name === value);
      if (!line) return draft;
      if (action === 'skillDown') {
        // Package skills keep their first point; only pick-ups can be emptied.
        if (line.purchased <= (line.role === 'pickup' ? 0 : 1)) return draft;
        return keep({ levels: { ...draft.levels, [line.name]: line.purchased - 1 } });
      }
      const pool = line.role === 'pickup' ? sheet.points.pickup : sheet.points.package;
      if (line.purchased >= SKILL_CAP || pool.spent + skillCost(line) > pool.budget) return draft;
      return keep({ levels: { ...draft.levels, [line.name]: line.purchased + 1 } });
    }
    case 'pick': {
      const [slotId, ...rest] = value.split('|');
      const skill = rest.join('|');
      const profession = professionOf();
      const slot = profession?.picks.find(row => row.id === slotId);
      if (!profession || !slot || !pickChoices(catalogue, profession, slot).some(choice => choice.name === skill)) return draft;
      const chosen = draft.picks[slot.id] ?? [];
      const next = chosen.includes(skill) ? chosen.filter(name => name !== skill)
        : slot.count === 1 ? [skill]
        : chosen.length < slot.count ? [...chosen, skill]
        : [...chosen.slice(1), skill];
      return repackage(draft, profession, { ...draft.picks, [slot.id]: next }, catalogue);
    }

    case 'kit': {
      const profession = professionOf();
      if (!profession?.kit.items.some(item => item.label === value)) return draft;
      const limit = profession.kit.pick;
      if (draft.kit.includes(value)) return keep({ kit: draft.kit.filter(label => label !== value) });
      if (limit === 1) return keep({ kit: [value] });
      return draft.kit.length < limit ? keep({ kit: [...draft.kit, value] }) : draft;
    }
    case 'rollCoin':
      return keep({ coinRoll: rollCoin(random) });
    case 'averageCoin':
      return keep({ coinRoll: 7 });
    case 'weapon': {
      const row = catalogue.weapons.get(value);
      if (!row || row.cost === undefined) return draft;
      if (draft.weapons.includes(value)) return keep({ weapons: draft.weapons.filter(id => id !== value) });
      if (row.cost > buildHero(draft, catalogue).sheet.coin.left) return draft;
      return keep({ weapons: [...draft.weapons, value] });
    }
    case 'fieldUp':
    case 'fieldDown': {
      const item = catalogue.alchemy.find(row => row.id === value);
      if (!item) return draft;
      const count = draft.fieldKit[item.id] ?? 0;
      if (action === 'fieldDown') return count > 0 ? keep({ fieldKit: { ...draft.fieldKit, [item.id]: count - 1 } }) : draft;
      const budget = buildHero(draft, catalogue).sheet.points.fieldKit;
      const mutagens = catalogue.races.find(row => row.id === draft.raceId)?.mutagens;
      if (count >= FIELD_KIT_ITEM_MAX || budget.spent + fieldKitCost(item.kind) > budget.budget || (item.kind === 'decoction' && !mutagens)) return draft;
      return keep({ fieldKit: { ...draft.fieldKit, [item.id]: count + 1 } });
    }

    case 'quick':
      return quickBuild(draft, catalogue);
    case 'randomize': {
      const fresh = newDraft(catalogue, random, oneOf(catalogue.races, random)?.id, oneOf(catalogue.professions, random)?.id);
      return quickBuild({ ...fresh, statTier: draft.statTier, temperament: oneOf(TEMPERAMENTS, random) ?? fresh.temperament }, catalogue);
    }
    case 'suggestName':
      return keep({ name: suggestName(catalogue, draft.raceId, draft.gender, random) });
    default:
      return null;
  }
}

/** Swaps the profession picks. Points leave with a skill that leaves the package; new ones start at 1. */
function repackage(draft: HeroDraft, profession: ProfessionRow, picks: Record<string, string[]>, catalogue: Catalogue): HeroDraft {
  const before = new Set(packageSkills(profession, draft.picks));
  const after = packageSkills(profession, picks);
  const levels = { ...draft.levels };
  for (const name of before) if (!after.includes(name)) delete levels[name];
  for (const name of after) if (!before.has(name) && !((levels[name] ?? 0) > 0)) levels[name] = 1;
  return normalizeDraft({ ...draft, picks, levels }, catalogue);
}

/**
 * Applies a typed or selected field to a draft. Returns null for a field the creator does not
 * edit. The text is cleaned by the builder, exactly as an imported hero's would be.
 */
export function setCreatorField(field: string, value: string, draft: HeroDraft, catalogue: Catalogue): HeroDraft | null {
  const keep = (next: Partial<HeroDraft>): HeroDraft => normalizeDraft({ ...draft, ...next }, catalogue);
  const look = (next: Partial<HeroDraft['appearance']>): HeroDraft => keep({ appearance: { ...draft.appearance, ...next } });

  switch (field) {
    case 'name': return keep({ name: value });
    case 'region': return keep({ region: value });
    case 'temperament': return keep({ temperament: value });
    case 'gender': return keep({ gender: value as Gender });
    case 'age': return keep({ age: Number(value) });
    case 'statTier': return keep({ statTier: value as StatTier });
    case 'notable': return look({ notable: value.split(',') });
    default:
  }
  if ((APPEARANCE_FIELDS as readonly string[]).includes(field)) return look({ [field]: value });
  if (field.startsWith('armor:')) {
    const slot = ARMOR_SLOTS.find(candidate => candidate === field.slice('armor:'.length));
    if (!slot) return null;
    const armor = { ...draft.armor };
    if (value) armor[slot] = value; else delete armor[slot];
    return keep({ armor });
  }
  return null;
}

// --- rendering ---------------------------------------------------------------------------------

/** The whole creator: the premade shelf, the form column and the live sheet. */
export function renderCreator(model: CreatorModel, deps: CreatorDeps): string {
  const result = buildHero(model.draft, deps.catalogue);
  return `<div class="creator">
    ${renderShelf(deps)}
    <div class="creator-grid">
      <div class="creator-form" id="creatorForm">
        ${renderIdentity(model.draft, deps)}
        ${renderPeoples(model.draft, deps)}
        ${renderCallings(model.draft, deps)}
        ${renderAttributes(model.draft, result, deps)}
        ${renderSkills(model.draft, result, deps)}
        ${renderGear(model.draft, result, deps)}
        ${renderShare(model, deps)}
      </div>
      <aside class="creator-sheet" id="creatorSheet">${renderCreatorSheet(model, deps, result)}</aside>
    </div>
  </div>`;
}

/** The live sheet alone. The shell repaints just this while a text field is being typed in. */
export function renderCreatorSheet(model: CreatorModel, deps: CreatorDeps, built?: BuildResult): string {
  const e = deps.esc;
  const result = built ?? buildHero(model.draft, deps.catalogue);
  const { sheet } = result;
  const stat = (id: StatId): string => `<span class="sheet-stat"><small>${id}</small><b>${sheet.stats[id]}</b></span>`;
  const vital = (label: string, value: string | number): string => `<span class="sheet-vital"><small>${label}</small><b>${e(value)}</b></span>`;
  const check = (skill: string | undefined): string => {
    const line = skill ? sheet.skills.find(candidate => candidate.name === skill) : undefined;
    return line ? String(line.check) : '—';
  };

  const weapons = sheet.weapons.length
    ? sheet.weapons.map(weapon => `<li><b>${e(weapon.name)}</b><span>${e(weapon.damage)} · ${weapon.range === 'melee' ? 'melee' : `${weapon.range} m`} · ${e(weapon.combatSkill ?? 'unskilled')} ${check(weapon.combatSkill)}</span></li>`).join('')
    : '<li class="muted">Nothing but fists.</li>';
  const armour = ARMOR_SLOTS.map(slot => {
    const piece = sheet.armor[slot];
    return `<li><b>${SLOT_LABELS[slot]}</b><span>${piece ? `${e(piece.name)} · SP ${piece.sp}` : 'none'}</span></li>`;
  }).join('');
  const natural = sheet.derived.naturalSp ? `<li><b>Natural</b><span>SP ${sheet.derived.naturalSp} everywhere</span></li>` : '';
  const trained = [...sheet.skills].filter(line => line.level > 0).sort((a, b) => b.check - a.check || a.name.localeCompare(b.name)).slice(0, 8);
  const skills = trained.map(line => `<li><b>${e(line.name)}</b><span>${line.check}</span></li>`).join('');
  const kit = sheet.fieldKit.length
    ? sheet.fieldKit.map(item => `${e(item.name)} ×${item.count}`).join(' · ')
    : 'Empty';
  const magic = sheet.knownSigns.length
    ? `Signs: ${sheet.knownSigns.map(id => capital(id)).join(', ')}`
    : 'No Signs';
  const perks = sheet.perks.map(perk => `<li>${e(perk.text)}${perk.simulated ? '' : ' <span class="tag">narrative</span>'}</li>`).join('');

  const issues = renderIssues(result.issues, deps);
  const seatNote = deps.inCombat ? 'A battle is running. This hero joins the next one.' : 'You will fight the next battle as this hero.';
  const ready = result.ok;
  const verb = deps.seated.kind === 'custom' && deps.seated.name === sheet.name ? 'Update this hero' : 'Use this hero';
  const notice = model.notice ? `<div class="creator-notice ${model.notice.tone}" role="status">${e(model.notice.text)}</div>` : '';

  return `${notice}
    <section class="panel sheet-card">
      <div class="sheet-title">
        <h2>${e(sheet.name || 'Unnamed hero')}</h2>
        <small>${e(callingLabel(sheet))} · ${e(sheet.gender)}, ${sheet.age} (${e(sheet.ageBand)})${sheet.region ? ` · ${e(sheet.region)}` : ''}</small>
      </div>
      <div class="sheet-vitals">${vital('HP', sheet.derived.hp)}${vital('STA', sheet.derived.sta)}${vital('REC', sheet.derived.rec)}${vital('STUN', sheet.derived.stun)}${vital('RUN', sheet.derived.run)}${vital('LEAP', sheet.derived.leap)}${vital('ENC', sheet.derived.enc)}${vital('VIGOR', sheet.derived.vigor)}</div>
      <div class="sheet-stats">${STAT_IDS.map(stat).join('')}</div>
      <h3>Weapons</h3><ul class="sheet-list">${weapons}</ul>
      <h3>Armour</h3><ul class="sheet-list">${armour}${natural}</ul>
      <h3>Strongest skills</h3><ul class="sheet-list two">${skills || '<li class="muted">None yet.</li>'}</ul>
      <h3>Magic</h3><p class="sheet-line">${e(magic)}${sheet.simulatedMagic || sheet.knownSigns.length ? '' : ` · ${e(sheet.magic)} <span class="tag">not simulated</span>`}</p>
      <h3>Field kit</h3><p class="sheet-line">${kit}</p>
      <h3>Traits</h3><ul class="sheet-bullets">${perks}</ul>
      <h3>Coin</h3><p class="sheet-line">${sheet.coin.spent} of ${sheet.coin.total} crowns spent</p>
      ${issues}
      <div class="sheet-actions">
        <button type="button" class="btn primary" data-creator="use" ${ready ? '' : 'disabled'}>${verb}</button>
        <button type="button" class="btn" data-creator="quick" title="Refit skills and gear to this calling">Quick build</button>
        <button type="button" class="btn" data-creator="randomize" title="A whole new random hero">Randomize</button>
      </div>
      <p class="muted sheet-seat">${ready ? e(seatNote) : 'Fix the problems above to use this hero.'}</p>
    </section>`;
}

function renderIssues(issues: Issue[], deps: CreatorDeps): string {
  if (!issues.length) return '<div class="issue ok">Ready for battle.</div>';
  const order = { error: 0, warning: 1, note: 2 } as const;
  return `<div class="issues">${[...issues].sort((a, b) => order[a.level] - order[b.level])
    .map(issue => `<div class="issue ${issue.level}"><b>${issue.level === 'error' ? 'Problem' : issue.level === 'warning' ? 'Heads up' : 'Note'}</b> ${deps.esc(issue.message)}</div>`).join('')}</div>`;
}

function section(title: string, eyebrow: string, body: string, badge = ''): string {
  return `<section class="panel creator-section"><div class="panel-head"><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2></div>${badge}</div><div class="panel-body">${body}</div></section>`;
}

function meter(label: string, budget: Budget | { spent: number; budget: number }, unit = ''): string {
  const over = budget.spent > budget.budget;
  const full = budget.spent === budget.budget;
  const fill = budget.budget > 0 ? clampInt(Math.round((budget.spent / budget.budget) * 100), 0, 100) : 0;
  return `<div class="meter ${over ? 'over' : full ? 'full' : ''}" style="--fill:${fill}%"><span class="meter-label">${label}</span><span class="meter-value">${budget.spent} / ${budget.budget}${unit}</span></div>`;
}

function stepper(label: string, action: string, value: string, shown: string | number, canDown: boolean, canUp: boolean, deps: CreatorDeps): string {
  const e = deps.esc;
  return `<span class="stepper"><button type="button" class="step" data-creator="${action}Down" data-value="${e(value)}" aria-label="Decrease ${e(label)}" ${canDown ? '' : 'disabled'}>−</button><b>${shown}</b><button type="button" class="step" data-creator="${action}Up" data-value="${e(value)}" aria-label="Increase ${e(label)}" ${canUp ? '' : 'disabled'}>+</button></span>`;
}

function renderShelf(deps: CreatorDeps): string {
  const e = deps.esc;
  const mine = deps.seated.kind === 'custom'
    ? `<article class="hero-card active"><div class="hero-card-head"><b>${e(deps.seated.name)}</b><span class="badge">Yours</span></div><small>Built in the creator</small><p>Your own hero holds the player's seat.</p></article>`
    : '';
  const cards = deps.presets.map(preset => {
    const active = deps.seated.kind === 'preset' && deps.seated.id === preset.id;
    return `<article class="hero-card ${active ? 'active' : ''}">
      <div class="hero-card-head"><b>${e(preset.name)}</b><span class="badge">${preset.kind === 'veteran' ? 'Veteran' : 'Fresh'}</span></div>
      <small>${e(preset.label)}</small>
      <p>${e(preset.summary)}</p>
      <div class="button-row">
        <button type="button" class="btn small ${active ? 'good' : 'primary'}" data-creator="play" data-value="${e(preset.id)}" ${active ? 'disabled' : ''}>${active ? 'Playing' : 'Play'}</button>
        ${preset.kind === 'fresh' ? `<button type="button" class="btn small" data-creator="edit" data-value="${e(preset.id)}">Edit a copy</button>` : ''}
      </div>
    </article>`;
  }).join('');
  return `<section class="panel creator-shelf"><div class="panel-head"><div><div class="eyebrow">Hero</div><h2>Choose a hero or build your own</h2></div><span class="badge">${deps.presets.length} premade</span></div><div class="panel-body"><div class="hero-cards">${mine}${cards}</div></div></section>`;
}

function renderIdentity(draft: HeroDraft, deps: CreatorDeps): string {
  const e = deps.esc;
  const input = (field: string, label: string, value: string, max: number, extra = ''): string =>
    `<label class="field ${extra}">${label}<input data-field="${field}" value="${e(value)}" maxlength="${max}" autocomplete="off"></label>`;
  const select = (field: string, label: string, list: readonly string[], current: string, show: (item: string) => string = item => item): string =>
    `<label class="field">${label}<select data-field="${field}">${list.map(item => `<option value="${e(item)}" ${item === current ? 'selected' : ''}>${e(show(item))}</option>`).join('')}</select></label>`;

  const body = `<div class="creator-fields">
      <label class="field wide">Name<span class="name-row"><input data-field="name" value="${e(draft.name)}" maxlength="${NAME_MAX}" placeholder="Name your hero" autocomplete="off"><button type="button" class="btn small" data-creator="suggestName">Suggest</button></span></label>
      ${select('gender', 'Gender', GENDERS, draft.gender)}
      <label class="field">Age<input data-field="age" type="number" min="14" max="500" value="${draft.age}"></label>
      ${input('region', 'Home region', draft.region, 40)}
      ${select('temperament', 'Temperament', TEMPERAMENTS, draft.temperament, capital)}
    </div>
    <div class="creator-fields look">
      ${APPEARANCE_FIELDS.map(field => input(field, capital(field), draft.appearance[field], 60)).join('')}
      ${input('notable', 'Distinguishing marks (comma separated)', draft.appearance.notable.join(', '), 160, 'wide')}
    </div>`;
  return section('Who are they?', 'Identity', body);
}

function renderPeoples(draft: HeroDraft, deps: CreatorDeps): string {
  const e = deps.esc;
  const cards = deps.catalogue.races.map((race: RaceRow) => {
    const active = race.id === draft.raceId;
    const mods = (Object.entries(race.statMods) as Array<[StatId, number]>)
      .filter(([, amount]) => amount)
      .map(([id, amount]) => `<span class="mod ${amount > 0 ? 'up' : 'down'}">${id} ${amount > 0 ? '+' : '−'}${Math.abs(amount)}</span>`).join('');
    const perks = race.perks.slice(0, 3).map(perk => `<span class="line">${e(perk.text)}${perk.simulated ? '' : ' <span class="tag">narrative</span>'}</span>`).join('');
    return `<button type="button" class="pick-card ${active ? 'active' : ''}" data-creator="race" data-value="${e(race.id)}" aria-pressed="${active}">
      <b>${e(race.name)}</b>
      <small>${e(race.summary)}</small>
      <span class="mods">${mods || '<span class="mod">no stat changes</span>'}${race.naturalSp ? `<span class="mod up">natural armour ${race.naturalSp}</span>` : ''}</span>
      ${perks}
    </button>`;
  }).join('');
  return section('Which people?', 'Heritage', `<div class="card-grid">${cards}</div>`);
}

function renderCallings(draft: HeroDraft, deps: CreatorDeps): string {
  const e = deps.esc;
  const cards = deps.catalogue.professions.map(profession => {
    const active = profession.id === draft.professionId;
    return `<button type="button" class="pick-card ${active ? 'active' : ''}" data-creator="profession" data-value="${e(profession.id)}" aria-pressed="${active}">
      <b>${e(profession.name)}</b>
      <small>${e(profession.summary)}</small>
      <span class="line"><b>${e(profession.defining.name)}.</b> ${e(profession.defining.effect)}</span>
      <span class="mods"><span class="mod">${profession.coin} crowns × 2d6</span>${profession.vigor ? `<span class="mod up">vigor ${profession.vigor}</span>` : ''}${profession.signs ? '<span class="mod up">Signs</span>' : ''}${profession.magic && !profession.signs ? `<span class="mod">${e(profession.magic)}${profession.simulatedMagic ? '' : ' (not simulated)'}</span>` : ''}</span>
    </button>`;
  }).join('');
  return section('Which calling?', 'Profession', `<p class="hint">Choosing a calling refits your skills, kit and gear to it. Your identity and people stay.</p><div class="card-grid">${cards}</div>`);
}

function renderAttributes(draft: HeroDraft, result: BuildResult, deps: CreatorDeps): string {
  const e = deps.esc;
  const pool = draft.statMethod === 'pool';
  const budget = STAT_TIERS[draft.statTier];
  const spent = sum(STAT_IDS.map(id => draft.stats[id]));
  const race = deps.catalogue.races.find(row => row.id === draft.raceId);

  const rows = STAT_IDS.map(id => {
    const mod = race?.statMods[id] ?? 0;
    const canUp = pool && draft.stats[id] < STAT_MAX && spent < budget;
    const canDown = pool && draft.stats[id] > STAT_MIN;
    return `<div class="stat-row"><span class="stat-name"><b>${id}</b><small>${STAT_NAMES[id]}</small></span>
      ${pool ? stepper(STAT_NAMES[id], 'stat', id, draft.stats[id], canDown, canUp, deps) : `<span class="stepper"><b>${draft.stats[id]}</b></span>`}
      <span class="stat-mod ${mod > 0 ? 'up' : mod < 0 ? 'down' : ''}">${mod ? `${mod > 0 ? '+' : '−'}${Math.abs(mod)}` : ''}</span>
      <span class="stat-final" title="With your people's adjustments">${result.sheet.stats[id]}</span></div>`;
  }).join('');

  const method = `<div class="segmented" role="group" aria-label="How to set attributes">
      <button type="button" class="btn small ${pool ? 'active' : ''}" data-creator="method" data-value="pool">Spend a pool</button>
      <button type="button" class="btn small ${pool ? '' : 'active'}" data-creator="method" data-value="roll">Roll the dice</button>
    </div>`;
  const tier = pool
    ? `<label class="field inline">Pool<select data-field="statTier">${(Object.keys(STAT_TIERS) as StatTier[]).map(key => `<option value="${key}" ${key === draft.statTier ? 'selected' : ''}>${TIER_LABELS[key]} (${STAT_TIERS[key]})</option>`).join('')}</select></label>`
    : '';
  const tools = pool
    ? '<button type="button" class="btn small" data-creator="autoStats" title="Spread the pool the way this calling usually does">Auto-assign</button>'
    : '<button type="button" class="btn small" data-creator="rollStats" title="Roll all nine again">Roll again</button>';
  const meterHtml = pool ? meter('Pool', { spent, budget }) : '<div class="hint">Each attribute is a d10 (a 1 or 2 is rolled again). Roll again as often as you like.</div>';

  return section('How are they made?', 'Attributes',
    `<div class="creator-toolbar">${method}${tier}${tools}</div>${meterHtml}
     <div class="stat-head"><span></span><span>${pool ? 'Assigned' : 'Rolled'}</span><span title="Adjustment from your people">Mod</span><span title="With your people's adjustment">Final</span></div>
     <div class="stat-grid">${rows}</div>`);
}

function renderSkills(draft: HeroDraft, result: BuildResult, deps: CreatorDeps): string {
  const e = deps.esc;
  const { sheet } = result;
  const profession = deps.catalogue.professions.find(row => row.id === draft.professionId);

  const slots = (profession?.picks ?? []).map(slot => {
    const chosen = draft.picks[slot.id] ?? [];
    const chips = pickChoices(deps.catalogue, profession as ProfessionRow, slot).map(choice => {
      const on = chosen.includes(choice.name);
      return `<button type="button" class="chip ${on ? 'active' : ''}" data-creator="pick" data-value="${e(`${slot.id}|${choice.name}`)}" aria-pressed="${on}">${e(choice.name)}</button>`;
    }).join('');
    return `<div class="pick-slot"><div class="slot-label">${e(slot.label)} <small>choose ${slot.count}</small></div><div class="chips">${chips}</div></div>`;
  }).join('');

  const row = (line: SkillLine): string => {
    const pool = line.role === 'pickup' ? sheet.points.pickup : sheet.points.package;
    const canDown = line.purchased > (line.role === 'pickup' ? 0 : 1);
    const canUp = line.purchased < SKILL_CAP && pool.spent + skillCost(line) <= pool.budget;
    const bonus = line.bonus ? `<span class="tag" title="From your people or home language">+${line.bonus}</span>` : '';
    return `<div class="skill-row ${line.role}"><span class="skill-name"><b>${e(line.name)}</b><small>${line.stat}${line.hard ? ' · hard (2 points a level)' : ''}</small></span><span class="skill-bonus">${bonus}</span>${stepper(line.name, 'skill', line.name, line.purchased, canDown, canUp, deps)}<span class="skill-check" title="${line.stat} + level">${line.check}</span></div>`;
  };
  const named = sheet.skills.filter(line => line.role !== 'pickup');
  const pickups = sheet.skills.filter(line => line.role === 'pickup');

  return section('What can they do?', 'Skills',
    `${slots}
     <div class="meters">${meter('Package', sheet.points.package)}${meter('Pick-up (INT + REF)', sheet.points.pickup)}</div>
     <h3 class="group-title">Calling skills</h3><div class="skill-grid">${named.map(row).join('')}</div>
     <h3 class="group-title">Pick-up skills</h3><div class="skill-grid">${pickups.map(row).join('')}</div>`);
}

function renderGear(draft: HeroDraft, result: BuildResult, deps: CreatorDeps): string {
  const e = deps.esc;
  const { sheet } = result;
  const { catalogue } = deps;
  const profession = catalogue.professions.find(row => row.id === draft.professionId);
  const race = catalogue.races.find(row => row.id === draft.raceId);
  const left = sheet.coin.left;

  const kitPicks = profession && profession.kit.items.length
    ? `<h3 class="group-title">Calling kit <small>take ${profession.kit.pick}</small></h3><div class="chips">${profession.kit.items.map(item => {
        const on = draft.kit.includes(item.label);
        return `<button type="button" class="chip ${on ? 'active' : ''}" data-creator="kit" data-value="${e(item.label)}" aria-pressed="${on}">${e(item.label)}</button>`;
      }).join('')}</div>`
    : '';
  const always = profession && profession.kit.special.length
    ? `<p class="hint">Always carried: ${profession.kit.special.map(item => e(item.label)).join(', ')}.</p>`
    : '';

  const coin = `<h3 class="group-title">Coin</h3><div class="coin-row">${meter('Crowns spent', { spent: sheet.coin.spent, budget: sheet.coin.total })}
      <button type="button" class="btn small" data-creator="rollCoin">Roll 2d6 (now ${draft.coinRoll})</button>
      <button type="button" class="btn small" data-creator="averageCoin">Take the average</button></div>`;

  const carried = new Set(sheet.weapons.map(weapon => weapon.id).filter(id => !draft.weapons.includes(id)));
  const shop = purchasableWeapons(catalogue);
  const groups = [...WEAPON_GROUPS, ['', 'Other']].map(([skill, label]) => {
    const rows = shop.filter(weapon => (skill ? weapon.combatSkill === skill : !WEAPON_GROUPS.some(([name]) => name === weapon.combatSkill)));
    if (!rows.length) return '';
    return `<div class="shop-group"><div class="slot-label">${label}</div>${rows.map((weapon: WeaponRow) => {
      const bought = draft.weapons.includes(weapon.id);
      const kit = carried.has(weapon.id);
      const cost = weapon.cost ?? 0;
      const disabled = kit || (!bought && cost > left);
      const effects = (weapon.effects ?? []).map(effectLabel).join(', ');
      return `<button type="button" class="shop-row ${bought ? 'active' : ''}" data-creator="weapon" data-value="${e(weapon.id)}" aria-pressed="${bought}" ${disabled ? 'disabled' : ''}>
        <b>${e(weapon.name)}</b><small>${e(weapon.damage)} · ${weapon.range === 'melee' ? 'melee' : `${weapon.range} m`}${weapon.hands === 2 ? ' · two-handed' : ''}${effects ? ` · ${e(effects)}` : ''}</small><span class="price">${kit ? 'in kit' : `${cost} cr`}</span></button>`;
    }).join('')}</div>`;
  }).join('');

  const freeFor = (slot: ArmorSlot): string | undefined => {
    const granted = [...(profession?.kit.special ?? []), ...(profession?.kit.items.filter(item => draft.kit.includes(item.label)) ?? [])];
    return granted.map(item => item.armor).map(id => catalogue.armor.find(piece => piece.id === id && piece.slot === slot)).find(Boolean)?.id;
  };
  const armour = ARMOR_SLOTS.map(slot => {
    const current = draft.armor[slot] ?? '';
    const free = freeFor(slot);
    const paidNow = current && current !== free ? (catalogue.armor.find(piece => piece.id === current)?.cost ?? 0) : 0;
    const options = catalogue.armor.filter(piece => piece.slot === slot).map(piece => {
      const price = piece.id === free ? 0 : piece.cost;
      const disabled = piece.id !== current && price > left + paidNow;
      return `<option value="${e(piece.id)}" ${piece.id === current ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${e(piece.name)} · SP ${piece.sp} · ${price ? `${price} cr` : 'free'}</option>`;
    }).join('');
    return `<label class="field">${SLOT_LABELS[slot]}<select data-field="armor:${slot}"><option value="">${free ? 'Kit piece' : 'None'}</option>${options}</select></label>`;
  }).join('');

  const kinds = ['potion', 'decoction', 'bomb', 'oil'];
  const kitBudget = sheet.points.fieldKit;
  const field = kinds.map(kind => {
    const items = catalogue.alchemy.filter(item => item.kind === kind);
    if (!items.length) return '';
    return `<div class="shop-group"><div class="slot-label">${KIND_LABELS[kind]}${kind === 'decoction' ? ' <small>2 points each</small>' : ''}</div><div class="field-grid">${items.map(item => {
      const count = draft.fieldKit[item.id] ?? 0;
      const locked = kind === 'decoction' && !race?.mutagens;
      const canUp = !locked && count < FIELD_KIT_ITEM_MAX && kitBudget.spent + fieldKitCost(item.kind) <= kitBudget.budget;
      return `<div class="field-row ${locked ? 'locked' : ''}"><span>${e(item.name)}</span>${stepper(item.name, 'field', item.id, count, count > 0, canUp, deps)}</div>`;
    }).join('')}</div></div>`;
  }).join('');

  return section('What do they carry?', 'Equipment',
    `${kitPicks}${always}${coin}
     <h3 class="group-title">Weapons <small>${left} crowns left</small></h3>${groups}
     <h3 class="group-title">Armour</h3><div class="creator-fields armour">${armour}</div>
     <h3 class="group-title">Field kit</h3>${meter('Kit points', kitBudget)}${race?.mutagens ? '' : '<p class="hint">This people cannot take decoctions.</p>'}${field}`);
}

function renderShare(model: CreatorModel, deps: CreatorDeps): string {
  return section('Keep or share', 'Hero file',
    `<p class="hint">Export writes your hero as text you can save. Paste a hero here and press Import to load it. Nothing leaves your browser.</p>
     <textarea id="creatorShare" data-field="share" rows="7" spellcheck="false" placeholder="Export writes your hero here. Paste one and press Import.">${deps.esc(model.shareText)}</textarea>
     <div class="button-row"><button type="button" class="btn" data-creator="export">Export</button><button type="button" class="btn" data-creator="import">Import</button></div>`);
}
