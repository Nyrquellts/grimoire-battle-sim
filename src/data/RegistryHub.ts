import { clone, invariant } from '../core/utils';
import type { RegistryEntry } from '../entities/types';

/**
 * Legacy content hub: one `Map` per registry kind, each row validated on insertion.
 *
 * This is transitional. Phase 6 of the migration folds these tables onto the generic
 * `Registry<T>` in `./Registry.ts` with per-kind schemas, after which this class is deleted.
 * Until then it lives here rather than inside the simulation bridge so content storage and
 * simulation rules are at least in different files.
 */

/** Per-kind validators. A missing entry means that kind accepts any shape. */
export type RegistrySchemaTable = Record<string, ((entry: RegistryEntry) => void) | undefined>;

export const RegistrySchemas = Object.freeze({
  weapons(entry: RegistryEntry): void {
    invariant(entry.name, `Weapon ${entry.id} needs a name.`);
    invariant(typeof entry.damage === 'string', `Weapon ${entry.id} needs damage notation.`);
    invariant(entry.range === 'melee' || Number.isFinite(Number(entry.range)), `Weapon ${entry.id} has invalid range.`);
  },

  bestiary(entry: RegistryEntry): void {
    invariant(entry.name && entry.family, `Bestiary ${entry.id} needs name and family.`);
    invariant(Number.isFinite(Number(entry.hp ?? entry.maxHp)), `Bestiary ${entry.id} needs HP.`);
    invariant(Array.isArray(entry.attacks), `Bestiary ${entry.id} attacks must be an array.`);
  },

  signs(entry: RegistryEntry): void {
    invariant(entry.name && entry.family, `Sign ${entry.id} needs name and family.`);
    invariant(Number.isFinite(Number(entry.maxCost)), `Sign ${entry.id} needs maxCost.`);
  },

  alchemy(entry: RegistryEntry): void {
    invariant(entry.name && entry.kind, `Alchemy ${entry.id} needs name and kind.`);
  },

  conditions(entry: RegistryEntry): void {
    invariant(entry.name && entry.description, `Condition ${entry.id} needs name and description.`);
  },

  criticalWounds(entry: RegistryEntry): void {
    invariant(entry.name && entry.tier, `Critical wound ${entry.id} needs name and tier.`);
  },

  terrain(entry: RegistryEntry): void {
    invariant(entry.name && entry.cssClass, `Terrain ${entry.id} needs a name and a cssClass.`);
    invariant(Number.isFinite(Number(entry.moveCost)) && Number(entry.moveCost) > 0, `Terrain ${entry.id} needs a positive move cost.`);
    invariant(Number.isFinite(Number(entry.coverSp)) && Number(entry.coverSp) >= 0, `Terrain ${entry.id} needs a cover value.`);
    invariant(typeof entry.blocksMove === 'boolean' && typeof entry.blocksLos === 'boolean', `Terrain ${entry.id} must declare what it blocks.`);
  },

  spells(entry: RegistryEntry): void {
    invariant(entry.name && Number.isFinite(Number(entry.cost)), `Spell ${entry.id} needs name and STA cost.`);
  },

  signAugments(entry: RegistryEntry): void {
    invariant(entry.name && entry.description, `Sign augment ${entry.id} needs a name and description.`);
    invariant(Number.isFinite(Number(entry.staCost)) && Number(entry.staCost) >= 0, `Sign augment ${entry.id} needs a non-negative STA cost.`);
    invariant(entry.effects && typeof entry.effects === 'object', `Sign augment ${entry.id} needs declarative effects.`);
    invariant(['standard','adapted','house','original'].includes(entry.ruleStatus), `Sign augment ${entry.id} must declare a rule status.`);
  },

  creatureAbilities(entry: RegistryEntry): void {
    invariant(entry.name && entry.description, `Creature ability ${entry.id} needs a name and description.`);
    invariant(typeof entry.kind === 'string' && entry.kind, `Creature ability ${entry.id} needs a kind.`);
    invariant(['standard','adapted','house','original'].includes(entry.ruleStatus), `Creature ability ${entry.id} must declare a rule status.`);
  },

  magicFumbles(entry: RegistryEntry): void {
    invariant(entry.name && entry.description, `Magic fumble ${entry.id} needs a name and description.`);
  },

  scenarios(entry: RegistryEntry): void {
    invariant(entry.name && Array.isArray(entry.lineup) && entry.lineup.length, `Scenario ${entry.id} needs a name and at least one lineup entry.`);
    invariant(typeof entry.situation === 'string' && entry.situation.length, `Scenario ${entry.id} needs a battlefield.`);
  },

  focusItems(entry: RegistryEntry): void {
    invariant(entry.name, `Focus item ${entry.id} needs a name.`);
    invariant(Number.isFinite(Number(entry.value)) && Number(entry.value) >= 1, `Focus item ${entry.id} needs a focus value of at least 1.`);
  },

  voiceSets(entry: RegistryEntry): void {
    invariant(entry.name && entry.lines && typeof entry.lines === 'object', `Voice set ${entry.id} needs a name and line pools.`);
  },

  lootTables(entry: RegistryEntry): void {
    invariant(entry.name && entry.kind, `Loot table ${entry.id} needs a name and kind.`);
  },

  dragonBreaths(entry: RegistryEntry): void {
    invariant(entry.name && entry.damage && Number.isFinite(Number(entry.cooldown)), `Dragon breath ${entry.id} is incomplete.`);
  },

  defeatProfiles(entry: RegistryEntry): void {
    invariant(entry.name && Array.isArray(entry.outcomes), `Defeat profile ${entry.id} needs outcomes.`);
  },

  tools(entry: RegistryEntry): void {
    invariant(entry.name && Number.isFinite(Number(entry.harvestBonus ?? 0)), `Tool ${entry.id} needs a name and harvest bonus.`);
  },

  harvestTables(entry: RegistryEntry): void {
    invariant(entry.name && Array.isArray(entry.parts), `Harvest table ${entry.id} needs a name and parts.`);
    for (const part of entry.parts) {
      invariant(part?.name && part?.quantity, `Harvest table ${entry.id} has an incomplete loot entry.`);
      invariant(['harvest','personal','valuables'].includes(part.channel || 'harvest'), `Harvest table ${entry.id} has an invalid loot channel.`);
    }
  },

  zones(entry: RegistryEntry): void {
    invariant(entry.name && entry.cssClass && entry.glyph, `Zone ${entry.id} needs name, cssClass, and glyph.`);
    if (entry.threat !== undefined) {
      invariant(Number.isFinite(Number(entry.threat.risk)), `Zone ${entry.id} threat needs a numeric risk.`);
      for (const field of ['threatens', 'susceptibleTo'] as const) {
        invariant(entry.threat[field] === undefined || Array.isArray(entry.threat[field]),
          `Zone ${entry.id} threat.${field} must be a list.`);
      }
    }
  },

  characters(entry: RegistryEntry): void {
    invariant(entry.name && entry.identity && entry.source, `Character ${entry.id} needs name, identity, and source metadata.`);
    invariant(['project','custom','incomplete'].includes(entry.source.status), `Character ${entry.id} has invalid source status.`);
  },

  anatomies(entry: RegistryEntry): void {
    invariant(entry.name && entry.locations && typeof entry.locations === 'object', `Anatomy ${entry.id} needs named locations.`);
  },

  objectives(entry: RegistryEntry): void {
    invariant(entry.name && entry.kind, `Objective ${entry.id} needs name and kind.`);
  },

  combatDoctrines(entry: RegistryEntry): void {
    invariant(entry.name && entry.weights && typeof entry.weights === 'object', `Doctrine ${entry.id} needs utility weights.`);
  },

  personalityProfiles(entry: RegistryEntry): void {
    invariant(entry.name && Number.isFinite(Number(entry.discipline)), `Personality ${entry.id} needs a discipline value.`);
  },

  battlefieldObjects(entry: RegistryEntry): void {
    invariant(entry.name && typeof entry.blocksMove === 'boolean' && typeof entry.blocksLos === 'boolean', `Battlefield object ${entry.id} is incomplete.`);
  },

  voiceProfiles(entry: RegistryEntry): void {
    invariant(entry.name && typeof entry.painRestraint === 'number', `Voice profile ${entry.id} needs pain restraint.`);
  },

  aiCognition(entry: RegistryEntry): void {
    invariant(entry.name && Number.isInteger(entry.tier) && entry.tier >= 0 && entry.tier <= 5, `AI cognition ${entry.id} needs tier 0-5.`);
    invariant(Number.isFinite(Number(entry.planningDepth)) && Number.isFinite(Number(entry.coordination)), `AI cognition ${entry.id} needs planning/coordination values.`);
  },

  aiProfiles(entry: RegistryEntry): void {
    invariant(entry.name && entry.cognitionId && Array.isArray(entry.doctrines) && Array.isArray(entry.tags), `AI profile ${entry.id} is incomplete.`);
    invariant(entry.weights && typeof entry.weights === 'object', `AI profile ${entry.id} needs utility weights.`);
  },

  actorArchetypes(entry: RegistryEntry): void {
    invariant(entry.name && entry.family && Array.isArray(entry.variants), `Actor archetype ${entry.id} is incomplete.`);
  },

  loadoutPools(entry: RegistryEntry): void {
    invariant(entry.name && entry.roles && typeof entry.roles === 'object', `Loadout pool ${entry.id} needs role tables.`);
  },

  mountProfiles(entry: RegistryEntry): void {
    invariant(entry.name && entry.stats && Number.isFinite(Number(entry.hp)), `Mount profile ${entry.id} is incomplete.`);
  },

  battlefieldPresets(entry: RegistryEntry): void {
    invariant(entry.name && entry.kind, `Battlefield ${entry.id} needs a name and a kind.`);
    invariant(typeof entry.base === 'string' && entry.base, `Battlefield ${entry.id} needs a base terrain.`);
    invariant(Array.isArray(entry.features), `Battlefield ${entry.id} needs a feature list.`);
    for (const feature of entry.features) invariant(feature?.type, `Battlefield ${entry.id} has a feature with no type.`);
  },

  hoardTables(entry: RegistryEntry): void {
    invariant(entry.name && Array.isArray(entry.themes), `Hoard table ${entry.id} needs themes.`);
  },

  lifepathPacks(entry: RegistryEntry): void {
    invariant(entry.name && entry.family, `Lifepath pack ${entry.id} is incomplete.`);
  },

  creationSkills(entry: RegistryEntry): void {
    invariant(entry.name && entry.stat, `Creation skill ${entry.id} needs a name and a stat.`);
  },

  races(entry: RegistryEntry): void {
    invariant(entry.name && entry.family && entry.homeLanguage, `Race ${entry.id} is incomplete.`);
    invariant(entry.names && Array.isArray(entry.names.male) && Array.isArray(entry.names.female) && Array.isArray(entry.names.family), `Race ${entry.id} needs name pools.`);
    invariant(Number.isFinite(Number(entry.naturalSp)) && Number(entry.naturalSp) >= 0, `Race ${entry.id} needs a natural SP of zero or more.`);
  },

  professions(entry: RegistryEntry): void {
    invariant(entry.name && entry.defining && Array.isArray(entry.fixed) && Array.isArray(entry.picks), `Profession ${entry.id} is incomplete.`);
    invariant(entry.kit && Array.isArray(entry.kit.items) && Number.isInteger(entry.kit.pick), `Profession ${entry.id} needs a kit.`);
    invariant(Number.isFinite(Number(entry.coin)) && Number(entry.coin) > 0, `Profession ${entry.id} needs a starting coin multiplier.`);
  },

  armorPieces(entry: RegistryEntry): void {
    invariant(entry.name && ['head', 'torso', 'legs'].includes(entry.slot), `Armour ${entry.id} needs a name and a body slot.`);
    invariant(Number.isFinite(Number(entry.sp)) && Number(entry.sp) > 0 && Number.isFinite(Number(entry.cost)), `Armour ${entry.id} needs stopping power and a price.`);
  },

  heroPresets(entry: RegistryEntry): void {
    invariant(entry.name && entry.summary, `Hero preset ${entry.id} needs a name and a summary.`);
    invariant(Boolean(entry.actor) !== Boolean(entry.draft), `Hero preset ${entry.id} needs exactly one of an actor or a draft.`);
  }
});

