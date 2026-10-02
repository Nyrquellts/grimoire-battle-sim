import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CombatFlow, Heroes, Pipeline, Registry, Store } from '../../src/services/SimulationRuntime';
import { PresentationShell } from '../../src/ui/Shell';
import { catalogueFrom, exportHero, quickBuild, type HeroDraft, type Roll } from '../../src/services/CharacterBuilder';

/**
 * The shell wires the creator panel to the page: it routes clicks and typing, keeps the draft the
 * player is building, and seats the chosen hero. The page itself is replaced here by a few plain
 * objects, which is enough because the shell only ever reads `innerHTML`, `value` and `dataset`.
 */

class Node {
  innerHTML = '';
  value = '';
  scrollTop = 0;
  readonly listeners = new Map<string, (event: unknown) => void>();
  addEventListener(type: string, listener: (event: unknown) => void): void { this.listeners.set(type, listener); }
  closest(): null { return null; }
}

const catalogue = catalogueFrom(Registry);
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));

function scripted(...values: number[]): Roll {
  let index = 0;
  return () => values[index++ % values.length] ?? 1;
}

function setup(random: Roll = scripted(3)) {
  const nodes = { characterRoot: new Node(), creatorSheet: new Node(), creatorShare: new Node() };
  const shell = new PresentationShell({
    pipeline: { on: () => () => undefined } as unknown as typeof Pipeline,
    registry: Registry,
    store: Store,
    startEncounter: () => undefined,
    dispatch: () => undefined,
    heroes: Heroes,
    random,
    byId: id => (nodes as Record<string, Node | undefined>)[id] as unknown as HTMLElement | null ?? null,
    query: () => null,
    esc
  });
  shell.initialize();
  shell.onViewOpened('character');

  const button = (creator: string, value = ''): HTMLElement => ({ dataset: { creator, value } }) as unknown as HTMLElement;
  const press = (creator: string, value = ''): boolean => shell.handleClick(button(creator, value));
  const type = (field: string, value: string): void => {
    nodes.characterRoot.listeners.get('input')?.({ target: { dataset: { field }, tagName: 'INPUT', value } });
  };
  const choose = (field: string, value: string): void => {
    nodes.characterRoot.listeners.get('change')?.({ target: { dataset: { field }, tagName: 'SELECT', value } });
  };
  return { shell, nodes, press, type, choose };
}

const reset = (): void => { Heroes.choose('nikhail'); CombatFlow.reset(); };
beforeEach(reset);
afterEach(reset);

const notice = (nodes: { characterRoot: Node; creatorSheet: Node }): string =>
  /creator-notice (ok|bad)" role="status">([^<]*)</.exec(nodes.characterRoot.innerHTML)?.[0] ?? '';

describe('opening the creator', () => {
  it('paints the creator and starts from a ready, named starter hero when a veteran holds the seat', () => {
    const { nodes } = setup();
    const html = nodes.characterRoot.innerHTML;
    expect(html).toContain('Who are they?');
    expect(html).toContain('Ready for battle.');
    expect(html).toMatch(/<h2>[^<]+<\/h2>\s*<small>Human Man at Arms/);
  });

  it('opens on the hero in the seat when it was built in the creator', () => {
    Heroes.choose('maren-coldbrook');
    const { nodes } = setup();
    expect(nodes.characterRoot.innerHTML).toContain('Maren Coldbrook');
  });

  it('keeps the draft between visits instead of starting over', () => {
    const { shell, nodes, press, type } = setup();
    type('name', 'Ysolde Vale');
    press('race', 'elf');
    shell.onViewOpened('game');
    shell.onViewOpened('character');
    expect(nodes.characterRoot.innerHTML).toContain('Ysolde Vale');
    expect(nodes.characterRoot.innerHTML).toContain('Elf Man at Arms');
  });
});

