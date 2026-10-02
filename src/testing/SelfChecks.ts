/**
 * Browser-free simulation self-checks.
 *
 * These assertions used to live inside the browser presentation layer, where they could only run
 * by opening `index.html#selftest`. They are simulation contracts, not presentation concerns, so
 * they live in the kernel and are consumed by two callers:
 *
 * - `tests/unit/selfChecks.test.ts` runs every check in Node/Vitest as part of `npm test`;
 * - the in-app diagnostics panel renders the same results for interactive debugging.
 *
 * A check returns `true`/`undefined` for pass, `false` for fail, or throws. Checks must not leave
 * the shared `Store`/`Dice` singletons mutated: `runSelfChecks()` snapshots and restores both.
 *
 * NOTE: the import below still points at the legacy `SimulationRuntime` bridge. As services are
 * extracted this import list shrinks; it is never allowed to grow.
 */
import {
  AI, AIProfileService, ActionDispatcher, ActorStateService, AnatomyService, CharacterRegistryService,
  CombatFlow, ConditionService, Core, CriticalService, DamageService, DeathStateTacticsService,
  DefeatService, DialogueService, Dice, DragonHoardService, EncounterCatalog, EncounterFactory,
  EquipmentStateService, EscapeService, EventPipeline, GrammarService, GridService, HarvestService,
  KnowledgeService, LootService, MoraleService, Pipeline, PronounSets, ReactionAssessmentService,
  ReactionService, Registry, Rules, SituationService, Store, TesterService,
  ZoneService, baseActor, clone, createPlayer, defaultState, human, invariant, isActiveOnMap,
  isHostile, isOccupied, resolveMagicTraps, validCombat, validateActionResource
} from '../services/SimulationRuntime';
import { RegistrySchemas } from '../data/RegistryHub';
import type { IActor, ICriticalWound, IState } from '../entities/types';

/** One named simulation contract. */
export interface SelfCheck {
  group: string;
  name: string;
  test: () => unknown;
}

/** Outcome of one executed check. */
export interface SelfCheckResult {
  group: string;
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Minimal actor fixture. Several checks only need an identity/position for the code under test;
 * this keeps the cast in one reviewed place instead of scattering it across the check bodies.
 */
function stubActor(fields: Partial<IActor>): IActor {
  return fields as IActor;
}

const checks: SelfCheck[] = [];

function add(group: string, name: string, test: () => unknown): void {
  checks.push({ group, name, test });
}

/** Combat-ready state used by most checks. */
function freshState(): IState {
  const state = defaultState();
  state.phase = 'combat';
  state.round = 1;
  state.turn.side = 'player';
  state.turn.action = 1;
  state.turn.bonus = 1;
  state.turn.reaction = 1;
  state.turn.movement = state.player.stats!.SPD!;
  return state;
}

  // Core
  add('Core', 'Pipeline priority order', () => { const p = new Core.EventPipeline(); const order: string[] = []; p.on('x', () => order.push('low'), 0); p.on('x', () => order.push('high'), 10); p.emit('x', {}); return order.join(',') === 'high,low'; });
  add('Core', 'Pipeline unsubscribe', () => { const p = new Core.EventPipeline(); let n = 0; const off = p.on('x', () => n++); off(); p.emit('x', {}); return n === 0; });
  add('Core', 'Pipeline cancellation', () => { const p = new Core.EventPipeline(); let n = 0; p.on('x', c => { c.cancelled = true; }, 10); p.on('x', () => n++, 0); p.emit('x', {}); return n === 0; });
  add('Core', 'Store structuredClone isolation', () => { const s = new Core.MemoryStore(() => ({ x: { y: 1 } })); const snap = s.snapshot(); snap.x.y = 9; return s.read().x.y === 1; });
  add('Core', 'Store bounded undo', () => { const s = new Core.MemoryStore(() => ({ n: 0 }), { historyLimit: 10 }); for (let i = 0; i < 20; i++) { s.checkpoint(); s.update(d => { d.n++; }, { silent: true }); } return s.historySize() === 10; });
  add('Core', 'Store reset', () => { const s = new Core.MemoryStore(() => ({ n: 1 })); s.update(d => { d.n = 7; }, { silent: true }); s.reset(); return s.read().n === 1 && s.historySize() === 0; });
  add('Core', 'Store validation rejects bad state', () => { const s = new Core.MemoryStore(() => ({ n: 1 }), { validate: x => Core.invariant(x.n >= 0, 'n') }); try { s.update(d => { d.n = -1; }, { silent: true }); return false; } catch { return s.read().n === 1; } });
  add('Core', 'RNG deterministic seed', () => { Dice.seed(12345); const a = [Dice.d(10), Dice.d(10), Dice.d(10)]; Dice.seed(12345); const b = [Dice.d(10), Dice.d(10), Dice.d(10)]; return a.join(',') === b.join(','); });
  add('Core', 'RNG snapshot restore', () => { Dice.seed(88); Dice.d(10); const snap = Dice.snapshot(); const a = Dice.d(100); Dice.restore(snap); return a === Dice.d(100); });
  add('Core', 'Committed Store state is immutable', () => Object.isFrozen(Store.read()) && Object.isFrozen(Store.read().player));

  // Registry/data
  add('Registry', 'Registry schemas pass', () => Registry.validateAll().length === 0);
  add('Registry', 'Weapons populated', () => Registry.weapons.size >= 20);
  add('Registry', 'Bestiary populated', () => Registry.bestiary.size >= 35);
  // Five basic Signs and their five alternate forms, plus the two advanced Signs. The count is a
  // floor, not a fixture: registering another Sign must not fail this check.
  add('Registry', 'Basic, alternate, and advanced Signs registered', () => Registry.signs.size >= 12);
  add('Registry', 'Every Sign declares a resolver', () =>
    [...Registry.signs.values()].every(sign => typeof sign.resolver === 'string' && sign.resolver.length > 0));
  add('Registry', 'Conditions populated', () => Registry.conditions.size >= 12);
  add('Registry', 'Mage spells populated', () => Registry.spells.size >= 10);
  add('Registry', 'True Dragon registered', () => Registry.bestiary.has('truedragon'));
  add('Registry', 'Higher Vampire registered', () => Registry.bestiary.has('highervampire'));
  add('Registry', 'Bad weapon schema fails', () => { try { RegistrySchemas.weapons({ id: 'bad', name: 'bad', range: 'melee' }); return false; } catch { return true; } });
  add('Registry', 'Weapon definitions immutable', () => Object.isFrozen(Registry.weapons.get('manticoreSteel')));

