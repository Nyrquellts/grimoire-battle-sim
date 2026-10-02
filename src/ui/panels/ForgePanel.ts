import { exportContentPack, loadContentPack, type PackLoadResult } from '../../data/ContentPack';
import { scenarioStartOptions } from '../../actions/scenarios';
import type { RegistryHub } from '../../data/RegistryHub';
import type { IState, RegistryEntry } from '../../entities/types';

/**
 * The Forge: run authored scenarios, add characters, and load or export content packs.
 *
 * This is the answer to "I want to add new characters and scenarios". Everything it creates goes
 * through `ContentPack`'s schemas, so the Forge cannot register a row that a hand-written pack
 * file could not — one validated path, whether content arrives from a form, from pasted JSON, or
 * from a file in `src/data/packs/`.
 *
 * Presentation only. Starting a scenario asks `CombatFlow` to build the encounter and then
 * dispatches `scenarioOpening`; the panel never writes combat state itself.
 */

export interface ForgeDeps {
  esc(value: unknown): string;
  registry: RegistryHub;
  /** Builds the encounter. The same call the encounter builder makes. */
  startEncounter(options: { lineup: Array<Record<string, unknown>>; situation: string }): void;
  dispatch(action: string, payload: Record<string, unknown>): void;
  /** Reads a form field's current value. */
  fieldValue(id: string): string;
  /** Ephemeral panel feedback, held outside the store because it is not combat truth. */
  notice: ForgeNotice | null;
  setNotice(notice: ForgeNotice | null): void;
}

export interface ForgeNotice {
  tone: 'ok' | 'bad';
  title: string;
  lines: string[];
}

/** Species offered in the character form. Content, not rules — anything registered is allowed. */
const SPECIES = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Witcher', 'Vampire', 'Relict', 'Necrophage', 'Draconid', 'Hybrid', 'Beast'];

const STAT_KEYS = ['INT', 'REF', 'DEX', 'BODY', 'SPD', 'EMP', 'CRA', 'WILL', 'STUN', 'LUCK'] as const;

/** Skills the form exposes. The full list is long; these are the ones that change a fight. */
const FORM_SKILLS = [
  'Swordsmanship', 'Brawling', 'Crossbow', 'Athletics', 'Dodge / Escape',
  'Spell Casting', 'Resist Magic', 'Endurance', 'Physique', 'Awareness',
  'Courage', 'Intimidation', 'Alchemy', 'Melee (Shield)'
] as const;

/** Renders the whole Forge view. */
export function renderForge(state: IState, deps: ForgeDeps): string {
  return `<div class="forge-grid">
    ${renderScenarioColumn(state, deps)}
    ${renderCharacterColumn(deps)}
    ${renderPackColumn(deps)}
  </div>`;
}

/** Scenario picker: pick a set piece, read the briefing, fight it. */
function renderScenarioColumn(state: IState, deps: ForgeDeps): string {
  const scenarios = [...deps.registry.scenarios.values()];
  const activeId = String((state.ui as Record<string, unknown>).forgeScenario ?? scenarios[0]?.id ?? '');
  const active = scenarios.find(scenario => scenario.id === activeId) ?? scenarios[0];

  const list = scenarios.map(scenario => {
    const selected = scenario.id === active?.id ? ' selected' : '';
    const foes = (scenario.lineup as Array<Record<string, unknown>>)
      .map(entry => `${entry.quantity}× ${entry.foe}`).join(', ');
    return `<button class="forge-row${selected}" data-forge="pickScenario" data-value="${deps.esc(scenario.id)}">
      <b>${deps.esc(scenario.name)}</b>
      <small>${deps.esc(scenario.summary)}</small>
      <span class="forge-tags">${deps.esc(foes)} · ${deps.esc(scenario.situation)}</span>
    </button>`;
  }).join('');

  const detail = active ? `<div class="forge-briefing">
      <div class="eyebrow">Briefing</div>
      <p>${deps.esc(active.briefing)}</p>
      <div class="forge-tag-row">${((active.tags as string[]) ?? []).map(tag => `<span class="badge">${deps.esc(tag)}</span>`).join('')}</div>
      <button class="btn primary" data-forge="runScenario" data-value="${deps.esc(active.id)}">Run ${deps.esc(active.name)}</button>
    </div>` : '<div class="muted">No scenarios registered.</div>';

  return `<section class="panel forge-panel">
    <div class="panel-head"><div><div class="eyebrow">Scenarios</div><h2>Set pieces</h2></div><span class="badge">${scenarios.length}</span></div>
    <div class="panel-body"><div class="forge-list">${list}</div>${detail}</div>
  </section>`;
}

