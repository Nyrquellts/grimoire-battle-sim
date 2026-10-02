import { ammoPools, ammoTotal, isLoaded, requiresReload, type AmmunitionWeapon } from '../../services/Ammunition';
import type { IActor, IState, RegistryEntry } from '../../entities/types';

/**
 * The Attack palette: weapons, strike modes, called locations, shooting and bombs.
 *
 * It reads the hero's own weapons and consumables rather than a fixed list, so a hero from the
 * creator and a premade veteran are played through the same controls. Like the other panels it is
 * a string renderer plus a plain-data click handler: it never writes combat state, only the
 * display choices (`ui.attackPane`, `ui.weapon`, ...) that say what the next request will ask for.
 */

export interface AttackPanelDeps {
  esc(value: unknown): string;
  weapons: { get(id: string): RegistryEntry | undefined };
  alchemy: Iterable<RegistryEntry>;
  /** The turn-lock banner the host computed, or an empty string. */
  lock: string;
  /** The opponent currently selected, if any. */
  target: IActor | undefined;
  /** Whether it is the player's turn and nothing is pending. */
  canAct: boolean;
}

/** A request for the action gateway: `[action name, payload]`. */
export type AttackRequest = [string, Record<string, unknown>];

const PANES: Array<[string, string]> = [['melee', 'Melee'], ['ranged', 'Ranged'], ['brawl', 'Brawl'], ['bombs', 'Bombs']];
const LOCATIONS = ['random', 'head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const MODES: Array<[string, string]> = [['normal', 'standard'], ['strong', '−3 · ×2 damage'], ['fast', 'two strikes']];
const BRAWL: Array<[string, string]> = [
  ['punch', 'Punch'], ['kick', 'Kick / knee'], ['sweep', 'Leg sweep'], ['grapple', 'Grapple'],
  ['pin', 'Pin'], ['choke', 'Choke'], ['throw', 'Throw'], ['disarm', 'Disarm']
];

/** What a ranged weapon is called at the table, by the skill that fires it. */
const RANGED_WORDS: Record<string, { tab: string; round: string }> = {
  Crossbow: { tab: 'Crossbow', round: 'bolts' },
  Archery: { tab: 'Bow', round: 'arrows' }
};
const GENERIC_RANGED = { tab: 'Ranged', round: 'rounds' };

/** The part of a registry weapon the ammunition rules look at. */
const ammoShape = (weapon: RegistryEntry): AmmunitionWeapon => ({ effects: weapon.effects });

const wordsFor = (weapon: RegistryEntry | undefined) => RANGED_WORDS[String(weapon?.combatSkill ?? '')] ?? GENERIC_RANGED;

/** The weapons the hero carries, split by how they are used. */
function carried(player: IActor, deps: AttackPanelDeps): { melee: RegistryEntry[]; ranged: RegistryEntry[] } {
  const owned = (player.weapons ?? [])
    .map(id => deps.weapons.get(id))
    .filter((weapon): weapon is RegistryEntry => Boolean(weapon));
  return {
    melee: owned.filter(weapon => weapon.range === 'melee'),
    ranged: owned.filter(weapon => weapon.range !== 'melee')
  };
}

function ui(state: IState): Record<string, unknown> { return state.ui as Record<string, unknown>; }

/** The melee weapon the next strike will use: the one chosen, else the first carried. */
export function meleeChoice(state: IState, deps: AttackPanelDeps): RegistryEntry | undefined {
  const { melee } = carried(state.player, deps);
  return melee.find(weapon => weapon.id === ui(state).weapon) ?? melee[0];
}

/** The ranged weapon the next shot will use: the one chosen, else the first carried. */
export function rangedChoice(state: IState, deps: AttackPanelDeps): RegistryEntry | undefined {
  const { ranged } = carried(state.player, deps);
  return ranged.find(weapon => weapon.id === ui(state).rangedWeapon) ?? ranged[0];
}

/** The ammunition pool the next shot draws from, when the hero carries more than one kind. */
function ammoChoice(state: IState): string | undefined {
  const pools = ammoPools(state.player);
  const wanted = ui(state).ammoType;
  return pools && typeof wanted === 'string' && (pools[wanted] ?? 0) > 0 ? wanted : undefined;
}

const titleCase = (value: string): string => value.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());

function locationGrid(state: IState, deps: AttackPanelDeps, cls: string): string {
  const current = ui(state).called;
  const buttons = LOCATIONS.map(place =>
    `<button class="choice location-choice ${current === place ? 'active' : ''}" data-choice="called" data-value="${place}"><b>${place === 'random' ? 'Random' : deps.esc(titleCase(place))}</b></button>`
  ).join('');
  return `<div class="${cls}">${buttons}</div>`;
}