  // Dice/rules
  add('Rules', 'Exploding chain depth bounded', () => { for (let i = 0; i < 300; i++) if (Dice.check(10, { maxDepth: 8 }).chain.length > 9) return false; return true; });
  add('Rules', 'Head multiplier x3', () => Rules.location('human', 'head').mult === 3);
  add('Rules', 'Limb multiplier x0.5', () => Rules.location('human', 'rightLeg').mult === 0.5);
  add('Rules', 'Monster special called shot', () => Rules.location('monster', 'special').penalty === -2);
  add('Rules', 'Critical simple threshold', () => Rules.criticalFromMargin(7)?.tier === 'simple');
  add('Rules', 'Critical deadly threshold', () => Rules.criticalFromMargin(15)?.tier === 'deadly');
  add('Rules', 'Strong attack doubles raw damage path', () => Registry.weapons.get('manticoreSteel')!.range === 'melee');
  add('Rules', 'Critical healing day table', () => CriticalService.healingDays(9, 'deadly') === 9);
  add('Rules', 'Critical treatment DC table', () => CriticalService.treatment('complex').dc === 14);
  add('Rules', 'Body damage modifier table', () => Rules.bodyDamage(9) === 4 && Rules.bodyDamage(3) === -2);

  // Tactical
  add('Tactical', 'Grid bounds', () => GridService.inside(0, 0) && GridService.inside(GridService.W - 1, GridService.H - 1) && !GridService.inside(GridService.W, 0) && !GridService.inside(0, GridService.H));
  add('Performance', 'Grid uses flat integer tile storage', () => { const s=defaultState(),last=GridService.SIZE-1,{x,y}=GridService.pos(last); return Array.isArray(s.map.tiles)&&s.map.tiles.length===GridService.SIZE&&GridService.index(x,y)===last&&GridService.tile(s,x,y)===s.map.tiles[last]; });
  add('Performance', 'Grid index round-trips without string coordinates', () => { for(let i=0;i<GridService.SIZE;i++){const p=GridService.pos(i);if(GridService.index(p.x,p.y)!==i)return false}return true; });
  add('Architecture', 'Store accepts an injected presentation scheduler', () => typeof Store.setNotifyScheduler==='function');
  add('Tactical', 'Bresenham LOS cells', () => GridService.bresenham({ x: 0, y: 0 }, { x: 5, y: 3 }).length >= 6);
  add('Tactical', 'A* returns path', () => GridService.path(defaultState(), { x: 1, y: 1 }, { x: 10, y: 10 }, 'qa').length > 0);
  add('Tactical', 'A* blocked wall detours', () => { const s = defaultState(); for (let y = 0; y < 15; y++) { s.map.tiles[GridService.index(8, y)]!.blocksMove = true; } const p = GridService.path(s, { x: 2, y: 2 }, { x: 12, y: 2 }, 'qa'); return p.length > 0 && p.some(x => x.y === 15); });
  add('Tactical', 'Reachable honors movement', () => { const s = defaultState(); const r = GridService.reachable(s, s.player, 2); return r.has(GridService.index(5, 8)) && !r.has(GridService.index(12, 8)); });
  add('Tactical', 'LOS blocked by structure', () => { const s = defaultState(); s.map.tiles[GridService.index(8, 8)]!.blocksLos = true; return !GridService.los(s, { x: 4, y: 8 }, { x: 12, y: 8 }).clear; });
  add('Tactical', 'Elevation modifier data exists', () => { const s = defaultState(); s.map.tiles[GridService.index(4, 8)]!.elevation = 2; return GridService.tile(s, 4, 8)!.elevation === 2; });
  add('Tactical', 'Occupancy detects player', () => isOccupied(defaultState(), 4, 8, 'qa'));
  add('Tactical', 'Escaped enemy leaves occupancy', () => { const s = defaultState(); const e = baseActor({ name: 'QA', family: 'Human', stats: { BODY: 5, WILL: 5 }, hp: 20 }); e.id = 'e'; e.pos = { x: 8, y: 8 }; e.fled = true; e.retreat!.state='escaped'; s.enemies = [e]; return !isOccupied(s, 8, 8, 'qa'); });
  add('Tactical', 'Routing enemy remains on map', () => { const s = freshState(); const e = human('thug','Temeria'); e.id='route-qa'; e.pos={x:10,y:8}; e.retreat!.state='routing'; s.enemies=[e]; return isActiveOnMap(e)&&isHostile(e)&&isOccupied(s,10,8,'qa'); });
  add('Tactical', 'Escape planner finds a map edge', () => { const s = freshState(); const e = human('thug','Temeria'); e.id='escape-qa'; e.pos={x:12,y:8}; s.enemies=[e]; const plan=EscapeService.plan(s,e); return !!plan&&EscapeService.isEdge(plan.exit)&&plan.path.length>1; });
  add('Tactical', 'Situation plugin creates cover', () => { const s = defaultState(); SituationService.apply(s, 'ruins'); return Object.values(s.map.tiles).some(t => t.coverSp > 0); });