/** Character forge: a compact sheet that produces a validated character definition. */
function renderCharacterColumn(deps: ForgeDeps): string {
  const characters = [...deps.registry.characters.values()];
  const weapons = [...deps.registry.weapons.values()];
  const focuses = [...deps.registry.focusItems.values()];

  const stats = STAT_KEYS.map(key =>
    `<label class="field tiny">${key}<input id="forgeStat${key}" type="number" min="1" max="20" value="${key === 'LUCK' ? 3 : 8}"></label>`
  ).join('');

  const skills = FORM_SKILLS.map(skill =>
    `<label class="field tiny">${deps.esc(skill)}<input id="forgeSkill${slugField(skill)}" type="number" min="0" max="30" value="0"></label>`
  ).join('');

  const roster = characters.map(character => `<div class="forge-row static">
      <b>${deps.esc(character.name)}</b>
      <small>${deps.esc(character.raceSpecies ?? 'Human')} · ${deps.esc(character.source?.status ?? 'custom')}</small>
      <span class="forge-tags">HP ${deps.esc(character.derived?.maxHp ?? '—')} · STA ${deps.esc(character.derived?.maxSta ?? '—')} · Vigor ${deps.esc(character.derived?.vigor ?? 0)}</span>
    </div>`).join('');

  return `<section class="panel forge-panel">
    <div class="panel-head"><div><div class="eyebrow">Characters</div><h2>Roster</h2></div><span class="badge">${characters.length}</span></div>
    <div class="panel-body">
      <div class="forge-list short">${roster}</div>
      <details class="forge-form" open>
        <summary>Forge a character</summary>
        <div class="forge-fields">
          <label class="field">Name<input id="forgeName" placeholder="Sylvia of Ard Carraigh"></label>
          <label class="field">Species<select id="forgeSpecies">${SPECIES.map(species => `<option>${species}</option>`).join('')}</select></label>
          <label class="field">Gender<input id="forgeGender" placeholder="Female"></label>
          <label class="field">Region<input id="forgeRegion" placeholder="Kaedwen"></label>
        </div>
        <div class="forge-fields quad">
          <label class="field tiny">Max HP<input id="forgeHp" type="number" min="1" max="500" value="40"></label>
          <label class="field tiny">Max STA<input id="forgeSta" type="number" min="1" max="500" value="30"></label>
          <label class="field tiny">REC<input id="forgeRec" type="number" min="1" max="60" value="6"></label>
          <label class="field tiny">Vigor<input id="forgeVigor" type="number" min="0" max="20" value="0"></label>
        </div>
        <div class="forge-section-label">Statistics</div>
        <div class="forge-fields stats">${stats}</div>
        <div class="forge-section-label">Skills that matter in a fight</div>
        <div class="forge-fields stats">${skills}</div>
        <div class="forge-section-label">Kit</div>
        <div class="forge-fields">
          <label class="field">Weapon<select id="forgeWeapon"><option value="">none</option>${weapons.map(weapon => `<option value="${deps.esc(weapon.id)}">${deps.esc(weapon.name)}</option>`).join('')}</select></label>
          <label class="field">Focus<select id="forgeFocus"><option value="">none</option>${focuses.map(focus => `<option value="${deps.esc(focus.id)}">${deps.esc(focus.name)}</option>`).join('')}</select></label>
          <label class="field">Armour SP<input id="forgeArmor" type="number" min="0" max="60" value="0"></label>
        </div>
        <label class="field">Biography<textarea id="forgeBio" rows="2" placeholder="Who they are, and why they are here."></textarea></label>
        <div class="button-row"><button class="btn primary" data-forge="createCharacter">Add to roster</button></div>
      </details>
    </div>
  </section>`;
}

/** Import and export: the durable way to keep authored content. */
function renderPackColumn(deps: ForgeDeps): string {
  const notice = deps.notice
    ? `<div class="forge-notice ${deps.notice.tone}"><b>${deps.esc(deps.notice.title)}</b>${deps.notice.lines.map(line => `<div>${deps.esc(line)}</div>`).join('')}</div>`
    : '';

  return `<section class="panel forge-panel">
    <div class="panel-head"><div><div class="eyebrow">Content packs</div><h2>Import &amp; export</h2></div></div>
    <div class="panel-body">
      ${notice}
      <p class="muted">Packs are plain JSON: characters, scenarios, and Sign augments. Paste one below to load it for
      this session, or export what you have made and save it into <code>src/data/packs/</code> to keep it permanently.</p>
      <label class="field">Pack JSON<textarea id="forgePack" rows="10" spellcheck="false" placeholder='{ "name": "My pack", "scenarios": [ ... ] }'></textarea></label>
      <div class="button-row">
        <button class="btn primary" data-forge="loadPack">Load pack</button>
        <button class="btn" data-forge="exportPack">Export custom content</button>
        <button class="btn" data-forge="templatePack">Insert template</button>
      </div>
    </div>
  </section>`;
}

