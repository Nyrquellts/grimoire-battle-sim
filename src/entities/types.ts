/** Shared structural types for the simulation kernel. */

export enum ActionKind {
  Move = 'move',
  Melee = 'melee',
  Ranged = 'ranged',
  Barehanded = 'barehanded',
  Sign = 'sign',
  Bomb = 'bomb',
  Tool = 'tool',
  Social = 'social',
  EndTurn = 'endTurn',
  EnemyMove = 'enemyMove',
  EnemyMelee = 'enemyMelee',
  EnemyRanged = 'enemyRanged',
  EnemyCast = 'enemyCast',
  EnemyFlee = 'enemyFlee'
}

export enum DamageType {
  Piercing = 'P',
  Slashing = 'S',
  Bludgeoning = 'B',
  Elemental = 'E',
  Unspecified = 'U'
}

export enum EffectType {
  Burning = 'burning',
  Poisoned = 'poisoned',
  Frozen = 'frozen',
  Stunned = 'stunned',
  Prone = 'prone',
  Grappled = 'grappled',
  Dimeritium = 'dimeritium'
}

export enum MoraleState {
  Steady = 'steady',
  Shaken = 'shaken',
  Routing = 'routing',
  Surrendered = 'surrendered',
  Broken = 'broken'
}

export interface IPosition {
  x: number;
  y: number;
}

export interface ITile extends IPosition {
  elevation: number;
  moveCost: number;
  coverSp: number;
  blocksMove: boolean;
  blocksLos: boolean;
  terrainKind?: string;
}

export interface IZone {
  id?: string;
  type: string;
  x: number;
  y: number;
  radius: number;
  /** Rounds remaining. Zones are removed when this reaches zero. */
  duration: number;
  /** Strength, where the zone type uses one (Yrden's movement penalty, for example). */
  power?: number;
  /** What placed it — a Sign, a bomb, or the scenario. */
  source?: string;
  /** Free-form notes from whatever created the zone. Never read by rules. */
  metadata?: Record<string, unknown>;
}

export interface IWeapon {
  id: string;
  name: string;
  type: DamageType | string;
  damage: string;
  range: number | 'melee';
  reach?: number;
  reliability?: number;
  effects?: readonly string[];
}

export interface IMorale {
  state: MoraleState | string;
  fear: number;
  fearImmune?: boolean;
  /** Accumulated combat stress that pushes an actor toward shaken/broken. */
  pressure?: number;
  /** Baseline courage used by morale checks. */
  courage?: number;
  /** 0..1 bias toward yielding instead of routing when morale breaks. */
  surrender?: number;
}

/**
 * One resolved hit location.
 *
 * `penalty` applies to the attack roll for a called shot, `mult` scales damage that gets through
 * armour. `rolled` records the d10 when the location was rolled rather than chosen.
 */
export interface HitLocation {
  id: string;
  name?: string;
  label?: string;
  penalty: number;
  mult: number;
  rolled?: number | null;
  roll?: readonly number[];
  group?: string;
  [field: string]: unknown;
}

/** Recorded critical wound and its healing/treatment state. */
export interface ICriticalWound {
  id: string;
  tier: string;
  name: string;
  location: string;
  state: 'fresh' | 'stabilized' | 'treated' | string;
  fresh: string;
  stabilized: string;
  treated: string;
  fatal: boolean;
  roll: number;
  days: number;
}

/** Death-state bookkeeping for an actor driven below zero Health. */
export interface IDeathState {
  active: boolean;
  savePenalty: number;
  /** Cached AI response so a dying actor keeps one coherent plan for the round. */
  tactics?: { round: number; choice: string } | null;
  [key: string]: unknown;
}

/** Routing/escape progress for an actor trying to leave the battlefield. */
export interface IRetreatState {
  state: 'none' | 'routing' | 'escaped' | string;
  startedRound: number | null;
  exit: IPosition | null;
  lastRoute: IPosition[];
  blocked: number;
  escapedRound: number | null;
  lastPos: IPosition | null;
  [key: string]: unknown;
}

/** Per-actor AI working memory. Reset per encounter; never shared between actors. */
export interface IActorAi {
  experience?: string;
  profileId?: string | null;
  cognitionId?: string | null;
  recent: string[];
  stall: number;
  lastMeaningfulRound: number;
  /** Explainability: the ranked utility scores behind the actor's last decision. */
  scores: Array<{ name: string; score: number; breakdown?: Array<{ label: string; value: number }> }>;
  /** Explainability: candidate actions rejected before scoring, with the reason. */
  rejections: Array<{ name: string; reason: string }>;
  memory: Record<string, unknown>;
  plan: { id: string; label: string; priority: number; since: number } | null;
  planSince?: number;
  targetId?: string | null;
  [key: string]: unknown;
}