function meleePane(state: IState, deps: AttackPanelDeps): string {
  const { melee } = carried(state.player, deps);
  const chosen = meleeChoice(state, deps);
  if (!melee.length) {
    return `<section class="attack-section weapon"><div class="section-title"><b>Unarmed</b></div><div class="muted">No melee weapon carried. Fight with the Brawl tab.</div></section>`;
  }
  const weapons = melee.map(weapon =>
    `<button class="choice weapon-choice ${chosen?.id === weapon.id ? 'active' : ''}" data-choice="weapon" data-value="${deps.esc(weapon.id)}"><b>${deps.esc(weapon.short ?? weapon.name)}</b><small>${deps.esc(weapon.damage)}</small></button>`
  ).join('');
  const current = ui(state).attackMode;
  const modes = MODES.map(([mode, note]) =>
    `<button class="choice mode-choice ${current === mode ? 'active' : ''}" data-choice="mode" data-value="${mode}"><b>${mode[0]!.toUpperCase()}${mode.slice(1)}</b><small>${note}</small></button>`
  ).join('');
  const strike = `<button class="btn primary attack-primary" data-choice="melee" ${deps.target && deps.canAct ? '' : 'disabled'}>4 · Strike ${deps.target ? deps.esc(deps.target.name) : ''}</button>`;
  return `<section class="attack-section weapon"><div class="section-title"><b>1 · Weapon</b><small>gold</small></div><div class="compact-choice-grid">${weapons}</div></section>`
    + `<section class="attack-section mode"><div class="section-title"><b>2 · Mode</b><small>red</small></div><div class="compact-choice-grid">${modes}</div></section>`
    + `<section class="attack-section location"><div class="section-title"><b>3 · Location</b><small>blue</small></div>${locationGrid(state, deps, 'compact-location-grid')}</section>`
    + strike;
}

function rangedPane(state: IState, deps: AttackPanelDeps): string {
  const { ranged } = carried(state.player, deps);
  const weapon = rangedChoice(state, deps);
  if (!weapon) {
    return `<section class="attack-section ranged"><div class="section-title"><b>Ranged</b></div><div class="muted">No ranged weapon carried.</div></section>`;
  }
  const words = wordsFor(weapon);
  const choices = ranged.length > 1
    ? `<div class="compact-choice-grid">${ranged.map(entry =>
        `<button class="choice weapon-choice ${entry.id === weapon.id ? 'active' : ''}" data-choice="rangedWeapon" data-value="${deps.esc(entry.id)}"><b>${deps.esc(entry.short ?? entry.name)}</b><small>${deps.esc(entry.damage)}</small></button>`
      ).join('')}</div>`
    : '';

  const pools = ammoPools(state.player);
  const kinds = pools ? Object.keys(pools) : [];
  const picked = ammoChoice(state);
  const ammo = kinds.length > 1
    ? `<div class="compact-choice-grid" style="margin-top:5px">${kinds.map(kind =>
        `<button class="choice ammo-choice ${picked === kind ? 'active' : ''}" data-choice="ammoType" data-value="${deps.esc(kind)}" ${(pools?.[kind] ?? 0) > 0 ? '' : 'disabled'}><b>${deps.esc(titleCase(kind))}</b><small>${pools?.[kind] ?? 0} ${words.round}</small></button>`
      ).join('')}</div>`
    : '';

  const loaded = isLoaded(state.player, ammoShape(weapon));
  const reload = requiresReload(ammoShape(weapon))
    ? `<button class="btn" data-choice="reload" ${deps.canAct ? '' : 'disabled'}>Reload</button>`
    : '';
  const status = `${requiresReload(ammoShape(weapon)) ? `${loaded ? 'loaded' : 'empty'} · ` : ''}${ammoTotal(state.player)} ${words.round}`;
  return `<section class="attack-section ranged"><div class="section-title"><b>${deps.esc(weapon.short ?? weapon.name)}</b><small>violet</small></div>${choices}${ammo}${locationGrid(state, deps, 'compact-location-grid')}`
    + `<div class="button-row" style="margin-top:5px"><button class="btn primary" data-choice="ranged" ${deps.target && deps.canAct ? '' : 'disabled'}>Fire</button>${reload}<span class="muted">${status}</span></div></section>`;
}