/**
 * Handles a Forge control. Returns `true` when the click was consumed.
 *
 * Every path that adds content funnels through `loadContentPack`, so the form and the paste box
 * are validated identically.
 */
export function handleForgeAction(
  action: string,
  value: string,
  state: IState,
  deps: ForgeDeps,
  store: { update(mutator: (draft: IState) => void): unknown }
): boolean {
  if (action === 'pickScenario') {
    store.update(draft => { (draft.ui as Record<string, unknown>).forgeScenario = value; });
    return true;
  }

  if (action === 'runScenario') {
    const scenario = deps.registry.scenarios.get(value);
    if (!scenario) { deps.setNotice({ tone: 'bad', title: 'Unknown scenario', lines: [value] }); return true; }
    deps.startEncounter(scenarioStartOptions(scenario));
    deps.dispatch('scenarioOpening', { scenarioId: scenario.id });
    deps.setNotice({ tone: 'ok', title: `${scenario.name} begins`, lines: ['Switch to the Game tab.'] });
    return true;
  }

  if (action === 'createCharacter') {
    const result = loadContentPack(deps.registry, { name: 'Forge', characters: [characterFromForm(deps)] });
    deps.setNotice(noticeFor(result, 'Character'));
    return true;
  }

  if (action === 'loadPack') {
    const text = deps.fieldValue('forgePack').trim();
    if (!text) { deps.setNotice({ tone: 'bad', title: 'Nothing to load', lines: ['Paste a pack into the box first.'] }); return true; }
    const result = loadContentPack(deps.registry, text);
    deps.setNotice(noticeFor(result, 'Pack'));
    return true;
  }

  if (action === 'exportPack') {
    const pack = customPack(deps);
    deps.setNotice({
      tone: 'ok',
      title: 'Exported',
      lines: [`${pack.characters.length} characters, ${pack.scenarios.length} scenarios, ${pack.signAugments.length} augments — JSON is in the box.`]
    });
    return true;
  }

  if (action === 'templatePack') {
    deps.setNotice({ tone: 'ok', title: 'Template inserted', lines: ['Edit it, then press Load pack.'] });
    return true;
  }

  return false;
}

/**
 * Everything the owner has authored, as a pack.
 *
 * "Authored" means anything that ships with the project rather than the owner's own work:
 * characters marked `custom`, every scenario (they are all set pieces rather than rules), and
 * augments declared `house` or `original`. Built-in content is deliberately excluded — an export
 * is meant to be shareable work, not a copy of the base game.
 */
function customPack(deps: ForgeDeps) {
  const authored = <T extends RegistryEntry>(table: Map<string, T>): string[] =>
    [...table.values()]
      .filter(row => row.source?.status === 'custom' || row.ruleStatus === 'house' || row.ruleStatus === 'original')
      .map(row => row.id);

  return exportContentPack(deps.registry, {
    characters: authored(deps.registry.characters),
    scenarios: [...deps.registry.scenarios.values()].map(row => row.id),
    signAugments: authored(deps.registry.signAugments)
  }, { name: 'Exported pack', notes: 'Generated by the Forge.' });
}

/** The JSON the export and template buttons write into the textarea. */
export function forgeTextFor(action: string, deps: ForgeDeps): string | null {
  if (action === 'exportPack') return JSON.stringify(customPack(deps), null, 2);
  if (action === 'templatePack') return TEMPLATE_PACK;
  return null;
}