export class RegistryHub {
  readonly schemas: Record<string, ((entry: RegistryEntry) => void) | undefined>;

  // Content tables, one per registry kind. Rules query these; they never own behavior.
  readonly weapons = new Map<string, RegistryEntry>();
  readonly bestiary = new Map<string, RegistryEntry>();
  readonly signs = new Map<string, RegistryEntry>();
  readonly alchemy = new Map<string, RegistryEntry>();
  readonly conditions = new Map<string, RegistryEntry>();
  readonly criticalWounds = new Map<string, RegistryEntry>();
  readonly terrain = new Map<string, RegistryEntry>();
  readonly spells = new Map<string, RegistryEntry>();
  readonly signAugments = new Map<string, RegistryEntry>();
  readonly magicFumbles = new Map<string, RegistryEntry>();
  readonly focusItems = new Map<string, RegistryEntry>();
  readonly scenarios = new Map<string, RegistryEntry>();
  readonly creatureAbilities = new Map<string, RegistryEntry>();
  readonly voiceSets = new Map<string, RegistryEntry>();
  readonly lootTables = new Map<string, RegistryEntry>();
  readonly dragonBreaths = new Map<string, RegistryEntry>();
  readonly defeatProfiles = new Map<string, RegistryEntry>();
  readonly tools = new Map<string, RegistryEntry>();
  readonly harvestTables = new Map<string, RegistryEntry>();
  readonly zones = new Map<string, RegistryEntry>();
  readonly characters = new Map<string, RegistryEntry>();
  readonly anatomies = new Map<string, RegistryEntry>();
  readonly objectives = new Map<string, RegistryEntry>();
  readonly combatDoctrines = new Map<string, RegistryEntry>();
  readonly personalityProfiles = new Map<string, RegistryEntry>();
  readonly battlefieldObjects = new Map<string, RegistryEntry>();
  readonly voiceProfiles = new Map<string, RegistryEntry>();
  readonly aiCognition = new Map<string, RegistryEntry>();
  readonly aiProfiles = new Map<string, RegistryEntry>();
  readonly actorArchetypes = new Map<string, RegistryEntry>();
  readonly loadoutPools = new Map<string, RegistryEntry>();
  readonly mountProfiles = new Map<string, RegistryEntry>();
  readonly battlefieldPresets = new Map<string, RegistryEntry>();
  readonly hoardTables = new Map<string, RegistryEntry>();
  readonly lifepathPacks = new Map<string, RegistryEntry>();
  readonly creationSkills = new Map<string, RegistryEntry>();
  readonly races = new Map<string, RegistryEntry>();
  readonly professions = new Map<string, RegistryEntry>();
  readonly armorPieces = new Map<string, RegistryEntry>();
  readonly heroPresets = new Map<string, RegistryEntry>();