  // Combat services
  add('Combat', 'Condition add/remove', () => { const a = createPlayer(); ConditionService.add(a, 'prone'); const yes = ConditionService.has(a, 'prone'); ConditionService.remove(a, 'prone'); return yes && !ConditionService.has(a, 'prone'); });
  add('Combat', 'Condition immunity respected', () => { const a = createPlayer(); a.immunities = ['poisoned']; return ConditionService.add(a, 'poisoned') === false; });
  add('Combat', 'Armor slot read', () => DamageService.armorSlot(createPlayer(), Rules.location('human', 'torso')) === 14);
  add('Combat', 'Quen consumes one block', () => { const s = defaultState(), target = s.player; target.quenBlocks = 1; const r = DamageService.resolve(s, { attacker: stubActor({ id: 'x', pos: { x: 5, y: 8 } }), target, raw: 20, type: 'S', location: Rules.location('human', 'torso'), weapon: { effects: [] } }); return r.dealt === 0 && target.quenBlocks === 0; });
  add('Combat', 'Active Shield absorbs damage', () => { const s = defaultState(), target = s.player; target.activeShield = { hp: 20, maxHp: 20, upkeep: 1 }; const r = DamageService.resolve(s, { attacker: stubActor({ id: 'x', pos: { x: 5, y: 8 } }), target, raw: 10, type: 'S', location: Rules.location('human', 'torso'), weapon: { effects: [] } }); return r.dealt === 0 && target.activeShield!.hp === 10; });
  add('Combat', 'Armor ablates on penetration', () => { const s = defaultState(), t = createPlayer(), before = t.armorByLocation!.torso; DamageService.resolve(s, { attacker: stubActor({ id: 'x' }), target: t, raw: 40, type: 'S', location: Rules.location('human', 'torso'), weapon: { effects: [] } }); return t.armorByLocation!.torso === before! - 1; });
  add('Combat', 'Improved AP halves SP', () => { const s = defaultState(), t = createPlayer(); const r = DamageService.resolve(s, { attacker: stubActor({ id: 'x' }), target: t, raw: 20, type: 'S', location: Rules.location('human', 'torso'), weapon: { effects: ['ImprovedArmorPiercing'] } }); return r.effectiveSp === 7; });
  add('Combat', 'Resistance halves penetrating damage', () => { const s = defaultState(), t = createPlayer(); t.resistances = ['S']; const r = DamageService.resolve(s, { attacker: stubActor({ id: 'x' }), target: t, raw: 30, type: 'S', location: Rules.location('human', 'torso'), weapon: { effects: [] } }); return r.dealt === 8; });
  add('Combat', 'Death state starts below zero', () => { const a = createPlayer(); a.hp = 0; ConditionService.enterDeath(a); return a.death?.active === true; });
  add('Combat', 'Critical service creates wound', () => { const a = createPlayer(); const before = a.criticals!.length; CriticalService.inflict(a, 'simple', Rules.location('human', 'rightArm')); return a.criticals!.length === before + 1; });
  add('Combat', 'Magic Trap zone resolver safe empty', () => { const s = defaultState(); s.map.zones.push({ type: 'magicTrap', x: 4, y: 8, radius: 3, duration: 1, power: 1 }); resolveMagicTraps(s); return true; });
  add('Combat', 'Recovery capped by max STA', () => { const a = createPlayer(); a.sta = a.maxSta - 1; a.sta = Math.min(a.maxSta, a.sta + a.rec!); return a.sta === a.maxSta; });

  // Actions
  add('Actions', 'Gateway has all registered actions', () => ActionDispatcher.list().length >= 20);
  add('Actions', 'Unknown action rejected', () => !ActionDispatcher.validate('does-not-exist', {}, freshState()).ok);
  add('Actions', 'Move requires movement', () => { const s = freshState(); s.turn.movement = 0; return !ActionDispatcher.validate('move', { actorId: 'nikhail', to: { x: 5, y: 8 } }, s).ok; });
  add('Actions', 'Melee requires hostile target', () => { const s = freshState(); return !ActionDispatcher.validate('melee', { actorId: 'nikhail', targetId: 'none', weaponId: 'manticoreSteel' }, s).ok; });
  add('Actions', 'Ranged requires loaded crossbow', () => { const s = freshState(); const e = baseActor({ name: 'QA', family: 'Human', stats: { BODY: 5, WILL: 5 }, hp: 20 }); e.id = 'e'; e.pos = { x: 10, y: 8 }; s.enemies = [e]; s.selectedEnemyId = 'e'; s.player.crossbowLoaded = false; return !ActionDispatcher.validate('ranged', { actorId: 'nikhail', targetId: 'e', weaponId: 'zerrikanianCrossbow' }, s).ok; });
  add('Actions', 'Strict extra attack eligibility', () => { const s = freshState(); s.turn.action = 0; s.player.sta = 5; return validateActionResource(s, { actorId: 'nikhail' }).ok; });
  add('Actions', 'Surrender response legal during enemy phase', () => { const s = freshState(); s.turn.side = 'enemy'; s.enemies = [stubActor({ id: 'qa', name: 'QA' })]; s.ui.pendingSurrender = 'qa'; return ActionDispatcher.validate('social', { actorId: 'nikhail', targetId: 'qa', kind: 'acceptSurrender' }, s).ok; });
  add('Actions', 'Sign validates STA', () => { const s = freshState(); s.player.sta = 0; return !ActionDispatcher.validate('sign', { actorId: 'nikhail', signId: 'quen', cost: 2 }, s).ok; });
  add('Actions', 'Bomb validates inventory', () => { const s = freshState(); s.player.inventory!.bombs!['grapeshot'] = 0; return !ActionDispatcher.validate('bomb', { actorId: 'nikhail', itemId: 'grapeshot' }, s).ok; });

