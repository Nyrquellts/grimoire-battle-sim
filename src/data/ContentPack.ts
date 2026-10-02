import { z } from 'zod';
import type { RegistryHub } from './RegistryHub';

/**
 * Content packs: the supported way to add characters, scenarios, and Sign augments.
 *
 * A pack is plain data. It is validated at the boundary with Zod before anything reaches the
 * registry, so a hand-written or pasted pack can never put a malformed row in front of the rules.
 * Packs are the answer to "I want to add my own characters and scenarios" without editing engine
 * code: drop a file in `src/data/packs/`, or paste one into the Forge and load it for the session.
 *
 * This is deliberately **not** a save system. Nothing here writes to disk or to browser storage —
 * a pack is authored, exported as text, and loaded. See `CONTRIBUTING.md`.
 */

/** The nine Witcher statistics plus LUCK, all optional so a partial sheet still validates. */
const StatsSchema = z.object({
  INT: z.number().int().min(1).max(20).optional(),
  REF: z.number().int().min(1).max(20).optional(),
  DEX: z.number().int().min(1).max(20).optional(),
  BODY: z.number().int().min(1).max(20).optional(),
  SPD: z.number().int().min(1).max(20).optional(),
  EMP: z.number().int().min(1).max(20).optional(),
  CRA: z.number().int().min(1).max(20).optional(),
  WILL: z.number().int().min(1).max(20).optional(),
  STUN: z.number().int().min(1).max(20).optional(),
  LUCK: z.number().int().min(0).max(20).optional()
}).strict();

/** Skill values as they appear on a character sheet. */
const SkillsSchema = z.record(z.string().min(1), z.number().int().min(0).max(30));

/** Per-location armour stopping power. */
const ArmorSchema = z.record(z.string().min(1), z.number().int().min(0).max(60));

const PronounsSchema = z.object({
  subject: z.string().min(1),
  object: z.string().min(1),
  possessiveAdjective: z.string().min(1),
  possessivePronoun: z.string().min(1),
  reflexive: z.string().min(1)
});

/**
 * A playable or spawnable character.
 *
 * The shape matches what `CharacterRegistryService.spawn` reads, so an authored character is a
 * first-class combatant rather than a reskin of a bestiary row.
 */
export const CharacterSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/i, 'Character ids are alphanumeric with dashes.'),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  /** Provenance. `custom` is the honest status for anything the owner invented. */
  source: z.object({
    status: z.enum(['project', 'custom', 'incomplete']).default('custom'),
    origin: z.string().default('Custom content pack')
  }).default({ status: 'custom', origin: 'Custom content pack' }),
  identity: z.object({
    gender: z.string().nullable().default(null),
    age: z.number().int().min(0).max(2000).nullable().default(null),
    region: z.string().nullable().default(null),
    pronouns: PronounsSchema.optional()
  }),
  /** Species/family, e.g. `Human`, `Elf`, `Vampire`. Drives anatomy and hit locations. */
  raceSpecies: z.string().min(1).default('Human'),
  faction: z.string().nullable().default(null),
  appearance: z.record(z.string(), z.unknown()).optional(),
  biography: z.string().optional(),
  stats: StatsSchema.default({}),
  skills: SkillsSchema.default({}),
  derived: z.object({
    maxHp: z.number().int().min(1).max(500),
    maxSta: z.number().int().min(1).max(500),
    rec: z.number().int().min(1).max(60),
    vigor: z.number().int().min(0).max(20).default(0)
  }),
  equipment: z.object({
    weapons: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    focusItems: z.array(z.string()).default([]),
    armorMaxByLocation: ArmorSchema.default({})
  }).default({ weapons: [], tools: [], focusItems: [], armorMaxByLocation: {} }),
  combat: z.object({
    doctrines: z.array(z.string()).default([]),
    personalityProfile: z.string().default('disciplined'),
    aiProfileId: z.string().nullable().default(null),
    cognitionId: z.string().nullable().default(null)
  }).default({ doctrines: [], personalityProfile: 'disciplined', aiProfileId: null, cognitionId: null }),
  complete: z.boolean().default(true)
});

/** One group of opponents in a scenario's opening lineup. */
export const LineupEntrySchema = z.object({
  foe: z.string().min(1),
  quantity: z.number().int().min(1).max(20).default(1),
  region: z.string().default('random'),
  subtype: z.string().default('random'),
  variant: z.string().default('random'),
  experience: z.string().default('random'),
  loadout: z.string().default('random')
});