function brawlPane(deps: AttackPanelDeps): string {
  const off = deps.target && deps.canAct ? '' : 'disabled';
  const moves = BRAWL.map(([move, label]) => `<button class="choice" data-choice="brawl" data-value="${move}" ${off}><b>${label}</b></button>`).join('');
  return `<section class="attack-section brawl"><div class="section-title"><b>Barehanded & grappling</b><small>green</small></div><div class="compact-choice-grid">${moves}</div></section>`;
}

function bombPane(state: IState, deps: AttackPanelDeps): string {
  const bag = state.player.inventory?.bombs ?? {};
  const bombs = [...deps.alchemy].filter(item => item.kind === 'bomb' && item.id in bag);
  const body = bombs.length
    ? `<div class="compact-choice-grid">${bombs.map(item => {
        const left = bag[item.id] ?? 0;
        return `<button class="choice" data-choice="bomb" data-value="${deps.esc(item.id)}" ${deps.target && deps.canAct && left > 0 ? '' : 'disabled'} title="${deps.esc(item.desc)}"><b>${deps.esc(item.name)} ×${left}</b></button>`;
      }).join('')}</div>`
    : '<div class="muted">No bombs carried.</div>';
  return `<section class="attack-section bombs"><div class="section-title"><b>Bombs</b><small>orange · target-centered AOE</small></div>${body}</section>`;
}

/** The whole Attack palette, banner included. */
export function renderAttackPalette(state: IState, deps: AttackPanelDeps): string {
  const pane = String(ui(state).attackPane || 'melee');
  const tabs = PANES.map(([id, label]) => {
    const text = id === 'ranged' ? wordsFor(rangedChoice(state, deps)).tab : label;
    return `<button class="btn ${pane === id ? 'active' : ''}" data-choice="attackPane" data-value="${id}">${text}</button>`;
  }).join('');
  const content = pane === 'melee' ? meleePane(state, deps)
    : pane === 'ranged' ? rangedPane(state, deps)
    : pane === 'brawl' ? brawlPane(deps)
    : bombPane(state, deps);
  const against = deps.target ? ` — ${deps.esc(deps.target.name)}` : '';
  return `${deps.lock}<div class="attack-ui"><h3>Attack${against}</h3><div class="attack-kind-tabs">${tabs}</div>${content}</div>`;
}

const DISPLAY_CHOICES: Record<string, string> = {
  attackPane: 'attackPane',
  weapon: 'weapon',
  rangedWeapon: 'rangedWeapon',
  ammoType: 'ammoType',
  mode: 'attackMode',
  called: 'called'
};

/**
 * Records a display choice. Returns true when the click belonged to this palette, so the caller
 * can stop looking for another owner.
 */
export function handleAttackChoice(
  kind: string,
  value: string,
  store: { update(mutator: (draft: IState) => void): unknown }
): boolean {
  const field = DISPLAY_CHOICES[kind];
  if (!field) return false;
  store.update(draft => {
    ui(draft)[field] = value;
    // The melee choice is also the weapon in hand, which the rest of the game reads.
    if (kind === 'weapon') draft.player.selectedWeapon = value;
  });
  return true;
}

/** The request a click on an attack control makes, or null when the control is not an attack. */
export function attackRequest(
  kind: string,
  state: IState,
  value: string | undefined,
  deps: Pick<AttackPanelDeps, 'weapons'>
): AttackRequest | null {
  const actorId = state.player.id;
  const targetId = state.selectedEnemyId;
  const view = ui(state);
  const lookup = { ...deps, esc: String, alchemy: [], lock: '', target: undefined, canAct: false } as AttackPanelDeps;

  if (kind === 'melee') {
    const weapon = meleeChoice(state, lookup);
    return weapon ? ['melee', { actorId, targetId, weaponId: weapon.id, mode: view.attackMode, called: view.called }] : null;
  }
  if (kind === 'ranged') {
    const weapon = rangedChoice(state, lookup);
    const ammoType = ammoChoice(state);
    return weapon ? ['ranged', { actorId, targetId, weaponId: weapon.id, ...(ammoType ? { ammoType } : {}), mode: 'normal', called: view.called }] : null;
  }
  if (kind === 'reload') {
    const weapon = rangedChoice(state, lookup);
    return weapon ? ['reload', { actorId, weaponId: weapon.id }] : null;
  }
  if (kind === 'brawl') return ['barehanded', { actorId, targetId, move: value, mode: view.attackMode }];
  if (kind === 'bomb') return ['bomb', { actorId, targetId, itemId: value }];
  return null;
}