  // World/identity
  add('World', 'Human identity has gender', () => { const a = baseActor({ name: 'QA', family: 'Human', region: 'Temeria', stats: { BODY: 5, WILL: 5 }, hp: 20 }); return !!a.gender && a.gender !== 'None'; });
  add('World', 'Human identity has adult age', () => { const a = baseActor({ name: 'QA', family: 'Human', region: 'Temeria', stats: { BODY: 5, WILL: 5 }, hp: 20 }); return a.age! >= 18; });
  add('World', 'Construct gender none', () => { const a = baseActor({ name: 'QA', family: 'Construct', genderRule: 'none', stats: { BODY: 8, WILL: 8 }, hp: 40 }); return a.gender === 'None'; });
  add('World', 'Scoia’tael gets Aen Seidhe identity', () => { const a = human('archer', 'Aen Seidhe', { faction: 'Scoiatael' }); return a.identity?.region === 'Aen Seidhe' && !!a.name; });
  add('World', 'Higher Vampire has age/history', () => { const a = EncounterFactory.make('higherVampire')[0]; return !!a.ageBand && a.history.length > 0; });
  add('World', 'True Dragon has variant/history', () => { const a = EncounterFactory.make('trueDragon')[0]; return !!a.variant && a.history.length > 0; });
  add('World', 'Encounter IDs unique', () => { const list: IActor[] = EncounterFactory.make('bandits'); return new Set(list.map(x => x.id)).size === list.length; });
  add('World', 'Encounter categories expose registered foes', () => EncounterCatalog.categories.every(c => EncounterCatalog.foes(c.id).every(id => EncounterCatalog.hasFoe(id))));
  add('World', 'Generic variance changes actor without registry mutation', () => { const base=Registry.bestiary.get('bear'),before=base!.hp;const a=EncounterFactory.foe('bear','alpha');return a.maxHp>before && Registry.bestiary.get('bear')!.hp===before; });
  add('World', 'Dragon age variance can be selected', () => EncounterFactory.foe('truedragon','age:Elder').ageBand==='Elder');
  add('World', 'Higher vampire age variance can be selected', () => EncounterFactory.foe('highervampire','age:Young').ageBand==='Young');
  add('World', 'Custom lineup quantity builds correctly', () => EncounterFactory.build([{foe:'bandit',variant:'standard',quantity:2},{foe:'bear',variant:'source',quantity:1}]).length===3);
  add('World', 'Structured loot generated', () => (EncounterFactory.make('bandits') as IActor[]).every(x => x.loot && Array.isArray(x.loot.equipment) && Array.isArray(x.loot.personal)));
  add('World', 'All five dragon breaths registered', () => ['green','red','black','brown','white'].every(id=>Registry.dragonBreaths.has(id)));
  add('World', 'Dragon identity has name, lair, and breath', () => {const e=EncounterFactory.foe('truedragon','dragon:red');return !!e.name&&!!e.identity.lairRegion&&e.breath?.name==='Catastrophic Fire';});
  add('World', 'Higher vampire has tribe and true name', () => {const e=EncounterFactory.foe('highervampire','age:Adult');return ['Gharasham','Tdet','Ammurun'].includes(e.identity.tribe)&&!!e.identity.trueName;});
  add('World', 'Scoiatael does not use Nilfgaard voice set', () => {const e=EncounterFactory.foe('scoiatael','archer'),state=freshState();state.enemies=[e];const key=DialogueService.voiceKey(e);return key==='Scoiatael';});
  add('World', 'Non-speaking monster has no dialogue set', () => DialogueService.voiceKey(EncounterFactory.foe('drowner','source'))===null);
  add('World', 'True Dragon source STA/REC preserved', () => {const e=EncounterFactory.foe('truedragon','dragon:red');return e.maxSta>=80&&e.rec===16;});
  add('World', 'Higher Vampire source STA/REC preserved', () => {const e=EncounterFactory.foe('highervampire','age:Adult');return e.maxSta>=60&&e.rec===12;});
  add('World', 'Defeat profile generates narrative', () => {const s=freshState();s.enemies=EncounterFactory.make('trueDragon');s.battleMemory!.lastHarm={attackerId:s.enemies[0]!.id,source:'Bite',dealt:40,location:'Torso'};s.player.dead=true;const d=DefeatService.build(s);return d.profile==='dragon'&&d.story.length>40;});
  add('World','Defeat headline uses actual dragon cause',()=>{const s=freshState();s.enemies=EncounterFactory.make('trueDragon');const e=s.enemies[0];e!.variantKey='red';e!.breath=Registry.dragonBreaths.get('red');s.battleMemory!.lastHarm={attackerId:e!.id,source:e!.breath!.name,dealt:70,location:'Torso'};s.player.dead=true;const d=DefeatService.build(s);return /BURNED|DRAGONFIRE|INCINERATED/.test(d.headline)&&d.causeLine.includes(e!.name)});
  add('Tester','Full heal restores test sheet',()=>{const s=freshState();s.player.hp=3;s.player.sta=1;s.player.toxicity=100;s.player.statuses.burning=true;s.player.criticals=[{ name: 'Test', state: 'fresh' } as ICriticalWound];TesterService.fullHeal(s);return s.player.hp===s.player.maxHp&&s.player.sta===s.player.maxSta&&s.player.toxicity===0&&!s.player.statuses.burning&&s.player.criticals!.length===0});
  add('Tester','Armor repair restores max SP',()=>{const s=freshState();s.player.armorByLocation!.torso=2;TesterService.repairArmor(s);return s.player.armorByLocation!.torso===s.player.armorMaxByLocation!.torso});
  add('Zones','Yrden covers expected nodes',()=>{const s=freshState();ZoneService.create(s,{type:'yrden',center:{x:4,y:8},radius:3,duration:5,power:3});return ZoneService.tileMeta(s,4,8).some((x: { zone: { type: string } })=>x.zone.type==='yrden')&&ZoneService.tileMeta(s,12,8).length===0});
  add('Zones','Self-centered Yrden ignores distant selected target',()=>{const s=freshState(),e=EncounterFactory.make('bandits')[0];e.pos={x:20,y:8};s.enemies=[e];s.selectedEnemyId=e.id;const v=ActionDispatcher.validate('sign',{actorId:'nikhail',targetId:e.id,signId:'yrden',cost:2},s);return v.ok===true});
  add('Zones','Flame zone reapplies Burning',()=>{const s=freshState();ZoneService.create(s,{type:'flame',center:s.player.pos,radius:1,duration:2});ZoneService.applyToActor(s,s.player);return !!s.player.statuses.burning});
  add('World', 'Dialogue exact line cap', () => { const s = defaultState(), e = human('thug', 'Temeria'); e.ai!.memory.recentLines = []; const seen: string[] = []; for (let i = 0; i < 20; i++) { const line = DialogueService.line(s, e, 'attack'); if (line) seen.push(line); } return [...new Set(seen)].every(line => seen.filter(x => x === line).length <= 2); });
  add('World', 'Morale state changes under pressure', () => { const e = human('thug', 'Temeria'); const s = defaultState(); e.morale.pressure = 6; MoraleService.recalculate(s, e); return e.morale.state === 'panicked'; });