/** A persistent hazard the scenario starts with already on the field. */
export const ScenarioZoneSchema = z.object({
  type: z.string().min(1),
  x: z.number().int().min(0).max(23),
  y: z.number().int().min(0).max(15),
  radius: z.number().min(0).max(12).default(2),
  duration: z.number().int().min(1).max(99).default(5),
  power: z.number().int().min(0).max(10).optional()
});

/**
 * A named encounter set piece.
 *
 * A scenario is the thing you actually want to replay: an opposition, a battlefield, and enough
 * framing text to roleplay from. It carries no rules of its own — it only chooses inputs the
 * encounter system already accepts.
 */
export const ScenarioSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/i, 'Scenario ids are alphanumeric with dashes.'),
  name: z.string().min(1),
  /** One line for the picker. */
  summary: z.string().default(''),
  /** The read-aloud framing. This is the roleplay hook, shown when the scenario starts. */
  briefing: z.string().default(''),
  /** Battlefield preset id, e.g. `open`, `woods`, `ruins`, `night`. */
  situation: z.string().default('open'),
  lineup: z.array(LineupEntrySchema).min(1),
  /** Optional overrides for the player character at the start of the scenario. */
  player: z.object({
    characterId: z.string().optional(),
    focusId: z.string().nullable().default(null),
    position: z.object({ x: z.number().int().min(0).max(23), y: z.number().int().min(0).max(15) }).optional()
  }).optional(),
  zones: z.array(ScenarioZoneSchema).default([]),
  tags: z.array(z.string()).default([]),
  source: z.object({
    status: z.enum(['project', 'custom', 'incomplete']).default('custom'),
    origin: z.string().default('Custom content pack')
  }).default({ status: 'custom', origin: 'Custom content pack' })
});

/**
 * A custom Sign augment.
 *
 * Authored augments are held to the same declaration the built-in ones are: a cost, a scope, and
 * declarative effects. They cannot introduce behavior, only numbers the resolver already reads —
 * which is what stops "mix your own magic" from turning into "write your own rules".
 */
export const AugmentPackSchema = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z0-9-]*$/, 'Augment ids are alphanumeric with dashes.'),
  name: z.string().min(1),
  description: z.string().min(1),
  staCost: z.number().int().min(0).max(7),
  exclusiveGroup: z.string().optional(),
  appliesTo: z.object({
    families: z.array(z.string()).optional(),
    elements: z.array(z.string()).optional(),
    shapes: z.array(z.string()).optional(),
    ids: z.array(z.string()).optional()
  }).optional(),
  requires: z.object({
    minSkill: z.number().int().min(0).max(30).optional(),
    casterZone: z.string().optional(),
    targetZone: z.string().optional(),
    targetCondition: z.string().optional(),
    focus: z.boolean().optional()
  }).optional(),
  effects: z.object({
    castBonus: z.number().int().min(-5).max(5).optional(),
    damageDicePerSta: z.number().int().min(0).max(2).optional(),
    bonusDamage: z.array(z.string().regex(/^\d+d\d+([+-]\d+)?$/, 'Use dice notation such as 2d6.')).optional(),
    ignitionChance: z.number().int().min(-100).max(75).optional(),
    knockdownChance: z.number().int().min(-100).max(75).optional(),
    radiusDelta: z.number().int().min(-4).max(4).optional(),
    rangeDelta: z.number().int().min(-4).max(6).optional(),
    durationDelta: z.number().int().min(-4).max(6).optional(),
    extraTargets: z.number().int().min(0).max(4).optional(),
    armorPiercing: z.boolean().optional(),
    applies: z.array(z.object({ condition: z.string().min(1), duration: z.number().int().min(1).max(20).optional() })).optional(),
    tags: z.array(z.string()).optional()
  }),
  /** Authored augments are house rules by definition; the field is kept explicit, not inferred. */
  ruleStatus: z.enum(['house', 'original']).default('house')
});

/** A whole pack. Every section is optional so a pack can add just one thing. */
export const ContentPackSchema = z.object({
  /** Pack format version, so a future change can migrate rather than silently misread. */
  formatVersion: z.literal(1).default(1),
  name: z.string().min(1).default('Untitled pack'),
  author: z.string().default(''),
  notes: z.string().default(''),
  characters: z.array(CharacterSchema).default([]),
  scenarios: z.array(ScenarioSchema).default([]),
  signAugments: z.array(AugmentPackSchema).default([])
});

