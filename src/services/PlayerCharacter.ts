import type { IActor, IPosition, IState, RegistryEntry } from '../entities/types';
import {
  buildHero,
  callingLabel,
  catalogueFrom,
  quickBuild,
  type BuildResult,
  type Catalogue,
  type CatalogueSource,
  type HeroDraft,
  type HeroSheet
} from './CharacterBuilder';

/**
 * The playable hero: turning a finished character sheet into a combat actor, and remembering which
 * hero is in the player's seat.
 *
 * `CharacterBuilder` decides what a legal hero is; this module only translates. `actorFromSheet`
 * is a pure function, and `HeroRoster` is the single place that knows who is playing, so a new
 * battle, a reset, and the setup screen all seat the same hero without any of them naming one.
 */

/** Actor id of every hero the creator makes. Premade veterans carry their own id. */
export const HERO_ID = 'hero';

/** Where the hero stands when a battle starts. */
const START: IPosition = { x: 4, y: 8 };

/** The inventory bag each kind of consumable is carried in. */
const BAGS = { potion: 'potions', decoction: 'decoctions', bomb: 'bombs', oil: 'oils' } as const;

type Pronouns = Record<string, string>;

/** Toxicity a body can carry before it is poisoned. A hero's own limit; veterans may differ. */
const BASE_MAX_TOXICITY = 100;

/**
 * Builds the combat actor for a finished sheet.
 *
 * Every skill is stored as a whole check value (stat plus level) and untrained skills are included,
 * because the combat rules read a missing skill as a flat 10 rather than as the bare stat.
 */
export function actorFromSheet(sheet: HeroSheet, pronouns: Pronouns, id: string = HERO_ID): IActor {
  const skills = Object.fromEntries(sheet.skills.map(line => [line.name, line.check]));
  const check = (name: string): number => skills[name] ?? 10;

  const weapons = sheet.weapons.map(weapon => weapon.id);
  const drawn = (sheet.weapons.find(weapon => weapon.range === 'melee') ?? sheet.weapons[0])?.id;

  const inventory: Record<string, Record<string, number>> = { potions: {}, decoctions: {}, bombs: {}, oils: {} };
  for (const item of sheet.fieldKit) {
    const bag = inventory[BAGS[item.kind]];
    if (bag) bag[item.id] = item.count;
  }

  const hit = sheet.derived;
  return {
    id,
    name: sheet.name,
    baseName: sheet.name,
    family: sheet.race.family,
    gender: sheet.gender,
    age: sheet.age,
    ageBand: sheet.ageBand,
    team: 'player',
    control: 'PLAYER',
    anatomyId: 'humanoid',
    personalityProfile: sheet.temperament,
    combatDoctrines: sheet.profession.id === 'witcher' ? ['witcher'] : [],
    objective: { id: 'eliminate' },
    identity: {
      gender: sheet.gender,
      age: sheet.age,
      region: sheet.region,
      pronouns: { ...pronouns },
      race: sheet.race.name,
      profession: sheet.profession.name
    },
    appearance: {
      height: sheet.appearance.height,
      build: sheet.appearance.build,
      heritage: sheet.race.name,
      skin: sheet.appearance.skin,
      hair: sheet.appearance.hair,
      eyes: sheet.appearance.eyes,
      notable: [...sheet.appearance.notable]
    },
    stats: { ...sheet.stats, STUN: hit.stun },
    skills,
    hp: hit.hp,
    maxHp: hit.hp,
    sta: hit.sta,
    maxSta: hit.sta,
    rec: hit.rec,
    vigor: hit.vigor,
    toxicity: 0,
    maxToxicity: BASE_MAX_TOXICITY,
    naturalSp: hit.naturalSp,
    knownSigns: [...sheet.knownSigns],
    armorByLocation: { ...sheet.armorByLocation },
    armorMaxByLocation: { ...sheet.armorByLocation },
    defenses: {
      dodge: check('Dodge / Escape'),
      reposition: check('Dodge / Escape'),
      block: check('Melee'),
      magic: check('Resist Magic')
    },
    statuses: {},
    criticals: [],
    disabledLocations: {},
    death: null,
    dead: false,
    pos: { ...START },
    quenBlocks: 0,
    activeShield: null,
    activeSigns: {},
    weapons,
    tools: [],
    ...(drawn ? { selectedWeapon: drawn } : {}),
    crossbowLoaded: true,
    ammo: sheet.ammo > 0 ? { standard: sheet.ammo } : {},
    inventory,
    activeAlchemy: {},
    morale: { state: 'steady', fear: 0 },
    history: [],
    resistances: [],
    immunities: [],
    vulnerabilities: [],
    ai: null
  };
}

// --- roster ------------------------------------------------------------------------------------

/** The registry tables the roster reads on top of the builder's catalogue. */
export interface RosterSource extends CatalogueSource {
  heroPresets: Map<string, RegistryEntry>;
}

export interface RosterDeps {
  registry: RosterSource;
  /** The narration pronoun set for a gender. */
  pronouns(gender: string): Pronouns;
}

/** A premade hero as the setup screen lists it. */
export interface PresetCard {
  id: string;
  name: string;
  summary: string;
  /** A veteran is hand-built beyond creation limits; a fresh hero is a creator build. */
  kind: 'veteran' | 'fresh';
  /** Short descriptor such as "Elf Man-at-arms". */
  label: string;
}