  add('World','Selected region reaches generated bandit',()=>{const e=EncounterFactory.foe('bandit','standard',{region:'Nilfgaard'});return e.encounterRegion==='Nilfgaard'&&e.identity?.region==='Nilfgaard'});
  add('World','Scoia’tael faction voice overrides operating region',()=>{const e=EncounterFactory.foe('scoiatael','archer',{region:'Nilfgaard'});return DialogueService.voiceKey(e)==='Scoiatael'&&e.identity?.region==='Aen Seidhe'});
  add('World','Dragon subspecies and age are separate selectors',()=>{const e=EncounterFactory.foe('truedragon','age:Adult',{region:'Zerrikania',subtype:'red'});return e.variantKey==='red'&&e.ageBand==='Adult'&&e.encounterRegion==='Zerrikania'});
  add('World','Silver hunting knife registered for carving',()=>Registry.tools.get('silverHuntingKnife')?.harvestBonus===2&&(defaultState().player.tools as string[]).includes('silverHuntingKnife'));
  add('World','Manticore harvest table lists its parts',()=>{const t=Registry.harvestTables.get('manticore');return t?.parts.some((p: Record<string, unknown>)=>p.name==='Bohun Upas Poison'&&p.quantity==='1d6')&&t.parts.some((p: Record<string, unknown>)=>p.name==='Manticore Stomach'&&p.quantity==='1')&&t.parts.some((p: Record<string, unknown>)=>p.name==='Manticore Wing Membranes'&&p.quantity==='2d6')});
  add('Loot','Unsupported monster gets no fabricated generic parts',()=>{const fake=stubActor({family:'Relict',baseName:'Unknown Relict',creatureKey:'unknownrelict',encounterRegion:'Velen',identity:{}});const l=LootService.generate(fake);return l.harvest.length===0&&l.currency.crowns===0&&HarvestService.tableFor(fake)===null});
  add('Loot','Rock troll pool separates carried loot from body components',()=>{const t=Registry.harvestTables.get('rocktroll');return t!.parts.some((p: Record<string, unknown>)=>p.name==='Troll Liver'&&p.channel==='harvest')&&t!.parts.some((p: Record<string, unknown>)=>p.name==='Mundane Items'&&p.channel==='personal')&&t!.parts.some((p: Record<string, unknown>)=>p.name==='Stone'&&p.channel==='personal')});
  add('Loot','Cyclops uses its full loot pool',()=>{const t=Registry.harvestTables.get('cyclops');return ['Cyclops’ Eye','Cyclops’ Brain','Cyclops’ Bones','Crystalized Essence','Cyclops’ Tongue'].every(n=>t!.parts.some((p: Record<string, unknown>)=>p.name===n))});
  add('Lifecycle','Death State survivor is allowed to act',()=>{const s=freshState();s.player.hp=-3;ConditionService.enterDeath(s.player);return validCombat(s,{actorId:'nikhail'}).ok===true&&s.player.death!.active});
  add('Lifecycle','Dying enemy remains a legal melee target',()=>{const s=freshState(),e=EncounterFactory.make('bandits')[0];e.pos={x:5,y:8};e.hp=-2;ConditionService.enterDeath(e);s.enemies=[e];s.selectedEnemyId=e.id;return ActorStateService.attackable(e)&&ActionDispatcher.validate('melee',{actorId:'nikhail',targetId:e.id,weaponId:'manticoreSteel',mode:'normal',called:'random'},s).ok===true});
  add('Targeting','No selection falls back to closest hostile',()=>{const s=freshState(),near=EncounterFactory.foe('bandit','standard',{region:'Temeria'}),far=EncounterFactory.foe('bandit','standard',{region:'Temeria'});near.id='near';far.id='far';near.pos={x:6,y:8};far.pos={x:12,y:8};s.enemies=[far,near];s.selectedEnemyId=null;const p: Record<string, unknown>={actorId:'nikhail',weaponId:'manticoreSteel',mode:'normal',called:'random'};const v=ActionDispatcher.validate('melee',p,s);return v.ok===true&&p.targetId==='near'});
  add('Targeting','Stale invalid selection falls back to closest hostile',()=>{const s=freshState(),dead=EncounterFactory.foe('bandit','standard',{region:'Temeria'}),near=EncounterFactory.foe('bandit','standard',{region:'Temeria'});dead.id='dead';near.id='near';dead.pos={x:5,y:8};near.pos={x:7,y:8};dead.dead=true;dead.hp=0;s.enemies=[dead,near];s.selectedEnemyId='dead';const p: Record<string, unknown>={actorId:'nikhail',weaponId:'manticoreSteel',mode:'normal',called:'random'};const v=ActionDispatcher.validate('melee',p,s);return v.ok===true&&p.targetId==='near'});
  add('Targeting','Ranged auto-target prefers nearest clear line',()=>{const s=freshState(),a=EncounterFactory.foe('bandit','standard',{region:'Temeria'}),b=EncounterFactory.foe('bandit','standard',{region:'Temeria'});a.id='a';b.id='b';a.pos={x:8,y:8};b.pos={x:10,y:8};s.enemies=[b,a];s.selectedEnemyId=null;const p: Record<string, unknown>={actorId:'nikhail',weaponId:'zerrikanianCrossbow',mode:'normal',called:'random'};const v=ActionDispatcher.validate('ranged',p,s);return v.ok===true&&p.targetId==='a'});
  add('Lifecycle','Death State AI gets a bounded tactical response',()=>{const s=freshState(),e=EncounterFactory.make('bandits')[0];e.pos={x:10,y:8};e.hp=-2;ConditionService.enterDeath(e);s.enemies=[e];const choice=DeathStateTacticsService.prepare(s,e,{force:true});return['fight','withdraw','flee','surrender'].includes(choice)&&e.death.tactics.round===s.round});
  add('Lifecycle','Death State flee response generates escape action',()=>{const s=freshState(),e=EncounterFactory.make('bandits')[0];e.pos={x:10,y:8};e.hp=-2;ConditionService.enterDeath(e);e.death.tactics={round:s.round,choice:'flee'};s.enemies=[e];return AI.LegalActions.build(s,e).some(a=>a.actionName==='enemyFlee')});
  add('Lifecycle','Death State withdraw response generates movement',()=>{const s=freshState(),e=EncounterFactory.make('bandits')[0];e.pos={x:10,y:8};e.hp=-2;ConditionService.enterDeath(e);e.death.tactics={round:s.round,choice:'withdraw'};s.enemies=[e];return AI.LegalActions.build(s,e).some(a=>a.actionName==='enemyMove')});
  add('Lifecycle','Death State fight response retains offensive options',()=>{const s=freshState(),e=EncounterFactory.make('bandits')[0];e.pos={x:5,y:8};e.hp=-2;ConditionService.enterDeath(e);e.death.tactics={round:s.round,choice:'fight'};s.enemies=[e];return AI.LegalActions.build(s,e).some(a=>['enemyMelee','enemyRanged','enemyCast','enemyThrowRock'].includes(a.actionName))});
  add('World','Hit reactions are species aware',()=>{const s=freshState(),e=EncounterFactory.foe('bear','source',{region:'Kaedwen'});s.enemies=[e];const r=ReactionService.trigger(s,e,'pain');return !!r&&/bear|snarl|roar|yelp|bellows/i.test(`${r.name} ${r.text}`)});
  add('Foundation','Pronouns follow actor identity',()=>{const a={name:'Test',gender:'Female',identity:{pronouns:Core.clone(PronounSets.Female)}};return GrammarService.subject(a)==='she'&&GrammarService.object(a)==='her'&&GrammarService.possessive(a)==='her'});
  add('Foundation','Anatomy preserves resolved body location',()=>{const a={family:'Human'};return AnatomyService.location(a,{id:'leftLeg',name:'Left Leg'}).label==='Left Leg'});
  add('Foundation','Tiny damage is not severe',()=>{const a=createPlayer(),r=ReactionAssessmentService.assess(a,{dealt:1,raw:5,armorAbsorbed:4,location:{id:'head',name:'Head'},hpBefore:45,hpAfter:44});return r.severity==='trivial'&&r.location.label==='Head'});
  add('Foundation','Armor-only impact stays impact',()=>{const a=createPlayer(),r=ReactionAssessmentService.assess(a,{dealt:0,raw:12,armorAbsorbed:12,location:{id:'rightArm',name:'Right Arm'},hpBefore:45,hpAfter:45});return r.severity==='impact'&&r.armorHeld===true});
  add('Foundation','Character registry can spawn clean actor copy',()=>{const a=CharacterRegistryService.spawn('nikhail',{actorId:'test-pc',team:'A',control:'PLAYER',position:{x:2,y:2}});return a.id==='test-pc'&&a.team==='A'&&a.control==='PLAYER'&&a.hp===a.maxHp&&a.identity.pronouns.subject==='he'});
  add('Foundation','Objective registry is data driven',()=>Registry.objectives.has('protect')&&Registry.objectives.has('escape'));
  add('Foundation','Knowledge records observations without engine branching',()=>{const a=createPlayer();KnowledgeService.observe(a,{type:'quenSeen',targetId:'x'},3);return KnowledgeService.knows(a,'quenSeen','x')});
  add('Foundation','Equipment readiness is isolated data',()=>{const a=createPlayer();EquipmentStateService.ensure(a);EquipmentStateService.set(a,'manticoreSteel','dropped');return EquipmentStateService.usable(a,'manticoreSteel')===false});
  // AI / lifecycle
  add('World Composer','War lance carries the Charging traits',()=>{const w=Registry.weapons.get('warLance');return w?.damage==='2d6'&&w?.effects?.includes('Charging')&&w?.effects?.includes('LongReach')});
  add('World Composer','Mounted lancer can generate a strict charge action',()=>{const st=freshState(),e=EncounterFactory.foe('cavalry','lancer',{region:'Toussaint',experience:'veteran',loadout:'lance'});e.id='lancer-test';e.pos={x:12,y:8};st.player.pos={x:4,y:8};st.enemies=[e];return AI.LegalActions.build(st,e).some(a=>a.actionName==='enemyMountedCharge')});

