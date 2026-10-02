import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgeTextFor, handleForgeAction, renderForge, TEMPLATE_PACK, type ForgeDeps, type ForgeNotice } from '../../src/ui/panels/ForgePanel';
import { CombatFlow, Store } from '../../src/services/SimulationRuntime';
import { Registry } from '../../src/data/witcherContent';
import { parseContentPack } from '../../src/data/ContentPack';
import type { IState } from '../../src/entities/types';

/**
 * The Forge is the authoring surface, so these tests care about two things: that authored content
 * reaches the registry through the validated path, and that running a scenario builds the encounter
 * and then dispatches its opening rather than writing state itself.
 */

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"]/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character);

interface Harness {
  deps: ForgeDeps;
  fields: Record<string, string>;
  started: Array<{ lineup: Array<Record<string, unknown>>; situation: string }>;
  dispatched: Array<[string, Record<string, unknown>]>;
  notice(): ForgeNotice | null;
}

function harness(fields: Record<string, string> = {}): Harness {
  const started: Harness['started'] = [];
  const dispatched: Harness['dispatched'] = [];
  let notice: ForgeNotice | null = null;
  const deps: ForgeDeps = {
    esc,
    registry: Registry,
    startEncounter: options => { started.push(options); },
    dispatch: (action, payload) => { dispatched.push([action, payload]); },
    fieldValue: id => fields[id] ?? '',
    get notice() { return notice; },
    setNotice: next => { notice = next; }
  } as ForgeDeps;
  return { deps, fields, started, dispatched, notice: () => notice };
}

const store = {
  update(mutator: (draft: IState) => void) { return Store.update(mutator); }
};

describe('Forge rendering', () => {
  it('lists every registered scenario with its opposition', () => {
    const html = renderForge(Store.read(), harness().deps);
    expect(html).toContain('The Roadside Toll');
    expect(html).toContain('Griffin Above the Crags');
    expect(html).toContain('4× bandit');
  });

  it('shows the briefing for the selected scenario', () => {
    const state = structuredClone(Store.read()) as IState;
    (state.ui as Record<string, unknown>).forgeScenario = 'nekker-warren';
    const html = renderForge(state, harness().deps);

    expect(html).toContain('Nekker Warren');
    expect(html).toContain('break for the mounds');
    expect(html).toContain('data-forge="runScenario" data-value="nekker-warren"');
  });

  it('renders the character sheet form and the current roster', () => {
    const html = renderForge(Store.read(), harness().deps);
    expect(html).toContain('id="forgeName"');
    expect(html).toContain('id="forgeStatBODY"');
    expect(html).toContain('id="forgeSkillSpellCasting"');
    expect(html).toContain('Nikhail');
  });

  it('offers registered focus items as character kit', () => {
    const html = renderForge(Store.read(), harness().deps);
    expect(html).toContain('Gnomish staff');
  });

  it('surfaces a notice when one is set', () => {
    const test = harness();
    test.deps.setNotice({ tone: 'bad', title: 'Nope', lines: ['because'] });
    const html = renderForge(Store.read(), { ...test.deps, notice: test.notice() } as ForgeDeps);
    expect(html).toContain('forge-notice bad');
    expect(html).toContain('because');
  });
});

describe('Forge scenario launch', () => {
  afterEach(() => CombatFlow.reset());

  it('builds the encounter and then dispatches the opening', () => {
    const test = harness();
    const handled = handleForgeAction('runScenario', 'drowners-at-the-ford', Store.read(), test.deps, store);

    expect(handled).toBe(true);
    expect(test.started).toHaveLength(1);
    expect(test.started[0]?.situation).toBe('ravine');
    expect(test.started[0]?.lineup[0]).toMatchObject({ foe: 'drowner', quantity: 5 });
    expect(test.dispatched).toEqual([['scenarioOpening', { scenarioId: 'drowners-at-the-ford' }]]);
  });

  it('reports an unknown scenario instead of starting anything', () => {
    const test = harness();
    handleForgeAction('runScenario', 'no-such-scenario', Store.read(), test.deps, store);

    expect(test.started).toHaveLength(0);
    expect(test.notice()?.tone).toBe('bad');
  });

  it('records the scenario being previewed without launching it', () => {
    const test = harness();
    handleForgeAction('pickScenario', 'wyvern-on-the-pass', Store.read(), test.deps, store);

    expect((Store.read().ui as Record<string, unknown>).forgeScenario).toBe('wyvern-on-the-pass');
    expect(test.started).toHaveLength(0);
  });
});