  constructor(schemas: RegistrySchemaTable) {
    this.schemas = schemas;
  }

  add(kind: string, id: string, data: Record<string, unknown>): RegistryEntry {
    const table = this.table(kind);
    invariant(table instanceof Map, `Unknown registry: ${kind}`);
    invariant(!table.has(id), `Duplicate ${kind} id: ${id}`);

    const entry = { id, ...clone(data) };
    this.schemas[kind]?.(entry);
    table.set(id, Object.freeze(entry));
    return entry;
  }

  get(kind: string, id: string): RegistryEntry | undefined {
    return this.table(kind)?.get(id);
  }

  require(kind: string, id: string): RegistryEntry {
    const entry = this.get(kind, id);
    invariant(entry, `Missing ${kind} entry: ${id}`);
    return entry;
  }

  validateAll(): string[] {
    const errors: string[] = [];
    for (const [kind, schema] of Object.entries(this.schemas)) {
      for (const entry of this.table(kind)?.values() ?? []) {
        try { schema?.(entry); }
        catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          errors.push(`${kind}:${entry.id} — ${message}`);
        }
      }
    }
    return errors;
  }

  /** One content table by kind name, or undefined when the kind is unknown. */
  private table(kind: string): Map<string, RegistryEntry> | undefined {
    const candidate = (this as unknown as Record<string, unknown>)[kind];
    return candidate instanceof Map ? candidate as Map<string, RegistryEntry> : undefined;
  }
}