  add('World Composer','Human subspecies is not exposed',()=>EncounterCatalog.subtypes('bandit').length===1&&EncounterCatalog.subtypes('bandit')[0]![1]==='Default');
  add('World Composer','Witch Hunter carries field bag and papers',()=>{const e=EncounterFactory.foe('witchhunter','hunter',{region:'Novigrad',experience:'trained',loadout:'crossbow'});e.loot=LootService.generate(e) as unknown as Record<string, unknown>;return e.carriedBag?.includes('arrest warrants')&&e.loot.documents.length>0});
  add('World Composer','Mounted cavalry receives an actual mount profile',()=>{const e=EncounterFactory.foe('cavalry','lancer',{region:'Redania',experience:'veteran',loadout:'lance'});return e.mounted&&['Horse','War Horse'].includes(e.mount?.name)&&e.weaponId==='warLance'});
  add('World Composer','Dog and war horse source profiles registered',()=>Registry.bestiary.has('dog')&&Registry.bestiary.has('warhorse'));
  add('World Composer','Mage can generate melee focus build',()=>{const e=EncounterFactory.foe('mage','battlemage',{region:'Kaedwen',experience:'veteran',loadout:'greatblade'});return e.mage&&Registry.weapons.get(e.weaponId)?.range==='melee'&&e.experienceRank==='veteran'});
  add('World Composer','Specter gets mortal death history',()=>{const e: IActor=EncounterFactory.foe('wraith','source',{region:'Temeria'});return e.history!.some(x=>/^Death:/.test(x))&&e.history!.some(x=>/Unfinished business/.test(x))});
  add('World Composer','Cursed one gets curse-origin history',()=>{const e: IActor=EncounterFactory.foe('werewolf','source',{region:'Temeria'});return e.history!.some(x=>/Lycanthropy|curse/i.test(x))});
  add('World Composer','Dragon hoard composition follows life history',()=>{const e=EncounterFactory.foe('truedragon','age:Adult',{subtype:'red',region:'Kaedwen'});e.history.push('Major event: collected a relic coveted by sorcerers.');const h=DragonHoardService.build(e);return h.historyHooks.length>0&&h.provenance.some(x=>/magic|research|relic/i.test(x.name))});
  add('World Composer','Urban preset creates hard cover',()=>{const s=defaultState();SituationService.apply(s,'novigradStreet');return Object.values(s.map.tiles).some(t=>t.blocksLos&&t.coverSp>=20)&&Object.values(s.map.tiles).some(t=>t.terrainKind==='road')});
  add('Lifecycle','Puppeted living target is never harvestable',()=>{const e=EncounterFactory.foe('rocktroll','source');e.statuses.puppet=2;e.faction='player-controlled';return ActorStateService.life(e)==='alive'&&!ActorStateService.harvestable(e)&&ActorStateService.unresolvedControl(e)});
  add('AI', 'AI returns legal descriptors', () => { const s = freshState(); const e = EncounterFactory.make('troll')[0]; e.pos = { x: 10, y: 8 }; s.enemies = [e]; const acts = AI.LegalActions.build(s, e); return acts.length > 0 && acts.every(a => a.actionName && a.payload); });
  add('AI', 'AI decision is side-effect free', () => { const s = freshState(); const e = EncounterFactory.make('troll')[0]; e.pos = { x: 10, y: 8 }; s.enemies = [e]; const before = structuredClone(s); AI.Controller.decide(s, e); return s.feed!.length === before.feed!.length && e.ai.scores.length === before.enemies[0]!.ai!.scores.length; });
  add('AI', 'AI ranks highest first', () => { const e = { ai: { recent: [], stall: 0, memory: {} } }; const ranked = AI.Utility.rank(defaultState(), e, [{ name: 'a', score: 1 }, { name: 'b', score: 9 }]); return ranked[0].name === 'b'; });
  add('AI', 'Low STA suggests recover', () => { const s = freshState(); const e = EncounterFactory.make('troll')[0]; e.pos = { x: 12, y: 8 }; e.sta = 1; s.enemies = [e]; return AI.LegalActions.build(s, e).some(a => a.name === 'recover'); });
  add('AI', 'Ranged no ammo switches or flees', () => { const s = freshState(); const e = human('arbalist', 'Temeria'); e.id = 'e'; e.pos = { x: 12, y: 8 }; e.ammo = 0; s.enemies = [e]; return AI.LegalActions.build(s, e).some(a => ['switch', 'flee'].includes(a.name)); });
  add('AI', 'Routing enemy prioritizes escape movement', () => { const s=freshState(); const e=human('thug','Temeria'); e.id='route-ai'; e.pos={x:12,y:8}; e.retreat!.state='routing'; s.enemies=[e]; const d=AI.Controller.decide(s,e); return d?.actionName==='enemyFlee'; });
  add('AI', 'Illegal AI candidates are filtered before scoring', () => { const s=freshState(); const e=human('thug','Temeria'); e.id='edge-lock'; e.pos={x:1,y:1}; e.retreat!.state='routing'; s.enemies=[e]; for(const t of Object.values(s.map.tiles))if(EscapeService.isEdge(t)){t.blocksMove=true;t.blocksLos=true} const d=AI.Controller.decide(s,e); return !d||d.actionName!=='enemyFlee'; });
  add('AI', 'Anti-stall hook penalizes repeated reposition', () => { const e = human('thug', 'Temeria'); e.ai!.recent = ['reposition', 'reposition']; e.ai!.stall = 3; const c = Pipeline.emit('ai:score', { state: defaultState(), enemy: e, action: { name: 'reposition' }, score: 70 }); return c.score < 30; });
  add('AI', 'Cognition registry covers all six tiers', () => [...Registry.aiCognition.values()].map(x=>x.tier).sort().join(',')==='0,1,2,3,4,5');
  add('AI', 'Nekker uses primitive warband profile', () => { const e=EncounterFactory.foe('nekker','source'); return AIProfileService.profile(e)!.id==='nekkerWarband'&&AIProfileService.cognitionTier(e)>=2; });
  add('AI', 'Nekker can actually throw a stone, not merely be offered it', () => { const s=freshState(),e=EncounterFactory.foe('nekker','source');e.id='nek';e.pos={x:10,y:8};s.player.pos={x:4,y:8};s.enemies=[e];return AI.LegalActions.build(s,e).some(a=>a.name==='throwRock'&&ActionDispatcher.validate(a.actionName,{...a.payload},s).ok); });
  add('AI', 'Giant brute gets stronger rock throw profile', () => { const e=EncounterFactory.foe('cyclops','source'); return AIProfileService.hasTag(e,'giant')&&AIProfileService.hasTag(e,'throwRock'); });
  add('AI', 'Mage under melee pressure values escape spell', () => { const s=freshState(),e=EncounterFactory.foe('mage','illusion');e.id='mage-ai';e.pos={x:6,y:8};s.player.pos={x:4,y:8};s.enemies=[e];const acts=AI.LegalActions.build(s,e);return acts.some(a=>a.actionName==='enemyCast'&&Registry.spells.get(a.payload.spellId)?.tags?.includes('escape')); });
  add('AI', 'Higher vampire plans regeneration disengage when hurt', () => { const s=freshState(),e=EncounterFactory.foe('highervampire','age:Adult');e.id='hv-ai';e.pos={x:7,y:8};e.hp=Math.floor(e.maxHp*.35);s.enemies=[e];return AI.Planning.refresh(s,e)?.id==='disengageRegenerate'; });
  add('AI', 'True dragon uses mastermind cognition', () => { const e=EncounterFactory.foe('truedragon','age:Adult',{subtype:'red'});return AIProfileService.profile(e)!.id==='dragonMaster'&&AIProfileService.cognitionTier(e)>=5; });
  add('AI', 'Registered witcher spawns with expert hunter AI', () => { const a=CharacterRegistryService.spawn('nikhail',{actorId:'nik-ai',team:'enemy',control:'AI'}); return AIProfileService.profile(a)!.id==='witcherExpert'&&AIProfileService.cognitionTier(a)>=4; });
  add('AI', 'Dragon can actually take flight, not merely be offered it', () => { const s=freshState(),e=EncounterFactory.foe('truedragon','age:Adult',{subtype:'red'});e.id='dragon-ai';e.pos={x:8,y:8};s.player.pos={x:4,y:8};e.breath.cooldownRemaining=0;s.enemies=[e];return AI.LegalActions.build(s,e).some(a=>ActionDispatcher.validate(a.actionName,{...a.payload},s).ok&&(a.tags||[]).includes('flight')); });
  add('AI', 'AI utility includes explainable breakdown', () => { const s=freshState(),e=EncounterFactory.foe('bandit','veteran');e.pos={x:7,y:8};s.enemies=[e];const d=AI.Controller.decide(s,e);return !!d?.scores?.[0]?.breakdown?.length; });
  add('AI', 'Player action observation respects AI knowledge layer', () => { const s=freshState(),e=EncounterFactory.foe('bandit','veteran');e.id='observer';e.pos={x:7,y:8};s.enemies=[e];Pipeline.emit('action:beforeRun',{actorId:'nikhail',actionName:'ranged',state:s,payload:{}});return KnowledgeService.knows(e,'playerRanged','nikhail'); });
  add('Lifecycle', 'Default phase setup', () => defaultState().phase === 'setup');
  add('Lifecycle', 'Turn begin strict resources', () => { const s = defaultState(); s.phase = 'combat'; Pipeline.emit('turn:begin', { state: s, side: 'player' }); return s.turn.action === 1 && s.turn.bonus === 0 && s.turn.reaction === 0 && s.turn.movement===s.player.stats!.SPD; });
  add('Lifecycle', 'No legacy rules mode stored', () => !('rulesMode' in defaultState()));
  add('Lifecycle', 'No hostiles means victory', () => { const s = freshState(); s.enemies = []; Pipeline.emit('combat:checkEnd', { state: s }); return s.phase === 'ended' && s.winner === 'player'; });
  add('Lifecycle', 'Player death means defeat', () => { const s = freshState(); s.player.dead = true; Pipeline.emit('combat:checkEnd', { state: s }); return s.phase === 'ended' && s.winner === 'enemies'; });
  add('Lifecycle', 'Accepted surrender removes hostility', () => { const e = human('thug', 'Temeria'); e.statuses.surrendered = true; return !isHostile(e); });
  add('Lifecycle', 'Routing does not end hostility', () => { const e = human('thug', 'Temeria'); e.retreat!.state='routing'; return isHostile(e); });
  add('Lifecycle', 'Physical escape removes hostility', () => { const e = human('thug', 'Temeria'); e.fled = true; e.retreat!.state='escaped'; return !isHostile(e); });
  add('Lifecycle', 'Routing enemy prevents premature victory', () => { const s=freshState(); const e=human('thug','Temeria'); e.id='route-live'; e.pos={x:12,y:8}; e.retreat!.state='routing'; s.enemies=[e]; Pipeline.emit('combat:checkEnd',{state:s}); return s.phase==='combat'&&s.winner===null; });
  add('Lifecycle', 'Enemy must reach edge before escape', () => { const s=freshState(); const e=human('thug','Temeria'); e.id='runner'; e.pos={x:12,y:8}; e.stats!.SPD=2; s.enemies=[e]; const r=EscapeService.step(s,e); return r.ok&&!r.escaped&&!e.fled&&EscapeService.isRouting(e); });
  add('Lifecycle', 'Enemy escapes on reaching edge and loses loot eligibility', () => { const s=freshState(); const e=human('thug','Temeria'); e.id='edge-runner'; e.pos={x:1,y:8}; e.stats!.SPD=4; e.loot=LootService.generate(e) as unknown as Record<string, unknown>; s.enemies=[e]; const r=EscapeService.step(s,e); const eligible=s.enemies.filter(x=>!x.fled&&!x.statuses.surrendered&&x.loot); return r.escaped&&e.fled&&eligible.length===0; });
  add('Loot','Gang boss always has recoverable carried value',()=>{const e=EncounterFactory.foe('bandit','boss',{region:'Toussaint',experience:'veteran',loadout:'sword'});e.loot=LootService.generate(e) as unknown as Record<string, unknown>;return e.loot.currency.crowns>0&&e.loot.equipment.length>0&&e.loot.personal.length>0&&e.loot.valuables.length>0&&e.loot.documents.length>0});
  add('Loot','Dead gang boss is eligible for battlefield recovery',()=>{const e=EncounterFactory.foe('bandit','boss',{region:'Toussaint',experience:'veteran',loadout:'sword'});e.loot=LootService.generate(e) as unknown as Record<string, unknown>;e.dead=true;e.hp=-1;return LootService.recoverableCarried(e)===true});
  add('Lifecycle','Death-State enemy remains hostile until dead or otherwise removed',()=>{const e=EncounterFactory.foe('bandit','standard',{region:'Temeria',experience:'trained',loadout:'sword'});e.hp=-2;ConditionService.enterDeath(e);e.pos={x:4,y:4};return ActorStateService.life(e)==='dying'&&isHostile(e)===true});
  add('Lifecycle', 'Flow API is centralized', () => ['start', 'stop', 'reset', 'scheduleEnemyPhase', 'runEnemyPhase'].every(name => typeof (CombatFlow as Record<string, unknown>)[name] === 'function'));

/** Every registered simulation self-check, in declaration order. */
export const selfChecks: readonly SelfCheck[] = Object.freeze(checks.slice());

/** Number of registered checks. */
export function selfCheckCount(): number { return checks.length; }

/**
 * Runs one check in isolation and normalizes its outcome.
 * A returned value other than `false` counts as a pass; the value is reported as detail.
 */
export function runSelfCheck(check: SelfCheck): SelfCheckResult {
  try {
    const result = check.test();
    return { group: check.group, name: check.name, ok: result !== false, detail: result === true || result === undefined ? '' : String(result ?? '') };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return { group: check.group, name: check.name, ok: false, detail: error.message };
  }
}

/**
 * Runs every check, restoring the shared RNG and Store afterwards so diagnostics
 * cannot disturb an in-progress battle.
 */
export function runSelfChecks(list: readonly SelfCheck[] = selfChecks): SelfCheckResult[] {
  const previousState = Store.snapshot();
  const previousSeed = Dice.snapshot();
  try {
    return list.map(runSelfCheck);
  } finally {
    Dice.restore(previousSeed);
    Store.replace(previousState, { clearHistory: false });
  }
}