export interface IActor {
  id: string;
  name: string;
  baseName?: string;
  family: string;
  team?: string;
  faction?: string;
  control?: string;
  hp: number;
  maxHp: number;
  sta: number;
  maxSta: number;
  dead: boolean;
  fled?: boolean;
  removed?: boolean;
  pos: IPosition;
  statuses: Record<string, unknown>;
  morale: IMorale;
  attacks?: readonly Record<string, unknown>[];
  defenses?: Record<string, number>;
  stats?: Record<string, number>;
  skills?: Record<string, number>;
  ai?: IActorAi | null;

  // --- identity -----------------------------------------------------------
  gender?: string | null;
  age?: number | null;
  ageBand?: string | null;
  identity?: Record<string, unknown> | null;
  history?: string[];
  /** Content id of the bestiary/archetype row this actor was composed from. */
  creatureKey?: string | null;
  /** Marks rules-relevant unique creatures such as `dragon` or `higherVampire`. */
  exceptional?: string | null;

  // --- combat -------------------------------------------------------------
  /** Fallback attack base for actors without per-weapon skills. */
  attack?: number;
  /** Flat defense value for stat-block actors without a per-type `defenses` table. */
  defense?: number;
  /** Flat armour for actors without per-location armour. */
  armor?: number;
  armorByLocation?: Record<string, number> | null;
  armorMaxByLocation?: Record<string, number> | null;
  /** Stopping power the body has on its own: added to worn armour and never ablated. */
  naturalSp?: number;
  /** Stamina recovered by one Recover action. */
  rec?: number;
  regen?: number;
  criticals?: ICriticalWound[];
  disabledLocations?: Record<string, boolean>;
  death?: IDeathState | null;
  retreat?: IRetreatState;
  resistances?: string[];
  immunities?: string[];
  vulnerabilities?: string[];
  abilities?: string[];
  preferredRange?: number;

  // --- equipment ----------------------------------------------------------
  weapons?: string[];
  selectedWeapon?: string;
  weaponId?: string | null;
  sidearmId?: string | null;
  /**
   * Carried unfired ammunition. Composed actors use a single pool; the ammunition-type model
   * uses a per-type record. See `docs/DECISIONS.md` for the single-model rule.
   */
  ammo?: number | Record<string, number>;
  /** Whether a slow-reload weapon currently has a round chambered. */
  loaded?: boolean;
  equipmentState?: Record<string, Record<string, unknown>>;

  // --- alchemy / signs ----------------------------------------------------
  toxicity?: number;
  maxToxicity?: number;
  /** Sign ids the actor can weave. Absent means every Sign is open to them. */
  knownSigns?: string[];
  inventory?: Record<string, Record<string, number>>;
  activeAlchemy?: Record<string, { remaining: number; name: string } & Record<string, unknown>>;
  activeSigns?: Record<string, Record<string, unknown>>;
  /** `cost` is recorded when the shell is cast; only `hp`/`maxHp`/`upkeep` are read by rules. */
  activeShield?: { hp: number; maxHp: number; upkeep: number; cost?: number } | null;
  quenBlocks?: number;

  // --- special ------------------------------------------------------------
  mage?: { school: string; spells: string[] } | null;
  mounted?: boolean;
  mount?: Record<string, unknown> | null;
  breath?: Record<string, unknown> | null;
  silver?: boolean;
  silverImmune?: boolean;
  steelResistant?: boolean;

  // --- metadata -----------------------------------------------------------
  loot?: Record<string, unknown> | null;

  /** Legacy fields that have not been declared yet. This index signature only shrinks. */
  [key: string]: unknown;
}

export interface IMapState {
  tiles: ITile[];
  zones: IZone[];
  objects: Record<string, unknown>[];
  visibilityPenalty: number;
}

export interface ITurnState {
  side: string;
  action: number;
  bonus: number;
  reaction: number;
  movement: number;
  defensesUsed: number;
  extraAttackUsed: boolean;
  enemyCursor?: number;
}

export interface IUiState {
  route: IPosition[];
  pendingSurrender: string | null;
  latestEventId: string | null;
  [key: string]: unknown;
}