describe('editing', () => {
  it('repaints the whole page for a button, and says nothing it did not change', () => {
    const { nodes, press } = setup();
    const before = nodes.characterRoot.innerHTML;
    expect(press('race', 'elf')).toBe(true);
    expect(nodes.characterRoot.innerHTML).not.toBe(before);
    expect(nodes.characterRoot.innerHTML).toMatch(/data-creator="race" data-value="elf" aria-pressed="true"/);
  });

  it('repaints only the sheet while a text field is typed in, so the caret is never disturbed', () => {
    const { nodes, type } = setup();
    const page = nodes.characterRoot.innerHTML;
    type('name', 'Ysolde Vale');
    expect(nodes.characterRoot.innerHTML).toBe(page);
    expect(nodes.creatorSheet.innerHTML).toContain('Ysolde Vale');
  });

  it('shows what the typed name does to the sheet straight away, including an empty one', () => {
    const { nodes, type } = setup();
    type('name', '');
    expect(nodes.creatorSheet.innerHTML).toContain('Give your hero a name.');
    expect(nodes.creatorSheet.innerHTML).toMatch(/data-creator="use" disabled/);
    type('name', 'Ysolde');
    expect(nodes.creatorSheet.innerHTML).toContain('Ready for battle.');
  });

  it('repaints the whole page when a select changes, because budgets elsewhere can move', () => {
    const { nodes, choose } = setup();
    choose('statTier', 'legends');
    expect(nodes.characterRoot.innerHTML).toContain('/ 80');
  });

  it('ignores typing in the share box except to remember it, and a field it does not own', () => {
    const { nodes, type } = setup();
    const page = nodes.characterRoot.innerHTML;
    type('share', 'pasted text');
    type('hp', '9999');
    expect(nodes.characterRoot.innerHTML).toBe(page);
    expect(nodes.creatorSheet.innerHTML).toBe('');
  });

  it('does not consume buttons it does not own, or actions it does not know', () => {
    const { shell, press } = setup();
    expect(press('teleport')).toBe(false);
    expect(shell.handleClick({ dataset: { action: 'start' } } as unknown as HTMLElement)).toBe(false);
  });

  it('rolls with the dice it is given', () => {
    const first = setup(scripted(6));
    first.press('rollStats');
    const second = setup(scripted(6));
    second.press('rollStats');
    expect(first.nodes.characterRoot.innerHTML).toBe(second.nodes.characterRoot.innerHTML);
    expect(first.nodes.characterRoot.innerHTML).toContain('data-creator="rollStats"');
  });
});

describe('using a hero', () => {
  it('seats a finished hero: the roster and the live game both hold them', () => {
    const { nodes, press, type } = setup();
    type('name', 'Ysolde Vale');
    press('race', 'elf');
    press('profession', 'bard');
    type('name', 'Ysolde Vale');

    expect(press('use')).toBe(true);
    expect(Heroes.current()).toEqual({ kind: 'custom', id: null, name: 'Ysolde Vale' });
    expect(Store.read().player.name).toBe('Ysolde Vale');
    expect(Store.read().player.identity?.race).toBe('Elf');
    expect(notice(nodes)).toContain('Ysolde Vale is your hero.');
    expect(nodes.characterRoot.innerHTML).toContain('Update this hero');
  });

  it('refuses a hero with errors and leaves the seat alone, saying why', () => {
    const { nodes, press, type } = setup();
    type('name', '');
    expect(press('use')).toBe(true);
    expect(Heroes.current().id).toBe('nikhail');
    expect(Store.read().player.id).toBe('nikhail');
    expect(notice(nodes)).toContain('creator-notice bad');
    expect(notice(nodes)).toContain('Give your hero a name.');
  });

  it('never swaps the hero mid-battle: the choice waits for the next one', () => {
    const { nodes, press, type } = setup();
    type('name', 'Ysolde Vale');
    Store.update(draft => { draft.phase = 'combat'; });
    const fighting = Store.read().player;

    press('use');
    expect(Heroes.current().name).toBe('Ysolde Vale');
    expect(Store.read().player).toEqual(fighting);
    expect(notice(nodes)).toContain('will be your hero in the next battle');
  });

  it('the next battle fights as the chosen hero', () => {
    const { press, type } = setup();
    type('name', 'Ysolde Vale');
    press('use');
    CombatFlow.reset();
    expect(Store.read().player.name).toBe('Ysolde Vale');
  });
});