/** Builds a character definition from the form fields. */
function characterFromForm(deps: ForgeDeps): Record<string, unknown> {
  const name = deps.fieldValue('forgeName').trim() || 'Unnamed';
  const armor = Number(deps.fieldValue('forgeArmor')) || 0;
  const weapon = deps.fieldValue('forgeWeapon');
  const focus = deps.fieldValue('forgeFocus');

  const stats: Record<string, number> = {};
  for (const key of STAT_KEYS) {
    const raw = Number(deps.fieldValue(`forgeStat${key}`));
    if (Number.isFinite(raw) && raw > 0) stats[key] = Math.max(1, Math.min(20, Math.round(raw)));
  }

  const skills: Record<string, number> = {};
  for (const skill of FORM_SKILLS) {
    const raw = Number(deps.fieldValue(`forgeSkill${slugField(skill)}`));
    if (Number.isFinite(raw) && raw > 0) skills[skill] = Math.max(0, Math.min(30, Math.round(raw)));
  }

  return {
    id: uniqueId(deps.registry, name),
    name,
    source: { status: 'custom', origin: 'Forged in the Forge' },
    identity: {
      gender: deps.fieldValue('forgeGender').trim() || null,
      age: null,
      region: deps.fieldValue('forgeRegion').trim() || null
    },
    raceSpecies: deps.fieldValue('forgeSpecies') || 'Human',
    biography: deps.fieldValue('forgeBio').trim() || undefined,
    stats,
    skills,
    derived: {
      maxHp: clamp(Number(deps.fieldValue('forgeHp')), 1, 500, 40),
      maxSta: clamp(Number(deps.fieldValue('forgeSta')), 1, 500, 30),
      rec: clamp(Number(deps.fieldValue('forgeRec')), 1, 60, 6),
      vigor: clamp(Number(deps.fieldValue('forgeVigor')), 0, 20, 0)
    },
    equipment: {
      weapons: weapon ? [weapon] : [],
      tools: [],
      focusItems: focus ? [focus] : [],
      armorMaxByLocation: armor > 0
        ? { head: armor, torso: armor, leftArm: armor, rightArm: armor, leftLeg: armor, rightLeg: armor }
        : {}
    }
  };
}

/** Turns a load result into panel feedback, reporting partial success honestly. */
function noticeFor(result: PackLoadResult, label: string): ForgeNotice {
  const added = result.added.characters.length + result.added.scenarios.length + result.added.signAugments.length;
  if (!result.ok && !added) {
    return { tone: 'bad', title: `${label} rejected`, lines: result.errors.slice(0, 6) };
  }
  const lines = [
    `${result.added.characters.length} characters, ${result.added.scenarios.length} scenarios, ${result.added.signAugments.length} augments added.`,
    ...(result.skipped.length ? [`Skipped, already registered: ${result.skipped.join(', ')}`] : []),
    ...result.errors.slice(0, 4)
  ];
  return { tone: result.errors.length ? 'bad' : 'ok', title: `${label} loaded`, lines };
}

/** A registry-unique id derived from a display name. */
function uniqueId(registry: RegistryHub, name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  if (!registry.characters.has(base)) return base;
  for (let suffix = 2; suffix < 200; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!registry.characters.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Field ids cannot carry spaces or punctuation from a skill name. */
function slugField(label: string): string {
  return label.replace(/[^a-zA-Z0-9]+/g, '');
}

/** A worked example covering all three pack sections. */
export const TEMPLATE_PACK = JSON.stringify({
  formatVersion: 1,
  name: 'My pack',
  author: '',
  notes: 'Edit freely. Ids must be unique.',
  characters: [{
    id: 'example-swordswoman',
    name: 'Example Swordswoman',
    source: { status: 'custom', origin: 'My pack' },
    identity: { gender: 'Female', age: 31, region: 'Kaedwen' },
    raceSpecies: 'Human',
    biography: 'A sell-sword who has outlived three companies.',
    stats: { INT: 7, REF: 11, DEX: 10, BODY: 10, SPD: 9, EMP: 6, CRA: 6, WILL: 9, STUN: 10, LUCK: 3 },
    skills: { Swordsmanship: 14, Athletics: 12, 'Dodge / Escape': 12, Endurance: 11, Courage: 10 },
    derived: { maxHp: 50, maxSta: 40, rec: 10, vigor: 0 },
    equipment: { weapons: ['longsword'], tools: [], focusItems: [], armorMaxByLocation: { torso: 10, leftArm: 6, rightArm: 6 } }
  }],
  scenarios: [{
    id: 'example-ambush',
    name: 'Example Ambush',
    summary: 'Two ghouls in a ruined chapel.',
    briefing: 'Something has been dragging the dead out of the chapel yard, and it has not been going far to eat them.',
    situation: 'ruins',
    lineup: [{ foe: 'ghoul', quantity: 2, region: 'Temeria', experience: 'random', loadout: 'random' }],
    zones: [],
    tags: ['necrophage'],
    source: { status: 'custom', origin: 'My pack' }
  }],
  signAugments: [{
    id: 'exampleEmberwake',
    name: 'Emberwake',
    description: 'Fire that clings and keeps burning after the wave has passed.',
    staCost: 2,
    exclusiveGroup: 'intensity',
    appliesTo: { elements: ['Fire'] },
    requires: { minSkill: 12 },
    effects: { ignitionChance: 25, applies: [{ condition: 'burning' }] },
    ruleStatus: 'house'
  }]
}, null, 2);