/** One narration/feed row produced by the simulation. */
export interface IFeedEntry {
  id: string;
  seq: number;
  round: number;
  kind?: string;
  title?: string;
  story?: string;
  math?: string;
  [key: string]: unknown;
}

export interface IState {
  version: string;
  phase: string;
  round: number;
  player: IActor;
  enemies: IActor[];
  selectedEnemyId: string | null;
  map: IMapState;
  turn: ITurnState;
  ui: IUiState;

  /** Newest-first narration shown in the combat log. */
  feed?: IFeedEntry[];
  /** Append-only structured event history used for debugging and reproduction. */
  events?: Array<Record<string, unknown>>;
  eventSeq?: number;
  /** `"teamA|teamB"` -> `hostile` | `ally` | `neutral`. */
  teamRelations?: Record<string, string>;
  /** Cross-actor observations the AI is allowed to reason about. */
  battleMemory?: {
    playerTactics: Array<Record<string, unknown>>;
    linesUsed: Record<string, unknown>;
    roundMeaningful: boolean;
    lastHarm: unknown;
    [key: string]: unknown;
  };
  situation?: string;
  /** The authored set piece being played, when the fight was started from one. */
  scenario?: { id: string; name: string; briefing: string } | null;
  setup?: Record<string, unknown>;
  winner?: string | null;
  aftermath?: Record<string, unknown>;

  /** Legacy fields that have not been declared yet. This index signature only shrinks. */
  [key: string]: unknown;
}

export interface IActionBase {
  actorId?: string;
}

export interface IMoveActionPayload extends IActionBase {
  kind: ActionKind.Move;
  to: IPosition;
}

export interface IAttackActionPayload extends IActionBase {
  kind: ActionKind.Melee | ActionKind.Ranged | ActionKind.Barehanded;
  targetId?: string;
  weaponId?: string;
  mode?: string;
  called?: string;
}

export interface ISignActionPayload extends IActionBase {
  kind: ActionKind.Sign;
  signId: string;
  targetId?: string;
  cost?: number;
}

export interface IGenericActionPayload extends IActionBase {
  kind: Exclude<ActionKind, ActionKind.Move | ActionKind.Melee | ActionKind.Ranged | ActionKind.Barehanded | ActionKind.Sign>;
  targetId?: string;
}

export type IActionPayload = IMoveActionPayload | IAttackActionPayload | ISignActionPayload | IGenericActionPayload;

export interface IActionVerdict {
  ok: boolean;
  reason?: string;
  error?: Error;
}

/**
 * A heterogeneous content record: a weapon row, a bestiary row, an AI profile, and so on.
 *
 * Content is validated on insertion by its kind's schema and read duck-typed by rules, so its
 * fields are deliberately open. This is the project's **one** content-layer `any`; everything else
 * that needs it aliases this type rather than declaring its own.
 *
 * Per-kind interfaces (`WeaponProfile` below is the first) replace it one kind at a time. It
 * disappears with the `Registry<T>` + Zod migration.
 */
export interface ContentRecord {
  [field: string]: any;
}

/** One immutable content row held by the legacy `RegistryHub`. */
export interface RegistryEntry extends ContentRecord {
  id: string;
}

/**
 * A weapon or innate attack profile.
 *
 * Covers both carried weapons from the registry and the attack profiles on a creature's stat
 * block, because attack resolution treats them identically: something with a damage expression, a
 * reach or range, and a list of effects.
 */
export interface WeaponProfile {
  id?: string;
  name?: string;
  /** Damage type: `P`, `S`, `B`, or `E`. */
  type?: string;
  /** Dice notation, e.g. `"5d6+6"`. */
  damage?: string;
  /** Extra damage against silver-vulnerable creatures. */
  silverDamage?: string;
  /** Metres, or `'melee'`. */
  range?: number | string;
  /** Melee reach in metres. */
  reach?: number;
  /** Weapon accuracy: a flat modifier to the attack roll. */
  wa?: number;
  /** Reliability: blocks before the weapon breaks. */
  rel?: number;
  hands?: number;
  effects?: readonly string[];
  /** Which skill wields it. Absent means the wielder's default melee skill. */
  combatSkill?: string;
  /** Flat attack value, used by innate creature attacks rather than a skill. */
  attack?: number;
  /** Attacks per action for a multi-strike innate attack. */
  rof?: number;
  [field: string]: unknown;
}