/** Who is in the player's seat. */
export type HeroChoice =
  | { kind: 'preset'; id: string }
  | { kind: 'custom'; draft: HeroDraft };

/**
 * Holds the chosen hero and builds a fresh actor for it on demand.
 *
 * The roster lives outside the combat store on purpose: `Store.reset()` and every new battle ask
 * it for a hero, so the choice survives both without being copied into saved state.
 */
export class HeroRoster {
  readonly #deps: RosterDeps;
  #choice: HeroChoice;

  constructor(deps: RosterDeps) {
    this.#deps = deps;
    this.#choice = { kind: 'preset', id: this.#defaultPreset().id };
  }

  /** The registry's catalogue, read fresh so content registered later is seen. */
  catalogue(): Catalogue {
    return catalogueFrom(this.#deps.registry);
  }

  /** Costs a draft without choosing it. Pure; used by the creator's live preview. */
  preview(input: Partial<HeroDraft> | undefined): BuildResult {
    return buildHero(input, this.catalogue());
  }

  /** The premade heroes, default first. */
  presets(): PresetCard[] {
    const rows = [...this.#deps.registry.heroPresets.values()];
    rows.sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)));
    return rows.map(row => this.#card(row));
  }

  /** The current choice, for display. */
  current(): { kind: 'preset' | 'custom'; id: string | null; name: string } {
    if (this.#choice.kind === 'custom') return { kind: 'custom', id: null, name: this.#choice.draft.name };
    const row = this.#preset(this.#choice.id);
    return { kind: 'preset', id: this.#choice.id, name: String(row?.name ?? this.#choice.id) };
  }

  /** A copy of the draft behind the hero in the seat, or null for a veteran, which has none. */
  draft(): HeroDraft | null {
    if (this.#choice.kind === 'custom') return structuredClone(this.#choice.draft);
    return this.presetDraft(this.#choice.id);
  }

  /** The draft behind a premade creator build, so it can be opened in the creator. Null for veterans. */
  presetDraft(id: string): HeroDraft | null {
    const row = this.#preset(id);
    if (!row || !isRecord(row.draft)) return null;
    return quickBuild(row.draft as Partial<HeroDraft>, this.catalogue());
  }

  /** Chooses a premade hero. Returns false for an unknown id. */
  choose(id: string): boolean {
    if (!this.#preset(id)) return false;
    this.#choice = { kind: 'preset', id };
    return true;
  }

  /**
   * Chooses a hero from the creator. The draft is rebuilt here rather than trusted, and a hero with
   * errors is refused: the returned result carries the issues either way.
   */
  use(input: Partial<HeroDraft> | undefined): BuildResult {
    const result = this.preview(input);
    if (result.ok) this.#choice = { kind: 'custom', draft: result.draft };
    return result;
  }

  /** A fresh actor for the chosen hero. Every call returns a new object. */
  create(): IActor {
    if (this.#choice.kind === 'custom') return this.#actorFor(this.#choice.draft);
    const row = this.#preset(this.#choice.id) ?? this.#defaultPreset();
    if (isRecord(row.actor)) return this.#veteran(row.actor);
    return this.#actorFor(this.presetDraft(row.id) ?? quickBuild(undefined, this.catalogue()));
  }

  /**
   * Puts the chosen hero in the player's seat when no battle is running, so the setup screen shows
   * who will fight. Returns false (and changes nothing) while a battle is in progress.
   */
  seat(draft: IState): boolean {
    if (draft.phase === 'combat') return false;
    const hero = this.create();
    draft.player = hero;
    draft.ui.weapon = hero.selectedWeapon ?? '';
    draft.ui.attackPane = 'melee';
    return true;
  }

  #actorFor(input: Partial<HeroDraft>): IActor {
    const built = buildHero(input, this.catalogue());
    return actorFromSheet(built.sheet, this.#deps.pronouns(built.sheet.gender));
  }

  /** Expands a hand-authored veteran template into a fresh actor. */
  #veteran(template: Record<string, unknown>): IActor {
    const { inventoryAll, ...actor } = structuredClone(template) as Record<string, unknown> & {
      inventoryAll?: Record<string, number>;
    };
    if (inventoryAll) {
      const stocked: Record<string, Record<string, number>> = {};
      for (const [kind, bag] of Object.entries(BAGS)) {
        stocked[bag] = {};
        for (const item of this.#deps.registry.alchemy.values()) {
          if (item.kind === kind) stocked[bag][item.id] = inventoryAll[bag] ?? 0;
        }
      }
      actor.inventory = stocked;
    }
    return actor as unknown as IActor;
  }

  #card(row: RegistryEntry): PresetCard {
    const fresh = isRecord(row.draft);
    let label = String(row.label ?? '');
    if (!label && fresh) {
      const sheet = buildHero(this.presetDraft(row.id) ?? undefined, this.catalogue()).sheet;
      label = callingLabel(sheet);
    }
    return { id: row.id, name: String(row.name), summary: String(row.summary ?? ''), kind: fresh ? 'fresh' : 'veteran', label };
  }

  #preset(id: string): RegistryEntry | undefined {
    return this.#deps.registry.heroPresets.get(id);
  }

  #defaultPreset(): RegistryEntry {
    const rows = [...this.#deps.registry.heroPresets.values()];
    const row = rows.find(candidate => candidate.default) ?? rows[0];
    if (!row) throw new Error('No premade hero is registered.');
    return row;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