describe('Forge character creation', () => {
  const fields = {
    forgeName: 'Sylvia of Ard Carraigh',
    forgeSpecies: 'Human',
    forgeGender: 'Female',
    forgeRegion: 'Kaedwen',
    forgeHp: '52', forgeSta: '38', forgeRec: '9', forgeVigor: '2',
    forgeStatBODY: '11', forgeStatREF: '12', forgeStatWILL: '9',
    forgeSkillSwordsmanship: '15', forgeSkillSpellCasting: '8',
    forgeWeapon: 'manticoreSteel', forgeFocus: 'oakStaff', forgeArmor: '8',
    forgeBio: 'Outlived three companies.'
  };

  it('registers a validated character from the form', () => {
    const test = harness(fields);
    handleForgeAction('createCharacter', '', Store.read(), test.deps, store);

    const created = Registry.characters.get('sylvia-of-ard-carraigh');
    expect(created).toBeDefined();
    expect(created?.name).toBe('Sylvia of Ard Carraigh');
    expect(created?.derived.maxHp).toBe(52);
    expect(created?.derived.vigor).toBe(2);
    expect(created?.stats.BODY).toBe(11);
    expect(created?.skills.Swordsmanship).toBe(15);
    expect(created?.equipment.weapons).toEqual(['manticoreSteel']);
    expect(created?.equipment.focusItems).toEqual(['oakStaff']);
    expect(created?.equipment.armorMaxByLocation.torso).toBe(8);
    expect(created?.source.status).toBe('custom');
    expect(test.notice()?.tone).toBe('ok');
  });

  it('gives a second character of the same name a distinct id', () => {
    const test = harness({ ...fields, forgeName: 'Duplicate Name' });
    handleForgeAction('createCharacter', '', Store.read(), test.deps, store);
    handleForgeAction('createCharacter', '', Store.read(), test.deps, store);

    expect(Registry.characters.has('duplicate-name')).toBe(true);
    expect(Registry.characters.has('duplicate-name-2')).toBe(true);
  });

  it('clamps out-of-range sheet values rather than registering nonsense', () => {
    const test = harness({ ...fields, forgeName: 'Clamped One', forgeHp: '99999', forgeVigor: '-4' });
    handleForgeAction('createCharacter', '', Store.read(), test.deps, store);

    const created = Registry.characters.get('clamped-one');
    expect(created?.derived.maxHp).toBe(500);
    expect(created?.derived.vigor).toBe(0);
  });
});

describe('Forge pack import and export', () => {
  it('refuses an empty paste box with an explanation', () => {
    const test = harness({ forgePack: '   ' });
    handleForgeAction('loadPack', '', Store.read(), test.deps, store);

    expect(test.notice()).toMatchObject({ tone: 'bad', title: 'Nothing to load' });
  });

  it('loads a pasted pack', () => {
    const pack = JSON.stringify({
      name: 'Paste test',
      scenarios: [{
        id: 'pasted-skirmish', name: 'Pasted Skirmish', situation: 'woods',
        lineup: [{ foe: 'bandit', quantity: 3 }]
      }]
    });
    const test = harness({ forgePack: pack });
    handleForgeAction('loadPack', '', Store.read(), test.deps, store);

    expect(Registry.scenarios.has('pasted-skirmish')).toBe(true);
    expect(test.notice()?.tone).toBe('ok');
  });

  it('reports validation errors from a bad paste without registering anything', () => {
    const test = harness({ forgePack: '{"scenarios":[{"id":"broken","name":"Broken"}]}' });
    handleForgeAction('loadPack', '', Store.read(), test.deps, store);

    expect(Registry.scenarios.has('broken')).toBe(false);
    expect(test.notice()?.tone).toBe('bad');
  });

  it('produces a template that is itself a valid pack', () => {
    expect(parseContentPack(TEMPLATE_PACK).ok).toBe(true);
    expect(forgeTextFor('templatePack', harness().deps)).toBe(TEMPLATE_PACK);
  });

  it('exports authored content as a pack that can be loaded back', () => {
    const test = harness();
    const text = forgeTextFor('exportPack', test.deps);
    expect(text).toBeTruthy();

    const parsed = parseContentPack(text as string);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack.scenarios.length).toBeGreaterThan(0);
  });

  it('leaves built-in content out of an export', () => {
    const parsed = parseContentPack(forgeTextFor('exportPack', harness().deps) as string);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // `nikhail` is registered as a project character, not custom, so it is not exported as own work.
    expect(parsed.pack.characters.map(character => character.id)).not.toContain('nikhail');
  });

  it('returns no text for an action that does not write the box', () => {
    expect(forgeTextFor('runScenario', harness().deps)).toBeNull();
  });
});