describe('premade heroes', () => {
  it('plays a premade hero in the seat', () => {
    const { nodes, press } = setup();
    expect(press('play', 'maren-coldbrook')).toBe(true);
    expect(Heroes.current().id).toBe('maren-coldbrook');
    expect(Store.read().player.name).toBe('Maren Coldbrook');
    expect(notice(nodes)).toContain('Maren Coldbrook holds the player');
  });

  it('plays the veteran again after a custom hero', () => {
    const { press, type } = setup();
    type('name', 'Ysolde Vale');
    press('use');
    press('play', 'nikhail');
    expect(Heroes.current()).toMatchObject({ kind: 'preset', id: 'nikhail' });
    expect(Store.read().player.id).toBe('nikhail');
  });

  it('refuses a premade hero that does not exist', () => {
    const { press } = setup();
    expect(press('play', 'nobody')).toBe(false);
    expect(Heroes.current().id).toBe('nikhail');
  });

  it('copies a fresh premade into the creator to edit, without taking the seat', () => {
    const { nodes, press } = setup();
    expect(press('edit', 'borgar-hammerfall')).toBe(true);
    expect(nodes.characterRoot.innerHTML).toContain('Borgar Hammerfall');
    expect(nodes.characterRoot.innerHTML).toContain('Copied Borgar Hammerfall');
    expect(Heroes.current().id).toBe('nikhail');
  });

  it('has no copy to edit for the veteran, which is hand-built', () => {
    const { press } = setup();
    expect(press('edit', 'nikhail')).toBe(false);
  });
});

describe('sharing a hero', () => {
  it('exports the draft into the share box', () => {
    const { nodes, press, type } = setup();
    type('name', 'Ysolde Vale');
    press('export');
    expect(nodes.characterRoot.innerHTML).toContain('&quot;format&quot;: &quot;grimoire-hero&quot;');
    expect(nodes.characterRoot.innerHTML).toContain('Ysolde Vale');
    expect(notice(nodes)).toContain('creator-notice ok');
  });

  it('imports a pasted hero and makes it the draft', () => {
    const { nodes, press } = setup();
    const imported: HeroDraft = quickBuild({ raceId: 'dwarf', professionId: 'craftsman', name: 'Brokk Ironhand' }, catalogue);
    nodes.creatorShare.value = exportHero(imported, catalogue);

    expect(press('import')).toBe(true);
    expect(notice(nodes)).toContain('Imported Brokk Ironhand.');
    expect(nodes.characterRoot.innerHTML).toContain('Dwarf Craftsman');
    expect(Heroes.current().id).toBe('nikhail');
  });

  it('reports a damaged or foreign file and keeps the hero being built', () => {
    const { nodes, press, type } = setup();
    type('name', 'Ysolde Vale');
    nodes.creatorShare.value = '{"format":"something-else"}';
    expect(press('import')).toBe(true);
    expect(notice(nodes)).toContain('creator-notice bad');
    expect(notice(nodes)).toContain('That is not a Grimoire hero file.');

    nodes.creatorShare.value = 'not json at all';
    press('import');
    expect(notice(nodes)).toContain('That is not valid JSON.');
    press('export');
    expect(nodes.characterRoot.innerHTML).toContain('Ysolde Vale');
  });

  it('round trips: an exported hero imports as the same hero', () => {
    const first = setup();
    first.type('name', 'Ysolde Vale');
    first.press('race', 'elf');
    first.press('export');
    const written = /<textarea[^>]*>([^<]*)<\/textarea>/.exec(first.nodes.characterRoot.innerHTML)?.[1] ?? '';
    const text = written.replace(/&quot;/g, '"').replace(/&amp;/g, '&');

    const second = setup();
    second.nodes.creatorShare.value = text;
    second.press('import');
    expect(second.nodes.characterRoot.innerHTML).toContain('Ysolde Vale');
    expect(second.nodes.characterRoot.innerHTML).toContain('Elf Man at Arms');
  });
});