export type ContentPack = z.infer<typeof ContentPackSchema>;
export type ScenarioDefinition = z.infer<typeof ScenarioSchema>;
export type CharacterDefinition = z.infer<typeof CharacterSchema>;

/** What a load attempt produced. Partial success is reported, never silently swallowed. */
export interface PackLoadResult {
  ok: boolean;
  /** Ids added, by kind. */
  added: { characters: string[]; scenarios: string[]; signAugments: string[] };
  /** Ids skipped because that id was already registered. */
  skipped: string[];
  /** Human-readable problems. A non-empty list with `ok: true` means "loaded, with warnings". */
  errors: string[];
  pack?: ContentPack;
}

/** Parses untrusted pack text or data, returning either the pack or readable errors. */
export function parseContentPack(input: unknown): { ok: true; pack: ContentPack } | { ok: false; errors: string[] } {
  const source = typeof input === 'string' ? safeJson(input) : { ok: true as const, value: input };
  if (!source.ok) return { ok: false, errors: [source.error] };

  const parsed = ContentPackSchema.safeParse(source.value);
  if (parsed.success) return { ok: true, pack: parsed.data };
  return { ok: false, errors: parsed.error.issues.map(issue => `${issue.path.join('.') || 'pack'}: ${issue.message}`) };
}

/**
 * Registers a validated pack.
 *
 * Registration is additive and non-destructive: an id that already exists is skipped and reported
 * rather than overwritten, because silently replacing a built-in creature or a built-in augment
 * with a custom one is exactly the kind of drift `docs/CONTENT_POLICY.md` exists to prevent.
 */
export function loadContentPack(registry: RegistryHub, input: unknown): PackLoadResult {
  const result: PackLoadResult = {
    ok: false,
    added: { characters: [], scenarios: [], signAugments: [] },
    skipped: [],
    errors: []
  };

  const parsed = parseContentPack(input);
  if (!parsed.ok) { result.errors = parsed.errors; return result; }
  const pack = parsed.pack;
  result.pack = pack;

  for (const character of pack.characters) {
    if (registry.characters.has(character.id)) { result.skipped.push(`character:${character.id}`); continue; }
    try {
      registry.add('characters', character.id, character);
      result.added.characters.push(character.id);
    } catch (cause) { result.errors.push(`character:${character.id} — ${message(cause)}`); }
  }

  for (const scenario of pack.scenarios) {
    if (registry.scenarios.has(scenario.id)) { result.skipped.push(`scenario:${scenario.id}`); continue; }
    try {
      registry.add('scenarios', scenario.id, scenario);
      result.added.scenarios.push(scenario.id);
    } catch (cause) { result.errors.push(`scenario:${scenario.id} — ${message(cause)}`); }
  }

  for (const augment of pack.signAugments) {
    if (registry.signAugments.has(augment.id)) { result.skipped.push(`augment:${augment.id}`); continue; }
    try {
      registry.add('signAugments', augment.id, augment);
      result.added.signAugments.push(augment.id);
    } catch (cause) { result.errors.push(`augment:${augment.id} — ${message(cause)}`); }
  }

  result.ok = result.errors.length === 0;
  return result;
}

/** Serialises registered custom content back out as a pack, for sharing or pasting into a file. */
export function exportContentPack(
  registry: RegistryHub,
  selection: { characters?: readonly string[]; scenarios?: readonly string[]; signAugments?: readonly string[] },
  meta: { name?: string; author?: string; notes?: string } = {}
): ContentPack {
  const pick = <T>(table: Map<string, T>, ids: readonly string[] | undefined): T[] =>
    (ids ?? []).map(id => table.get(id)).filter((row): row is T => Boolean(row));

  return ContentPackSchema.parse({
    formatVersion: 1,
    name: meta.name ?? 'Exported pack',
    author: meta.author ?? '',
    notes: meta.notes ?? '',
    characters: pick(registry.characters, selection.characters),
    scenarios: pick(registry.scenarios, selection.scenarios),
    signAugments: pick(registry.signAugments, selection.signAugments)
  });
}

function safeJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (cause) { return { ok: false, error: `Not valid JSON — ${message(cause)}` }; }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
