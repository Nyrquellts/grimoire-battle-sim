// @ts-nocheck
import { RAW_CRITICALS, MAGE_SPELL_CATALOG } from '../data/raw/witcherData';
// Transitional behavior-preservation bridge. Gameplay logic is unchanged while typed services are extracted.
import { clone, deepFreeze, invariant } from '../core/utils';
import { EventPipeline } from '../core/EventPipeline';
import { SeededRng } from '../core/SeededRng';
import { DiceService } from '../core/Dice';
import { ZustandHistoryStore } from '../core/StateStore';
import { ActionGateway } from '../core/ActionGateway';
import { GridService, isOccupied } from '../services/GridService';
import { BattlefieldBuilder, createTiles } from './Battlefield';
import { DeploymentService as DeploymentSystem } from './Deployment';
import { TerrainRules, rangedProfileAt } from './TerrainRules';
import { CreatureAbilitySystem } from './CreatureAbilities';
import { WATER_NATIVE_TAG, abilityCandidate, actorCapabilities, insightContext, spellCandidate, tacticalInsight, terrainAffinity, zoneRisk } from './AiTactics';
import { registerCreatureActions } from '../actions/creatures';
import { DirtyTileService } from '../services/DirtyTileService';
import { Registry, abilitiesFor, parseEffects, slug, variantAbilitiesFor } from '../data/witcherContent';
import { Dice, Pipeline, Random } from '../core/kernel';
import { pushFeed } from './CombatLog';
import { ActorAccess, TeamService } from './Teams';
import { ConditionSystem, createDeathStateService } from './Conditions';
import { EquipmentSystem } from './Equipment';
import { CriticalService } from './CriticalWounds';
import { DamageResolver } from './Damage';
import { DefenseResolver } from './Defense';
import { effectiveSkill } from './Skills';
import { CombatRules, HitLocations } from './CombatRules';
import { AttackResolver, attackBase } from './Attack';
import { ZoneSystem } from './Zones';
import { ActorStateService, isHostile } from './ActorState';
import { EscapeSystem } from './Escape';
import { TargetingService } from './Targeting';
import { SpellCastingSystem } from './SpellCasting';
import { registerSignActions } from '../actions/signs';
import { registerScenarioActions } from '../actions/scenarios';
import { DragonHoardService, HarvestService, LootService, setRegionLabeller } from './Loot';
import * as Ammunition from './Ammunition';
import * as TemporaryHealth from './TemporaryHealth';
import { HeroRoster } from './PlayerCharacter';
import { isActorOnMap as isActiveOnMap, isPlayerControlled, usesSkillBasedCombat } from '../entities/Actor';
import type { IActor, IPosition, IState, RegistryEntry } from '../entities/types';

const Core = Object.freeze({ clone, deepFreeze, invariant, EventPipeline, SeededRng, MemoryStore: ZustandHistoryStore });

'use strict';





const PronounSets=Object.freeze({
  Male:{subject:'he',object:'him',possessiveAdjective:'his',possessivePronoun:'his',reflexive:'himself'},
  Female:{subject:'she',object:'her',possessiveAdjective:'her',possessivePronoun:'hers',reflexive:'herself'},
  Nonbinary:{subject:'they',object:'them',possessiveAdjective:'their',possessivePronoun:'theirs',reflexive:'themself'},
  None:{subject:'it',object:'it',possessiveAdjective:'its',possessivePronoun:'its',reflexive:'itself'},
  Unknown:{subject:'they',object:'them',possessiveAdjective:'their',possessivePronoun:'theirs',reflexive:'themself'}
});

const GrammarService=Object.freeze({
  pronouns(actor){return actor?.identity?.pronouns||actor?.pronouns||PronounSets[actor?.gender]||PronounSets.Unknown},
  ensure(actor){if(!actor)return actor;actor.identity??={};actor.identity.pronouns??=Core.clone(PronounSets[actor.gender]||PronounSets.Unknown);actor.pronouns=Core.clone(actor.identity.pronouns);return actor},
  subject(actor,cap=false){const v=this.pronouns(actor).subject;return cap?v[0].toUpperCase()+v.slice(1):v},
  object(actor){return this.pronouns(actor).object},
  possessive(actor){return this.pronouns(actor).possessiveAdjective},
  reflexive(actor){return this.pronouns(actor).reflexive},
  name(actor){return actor?.identity?.shortName||actor?.name||'the combatant'}
});

const AnatomyService=Object.freeze({
  profileId(actor){if(actor?.anatomyId&&Registry.anatomies.has(actor.anatomyId))return actor.anatomyId;if(actor?.exceptional==='dragon')return'trueDragon';const f=String(actor?.family||'Human').toLowerCase();if(f==='human')return'humanoid';if(/beast/.test(f))return'quadruped';if(/draconid|hybrid/.test(f))return'wingedDraconid';if(/insect/.test(f))return'insectoid';if(/spect/.test(f))return'spectral';if(/construct|element/.test(f))return'construct';return'humanoid'},
  ensure(actor){if(!actor)return actor;actor.anatomyId=this.profileId(actor);return actor},
  location(actor,location){const id=location?.id||location||'torso',profile=Registry.anatomies.get(this.profileId(actor)),row=profile?.locations?.[id];return row?{id,...row}:{id,label:location?.name||String(id).replace(/([A-Z])/g,' $1').trim(),group:id==='head'?'head':id==='torso'?'torso':'special'}},
  display(actor,location){return this.location(actor,location).label}
});

const ObjectiveService=Object.freeze({
  ensure(actor){if(!actor)return actor;actor.objective??={id:'eliminate',targetId:null,progress:0};return actor},
  definition(actor){return Registry.objectives.get(actor?.objective?.id||'eliminate')||Registry.objectives.get('eliminate')},
  utility(actor,actionName){return Number(this.definition(actor)?.utility?.[actionName]||0)}
});

const KnowledgeService=Object.freeze({
  ensure(actor){if(!actor)return actor;actor.combatKnowledge??={observed:[],knownVulnerabilities:[],knownHazards:[],lastUpdatedRound:0};return actor},
  observe(actor,event,round=0){this.ensure(actor);const signature=`${event.type}:${event.targetId||''}:${event.detail||''}`;if(!actor.combatKnowledge.observed.some(x=>x.signature===signature))actor.combatKnowledge.observed.push({signature,...Core.clone(event),round});actor.combatKnowledge.observed=actor.combatKnowledge.observed.slice(-30);actor.combatKnowledge.lastUpdatedRound=round},
  knows(actor,type,targetId: string|null=null){this.ensure(actor);return actor.combatKnowledge.observed.some(x=>x.type===type&&(!targetId||x.targetId===targetId))}
});


const AIProfileService=Object.freeze({
  profileId(actor){
    if(actor?.ai?.profileId&&Registry.aiProfiles.has(actor.ai.profileId))return actor.ai.profileId;
    if(actor?.exceptional==='dragon')return'dragonMaster';
    if(actor?.exceptional==='higherVampire')return'higherVampireMaster';
    if(actor?.combatDoctrines?.includes('witcher'))return'witcherExpert';
    if(actor?.mage)return'mageExpert';
    if(actor?.faction==='Scoiatael')return'skirmisher';
    if(['Construct','Elementa'].includes(actor?.family))return'reactiveConstruct';
    const key=String(actor?.creatureKey||actor?.baseName||actor?.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
    if(key.includes('nekker'))return'nekkerWarband';
    if(key.includes('cyclops')||key.includes('troll'))return'giantBrute';
    if(key.includes('drowner')||key.includes('ghoul')||key.includes('rotfiend'))return'instinctiveSwarm';
    if(actor?.family==='Beast')return'packPredator';
    if(actor?.family==='Vampire')return'vampireExpert';
    const int=Number(actor?.stats?.INT||1);
    if(actor?.family==='Human')return actor?.faction==='Bandit'?'outlaw':'soldier';
    if(int>=5)return'intelligentMonster';
    return'instinctiveMonster';
  },
  ensure(actor){
    if(!actor)return actor;
    actor.ai??={experience:'normal',recent:[],stall:0,lastMeaningfulRound:0,scores:[],rejections:[],memory:{},plan:null};
    actor.ai.profileId=this.profileId(actor);
    const profile=Registry.aiProfiles.get(actor.ai.profileId);
    actor.ai.cognitionId=actor.ai.cognitionId||profile?.cognitionId||'instinctive';
    actor.combatDoctrines=[...new Set([...(actor.combatDoctrines||[]),...(profile?.doctrines||[])])];
    return actor;
  },
  profile(actor){return Registry.aiProfiles.get(actor?.ai?.profileId||this.profileId(actor))||Registry.aiProfiles.get('instinctiveMonster')},
  cognition(actor){const profile=this.profile(actor);return Registry.aiCognition.get(actor?.ai?.cognitionId||profile?.cognitionId||'instinctive')||Registry.aiCognition.get('instinctive')},
  doctrines(actor){return(actor?.combatDoctrines||[]).map(id=>Registry.combatDoctrines.get(id)).filter(Boolean)},
  personality(actor){return Registry.personalityProfiles.get(actor?.personalityProfile)||Registry.personalityProfiles.get('cautious')},
  hasTag(actor,tag){return this.profile(actor)?.tags?.includes(tag)||false},
  cognitionTier(actor){
    const base=this.cognition(actor).tier;
    const exp=actor?.ai?.experience==='veteran'||actor?.ai?.experience==='exceptional'?1:actor?.ai?.experience==='novice'?-1:0;
    const age=CreatureAbilityService.hasTag(actor,'agesIntoPower')?(actor.ageBand==='Elder'?1:actor.ageBand==='Young'?-1:0):0;
    return Math.max(0,Math.min(5,base+exp+age));
  }
});

const AITacticalState=Object.freeze({
  allies(state,actor){return ActorAccess.active(state).filter(x=>x.id!==actor.id&&TeamService.relationship(state,actor.team||actor.faction,x.team||x.faction)==='ally')},
  hostiles(state,actor){return ActorAccess.hostileTo(state,actor)},
  woundedRatio(actor){return Math.max(0,Math.min(1,actor.hp/Math.max(1,actor.maxHp)))},
  visible(state,actor,target){return !!target&&GridService.los(state,actor.pos,target.pos).clear},
  /**
   * How dangerous a tile is to this actor.
   *
   * Zones declare what they threaten and actors declare what they are; neither is recognised by
   * name here. See `AiTactics.zoneRisk`.
   */
  zoneRisk(state,actor,pos){
    return zoneRisk(
      ZoneService.tileMeta(state,pos.x,pos.y),
      actorCapabilities(actor,(who,tag)=>CreatureAbilityService.hasTag(who,tag))
    );
  },
  playerPattern(state,actor){
    const tier=AIProfileService.cognitionTier(actor),recent=(state.battleMemory?.playerTactics||[]).slice(-8);
    if(tier<2)return{ranged:0,melee:0,sign:0};
    return recent.reduce((acc,row)=>{if(row.type==='ranged')acc.ranged++;if(row.type==='melee')acc.melee++;if(row.type==='sign')acc.sign++;return acc},{ranged:0,melee:0,sign:0});
  }
});

const BattlefieldObjectService=Object.freeze({
  add(state,type,pos,overrides={}){const def=Registry.battlefieldObjects.get(type);Core.invariant(def,`Unknown battlefield object ${type}`);state.map.objects??=[];const object={id:`obj-${state.map.objects.length+1}`,type,pos:{...pos},hp:overrides.hp??(def.destructible?20:null),...Core.clone(overrides)};state.map.objects.push(object);return object},
  at(state,pos){return(state.map.objects||[]).filter(o=>o.pos.x===pos.x&&o.pos.y===pos.y)},
  definition(object){return Registry.battlefieldObjects.get(object?.type)}
});




// ============================================================================
// WITCHER RULES PACK — game-specific combat rules and services.
// ============================================================================

// ---------- Rules & combat services ----------
// Combat rules moved to CombatRules.ts; `Rules` keeps its existing shape for callers and adds
// back the one member that belongs to life histories rather than to combat.
const Rules = { ...CombatRules, ageGenderProfile(spec){return LifeHistoryService.createIdentity(spec)} };

// Witcher wiring for the generic condition and equipment systems: the framework is content-free,
// so the specific content and the one rule that is not expressible as data are supplied here.
const ConditionService = new ConditionSystem(Registry.conditions, { regenerationBlockers: ['moonDust'] });
const DeathStateService = createDeathStateService(ConditionService);
const EquipmentStateService = new EquipmentSystem(id => Registry.weapons.get(id));




// Witcher wiring for the extracted combat services. The modules are content-free; the tables,
// critical wounds, and the AI reaction to a survived death save are supplied here.
const DamageService = new DamageResolver({ conditions: ConditionService, deathState: DeathStateService, criticals: CriticalService });
const DefenseService = new DefenseResolver(ConditionService);
Pipeline.on('deathSave:passed', ctx => { DeathStateTacticsService.prepare(ctx.state, ctx.target, { force: true }); }, 0);

// Witcher wiring for attack resolution. Targeting and narration still live here, so they are
// handed in; everything else the resolver needs is already a standalone module.
const AttackService = new AttackResolver({
  actors: ActorAccess,
  weapons: id => Registry.weapons.get(id),
  defense: DefenseService,
  damage: DamageService,
  targeting: TargetingService,
  narrate: { hit: (a, t, w, d) => hitFlavor(a, t, w, d), miss: (a, t, w) => missFlavor(a, t, w) },
  applyWeaponEffects: (state, actor, target, weapon, damage) => applyWeaponEffects(state, actor, target, weapon, damage),
  rangedTerrain: (state, actor) => rangedProfileAt(state, actor, Registry.terrain)
});

function applyWeaponEffects(state,actor,target,w,damage){if(!damage.dealt)return;for(const e of w.effects||[]){if(/^Bleeding/.test(e)&&Dice.d(100)<=Number(e.match(/\d+/)?.[0]||50))ConditionService.add(target,'bleeding');if(/^KnockDown/.test(e)&&Dice.d(100)<=Number(e.match(/\d+/)?.[0]||50))ConditionService.add(target,'prone');if(e==='Poison'||/^Poison/.test(e))ConditionService.add(target,'poisoned');if(e==='Fire'||/^Fire/.test(e))ConditionService.add(target,'burning');if(e==='Disease'||/^Disease/.test(e))ConditionService.add(target,'diseased');if(e==='DrainBlood'){const heal=Math.min(damage.dealt,10);actor.hp=Math.min(actor.maxHp,actor.hp+heal)}}}

// ---------- Exceptional creature identities ----------
const ExceptionalIdentityService=Object.freeze({
  dragonNames:['Avarenth','Beltharion','Cerynduir','Draelis','Eredhvar','Fethariel','Kaelthuir','Morvath','Rhaenulis','Tervandor','Veyrath','Zorandir','Aelthoran','Gvaerandir','Ormathir','Serravain'],
  dragonEpithets:{green:['of the Hot Springs','of the Green Hollow','the Reed-Crowned','of the Alderwood'],red:['the Ember-Crowned','of the High Crags','the Red Debate','of the Ashen Peak'],black:['of Gemmera','the Iron-Scaled','of the Southern March','the Acid-Tongued'],brown:['the Deep-Burrower','of the Stone Roads','the Mountain Root','of the Old Delvings'],white:['of the Dragon Mountains','the Winter Voice','of the Far North','the Frost-Crowned']},
  dragonLairs:{green:['Pontar forests','woods of Aedirn','Blue Mountains foothills','forests near Dol Blathanna','hot springs of the northern valleys'],red:['Kestrel Mountains','Dragon Mountains','Mahakam foothills','Tir Tochair','Kaedweni highlands'],black:['Gemmera','southern Nilfgaard','Nazair highlands','Maecht frontier','southern mountain marches'],brown:['Kestrel Mountains','Mahakam deeps','Blue Mountains','Tir Tochair passes','old dwarven mining ranges'],white:['Far North','Dragon Mountains','snow valleys beyond Kovir','northern wilderness beyond Poviss']},
  dragonRaising:['raised alone in a hidden lair','raised by one parent before claiming a separate territory','raised among a small family group until territorial instinct scattered them','spent early decades moving between abandoned lairs and Places of Power'],
  dragonHordes:['worked gold and gemstones','weapons and armor taken from failed hunters','rare books, maps, and magical curios','coins from many vanished kingdoms','art, sculpture, and noble regalia','dwarven and gnomish craftwork'],
  dragonTemperaments:['patient and observant','prideful and argumentative','possessive of territory','curious about mortal societies','coldly pragmatic','quick to anger when insulted','fond of long negotiations','contemptuous of professional hunters'],
  dragonEvents:['drove armed intruders from a hoard','abandoned a lair after humans discovered it','claimed a Place of Power and built a lair around it','collected a relic coveted by sorcerers','survived a hunt by professional monster slayers','watched a human settlement rise, change rulers, and disappear','made an agreement with dwarves or gnomes over territory','lost part of a hoard to thieves and remembered the insult'],
  dragon(spec,gender){
    const ages=[['Young','a few decades old',1,0,5000],['Young Adult','a few centuries old',2,1,10000],['Adult','a few millennia old',3,2,15000],['Elder','more than one hundred thousand years old',4,3,25000]];
    const forcedAge=ages.find(row=>row[0]===spec.forcedAgeBand),age=forcedAge||pickWeighted(ages,[1,2,2,5]);
    const choices=[['Green Dragon','green'],['Green Dragon','green'],['Green Dragon','green'],['Red Dragon','red'],['Red Dragon','red'],['Black Dragon','black'],['Black Dragon','black'],['Brown Dragon','brown'],['Brown Dragon','brown'],['White Dragon','white']];
    const forcedType=choices.find(row=>row[1]===spec.forcedDragonType),type=forcedType||choices[Dice.d(10)-1],key=type[1];
    const given=pick(this.dragonNames),epithet=Dice.d(100)<=55?` ${pick(this.dragonEpithets[key])}`:'',name=`${given}${epithet}`;
    const lairRegion=spec.forcedLairRegion||pick(this.dragonLairs[key]),raising=pick(this.dragonRaising),hordeType=pick(this.dragonHordes),personality=pick(this.dragonTemperaments);
    const history=[`${name} is a ${type[0].toLowerCase()} lairing in ${lairRegion}.`,`${raising[0].toUpperCase()+raising.slice(1)}.`,`The hoard is dominated by ${hordeType}.`,`Temperament: ${personality}.`,...Array.from({length:age[2]},()=>`Major event: ${pick(this.dragonEvents)}.`)];
    return{gender,age:null,ageBand:age[0],ageText:age[1],powerBonus:age[3],hordeValue:age[4],variant:type[0],variantKey:key,name,lairRegion,raising,hordeType,personality,history}
  },
  vampireTrueNames:{m:['Avarrhen','Detheran','Garveth','Ildren','Nereth','Orvenn','Rhenvar','Terval','Varethis','Zerath'],f:['Averenne','Cethira','Elaris','Ivrienne','Nerissa','Rhenna','Tavera','Varelia','Zerenne','Mireth']},
  vampireForeignAliases:{m:['Adrien','Cassian','Dorian','Lucan','Marek','Severin'],f:['Aveline','Celene','Ilyra','Mirelle','Sabine','Vera']},
  vampireRaising:['grew up among other higher vampires and learned their laws before mortal customs','learned to hunt mortals before learning to live beside them','was raised among nonhumans and became fluent in Elder Speech early','integrated into a mortal community while still young','spent youth as an outcast moving between vampire refuges','was raised close to vampire nobility and old tribal obligations'],
  bloodHabits:['abstains except in emergencies','drinks sparingly and treats blood like strong liquor','drinks socially among trusted vampires','has periods of dangerous overindulgence','prefers animal blood when possible','is fascinated by mortal blood but maintains strict control'],
  vampireEvents:['maintained a mortal identity for decades without exposure','lost a favored refuge to war or persecution','crossed paths with another higher vampire and kept the resulting debt','manipulated a local court without revealing true nature','was forced to regenerate after a disastrous hunt','protected a mortal family for reasons known only to the vampire','changed names after somebody noticed the face never aged','broke vampire custom and spent years repairing the social damage'],
  vampire(spec,gender,humanNames){
    const ages=[['Young','a few decades old',1,0],['Young Adult','a few centuries old',3,1],['Adult','several centuries old',5,2]],forcedAge=ages.find(row=>row[0]===spec.forcedAgeBand),age=forcedAge||pickWeighted(ages,[2,3,5]);
    const tribe=pickWeighted(['Gharasham','Tdet','Ammurun'],[7,2,1]),region=tribe==='Gharasham'?'Toussaint':tribe==='Tdet'?pick(['Zerrikania','Haaklands','eastern lands beyond the Blue Mountains']):'lands beyond the western sea';
    const trueName=pick(gender==='Female'?this.vampireTrueNames.f:this.vampireTrueNames.m);
    let alias;if(tribe==='Gharasham'){const pool=humanNames.Toussaint;alias=`${pick(gender==='Female'?pool.f:pool.m)} ${pick(pool.s)}`}else if(tribe==='Tdet'){const pool=humanNames.Zerrikania;alias=`${pick(gender==='Female'?pool.f:pool.m)} ${pick(pool.s)}`}else alias=`${pick(gender==='Female'?this.vampireForeignAliases.f:this.vampireForeignAliases.m)} ${pick(['Valeris','Merovan','d’Arque','Soren','Varyn'])}`;
    const raising=pick(this.vampireRaising),bloodHabit=pick(this.bloodHabits),ability=pick(['Command Vampires','Magical Talent','Cause Nightmares','Drain Lifeforce','Summon Ravens','Psychic Pulse','Blood Rage','Summon Fog','Mimic Voice','Weave Illusions']);
    const history=[`${trueName} belongs to the ${tribe} Tribe and currently uses the mortal identity ${alias}.`,`Raised in ${region}; ${raising}.`,`Blood habit: ${bloodHabit}.`,...Array.from({length:age[2]},()=>`Major event: ${pick(this.vampireEvents)}.`)];
    return{gender,age:null,ageBand:age[0],ageText:age[1],powerBonus:age[3],name:alias,trueName,tribe,region,raising,bloodHabit,specialAbility:ability,history}
  }
});

// ---------- Life histories, names, genders ----------
const LifeHistoryService={
  humanNames:{Temeria:{m:['Aldert','Bram','Cedric','Darek','Odo','Radek','Tomas','Wojciech','Mikolaj'],f:['Alina','Danuta','Elzbieta','Klara','Milena','Raisa','Zofia','Jadwiga','Marika'],s:['Morck','Kowal','Varg','Meller','Rybak','Pietrek','Zalewski','Borik']},Redania:{m:['Adalbert','Borys','Konrad','Marek','Rudolf','Witold','Velimir','Jan'],f:['Agnieszka','Brygida','Katarina','Rozalia','Vesna','Marta','Irena'],s:['Halder','Radek','Kraus','Mayer','Voss','Kestrel']},Kaedwen:{m:['Aksel','Brandt','Hakon','Keldar','Ragnar','Steinar','Vern','Waldemar'],f:['Astrid','Freja','Hilde','Ingrid','Sigrun','Yrsa'],s:['Holt','Kerr','Renn','Skell','Varin','Kross']},Nilfgaard:{m:['Aurelian','Berengar','Corvin','Decimus','Evander','Galen','Horatian'],f:['Aurelia','Berenice','Cassia','Drusilla','Elissa','Fabiola','Livilla'],s:['Valerian','Corvinus','Marcellan','Octavian','Severin','Tiberon','Valdor']},Skellige:{m:['Arne','Bjorn','Einar','Gudmund','Sven','Ulf'],f:['Brynja','Gunnhild','Freya','Ylva','Jutta'],s:['Hallgrim','Ravnskeld','Skarn','Thorsen','Vikstad']},Toussaint:{m:['Amaury','Bertrand','Gaston','Lucien','Renaud','Guillaume'],f:['Amelie','Celestine','Marceline','Odette','Vivienne','Orianna'],s:['de Vigny','de la Tour','Belcourt','Montfort','de Valmont']},Zerrikania:{m:['Azar','Dastan','Farid','Kaveh','Rashad','Sahir'],f:['Nadira','Samira','Tala','Yasmin','Zahra','Nisrine'],s:['Arzia','Bakari','Dast','Karest','Zarin','Sarran']},Aedirn:{m:['Aldrich','Brannoch','Corwin','Dunstan','Ewan'],f:['Aislin','Brenna','Isolde','Maeve','Livia'],s:['of Greyfield','of Highmarsh','Maldon','Vran','Aldersby']},Kovir:{m:['Axel','Fabian','Tanner','Leander','Osric'],f:['Adele','Corinne','Iris','Kestra','Linnea'],s:['Thorne','de Witt','Lorn','Marlowe','Troyden']}},
  elfGiven:{m:['Alvaren','Caelith','Eldrae','Faelor','Ilveth','Naerun','Sylvain','Taeron','Vaelis','Yseren','Aerwyn'],f:['Aelwyn','Caelira','Elowen','Ishara','Lissara','Naevys','Sylwen','Thalira','Vaelith','Ysmera']},elfBy:['of the Silverwood','of the Ashen Hills','of the Mistwater','of the Thornvale','of the Hollow Spire','of the Verdant Reach'],
  familyStatus:{north:['Aristocratic household','Mage-raised household','Knightly family','Merchant family','Artisan family','Entertainer family','Peasant family','Peasant family','Peasant family','Displaced family'],nilfgaard:['Aristocratic household','High-clergy household','Knightly family','Artisan family','Merchant family','Servile household','Servile household','Peasant family','Peasant family','Provincial household'],elder:['Old noble line','Warrior household','Merchant family','Scribe family','Entertainer family','Artisan family','Artisan family','Lowborn clan','Lowborn clan','Displaced enclave']},
  familyFates:{north:['The wars scattered the family across several realms.','A relative was imprisoned and the household never fully recovered.','A curse has followed the family for years.','Their livelihood collapsed and somebody turned to crime.','The family carries a crushing debt.','A long-running feud still follows the household.','Their home settlement turned against the family.','Bandits or soldiers massacred part of the family.','The family protects a dangerous secret.','Old grudges split the household from within.'],nilfgaard:['The family entered indenture to survive.','They were exiled toward the frontier.','A rogue mage destroyed much of the household.','Several relatives disappeared without explanation.','A relative was executed for treason.','The family lost rank, land, or title.','A magical scandal stained the family name.','A public disgrace made them unwelcome.','The family protects a dangerous secret.','An assassination tore the household apart.'],elder:['Humans marked the family as collaborators.','Their own people ostracized the household.','The Northern Wars killed several relatives.','A feud has lasted for generations.','The family lost an old title or honored position.','Raiders destroyed part of the household.','Their ancestral home is said to be haunted.','A human marriage split the extended family.','Relatives were killed after accusations of aiding the Scoia’tael.','The bloodline descends from an infamous traitor.']},
  influences:{north:['a temple priest','an artisan','a minor count','a mage','a village witch','a cursed survivor','an entertainer','a merchant','a criminal','a veteran soldier'],nilfgaard:['a priest of the Great Sun','an imperial outcast','a provincial count','a mage','a solicitor','a mage hunter','a professional soldier','an artisan','a sentient monster','an entertainer'],elder:['a human ally','an elderfolk artisan','a noble warrior','a highborn elder','an entertainer','a raider','a sage','a criminal','a hunter','a lowland farmer']},
  allyPositions:['a sellsword','a hedge mage','a mentor','a childhood friend','a skilled craftsperson','a former rival','a minor noble','a village priest','a retired soldier','a travelling minstrel'],
  enemyPositions:['a former friend','a jilted lover','a kinsman','a childhood rival','a zealot','a street minstrel','a mercenary','a highwayman','a minor noble','a sorcerer'],
  lifeEvent(decade){const category=Dice.d(10);let e;if(category<=4)e=Dice.d(2)===1?this.rollFortune():this.rollMisfortune();else if(category<=7)e=Dice.d(2)===1?this.rollAlly():this.rollEnemy();else e=this.rollRomance();return{decade,...e}},
  rollFortune(){return pick([{kind:'fortune',title:'Jackpot',text:`a stroke of luck brought in ${Dice.d(10)*100} crowns`},{kind:'fortune',title:'Teacher',text:'trained with a skilled teacher and improved a useful discipline'},{kind:'fortune',title:'Noble favor',text:'earned a favor from a noble household'},{kind:'fortune',title:'Combat teacher',text:'trained under a veteran soldier'},{kind:'fortune',title:'Witcher favor',text:'helped a witcher enough to be owed a favor'},{kind:'fortune',title:'Bandit contacts',text:'fell in with outlaws and retained some goodwill'},{kind:'fortune',title:'Tamed animal',text:'tamed a wild dog or wolf during hard travel'},{kind:'fortune',title:'Mage favor',text:'earned a favor from a powerful mage'},{kind:'fortune',title:'Priestly blessing',text:'received the recognized goodwill of a faith'},{kind:'fortune',title:'Knighted',text:'was formally honored for valor'}])},
  rollMisfortune(){return pick([{kind:'misfortune',title:'Debt',text:`fell ${Dice.d(10)*100} crowns into debt`},{kind:'misfortune',title:'Imprisonment',text:`spent ${Dice.d(10)} months imprisoned after a crime or accusation`},{kind:'misfortune',title:'Addiction',text:`developed an addiction to ${pick(['strong spirits','fisstech','gambling','tobacco','pain-killing drugs','a dangerous stimulant'])}`},{kind:'misfortune',title:'Bereavement',text:'lost a lover, friend, or relative to violence, monsters, or war'},{kind:'misfortune',title:'False accusation',text:`was falsely accused of ${pick(['theft','betrayal','murder','illegal witchcraft','desertion'])}`},{kind:'misfortune',title:'Hunted by law',text:'became wanted by guards or officials beyond a single village'},{kind:'misfortune',title:'Betrayal',text:'was blackmailed, exposed, or betrayed by somebody once trusted'},{kind:'misfortune',title:'Accident',text:'survived a disfiguring or disabling accident and months of recovery'},{kind:'misfortune',title:'Incapacitation',text:'survived poisoning or illness that left a lasting weakness'},{kind:'misfortune',title:'Curse',text:'became entangled in a curse whose consequences never fully disappeared'}])},
  rollAlly(){return{kind:'ally',title:'Ally',text:`made ${pick(['an acquaintance','a friend','a close friend','an inseparable companion'])} of ${pick(this.allyPositions)} after ${pick(['sharing danger','working the same job','traveling together','saving one another','fighting side by side'])}`}},
  rollEnemy(){return{kind:'enemy',title:'Enemy',text:`made an enemy of ${pick(this.enemyPositions)} over ${pick(['bloodshed','humiliation','a curse','romantic rejection','blackmail','foiled plans','a terrible wound','money'])}; the feud is ${pick(['mostly dormant','waiting for a chance','active if they meet','an ongoing hunt for revenge'])}`}},
  rollRomance(){const r=Dice.d(10);if(r===1)return{kind:'romance',title:'Happy love affair',text:'formed a genuinely happy relationship that endured unless later events changed it'};if(r<=4)return{kind:'romance',title:'Romantic tragedy',text:pick(['a lover disappeared','a lover was imprisoned or exiled','a curse took the lover away','monsters killed the lover','a rival stole the lover’s affection','circumstances made the relationship impossible'])};if(r<=6)return{kind:'romance',title:'Problematic love',text:pick(['the families hated the match','the lover repeatedly cheated','violent jealousy poisoned the relationship','the couple fought constantly','professional rivalry consumed the relationship','one partner was already married'])};return{kind:'romance',title:'Casual affairs',text:'spent the period in casual relationships rather than a lasting romance'}},
  createIdentity(spec){
    if(spec.genderRule==='none')return{gender:'None',age:null,ageBand:'Construct',history:['No biological sex or mortal age.']};
    const isElf=spec.faction==='Scoiatael'||spec.id==='scoiatael'||spec.region==='Aen Seidhe';
    if(isElf){const gender=spec.gender||pick(['Male','Female']),name=`${pick(gender==='Female'?this.elfGiven.f:this.elfGiven.m)} ${pick(this.elfBy)}`,age=24+Dice.d(237),events=Array.from({length:Math.max(2,Math.floor(age/40))},(_,i)=>this.lifeEvent(i+1));return{gender,age,ageBand:age<80?'Young Aen Seidhe':'Mature Aen Seidhe',region:'Aen Seidhe',ancestry:'Aen Seidhe',name,history:[pick(['Raised among displaced Aen Seidhe families.','Spent youth moving between forest enclaves and human-held roads.','Learned early to avoid human patrols and live from hidden camps.']),pick(['Joined a Scoia’tael commando after a pogrom.','Lost kin during a forced eviction.','Carried messages for Vrihedd veterans before taking up arms.']),...events.map(x=>`Decade ${x.decade}: ${x.title} — ${x.text}.`)]}}
    if(spec.family==='Human'){
      const region=spec.region||pick(['Temeria','Redania','Kaedwen','Nilfgaard','Aedirn','Kovir']),group=region==='Nilfgaard'?'nilfgaard':'north',gender=spec.gender||pick(['Male','Female']),pool=this.humanNames[region]||this.humanNames.Temeria,g=gender==='Female'?pool.f:pool.m,name=`${pick(g)} ${pick(pool.s)}`;
      let age;if(spec.mage){const r=Dice.d(100);age=r<=62?21+Dice.d(39):r<=88?59+Dice.d(61):r<=98?119+Dice.d(131):249+Dice.d(172)}else age=17+Dice.d(spec.experience==='veteran'?42:38);
      const events=Array.from({length:Math.max(1,Math.floor(age/10))},(_,i)=>this.lifeEvent(i+1)),familyStatus=pick(this.familyStatus[group]),familyFate=Dice.d(2)===1?'At least some close family remains alive.':pick(this.familyFates[group]),parentFate=Dice.d(2)===1?'Both parents survived into the character’s adulthood.':pick(['One or both parents died in war or violence.','One or both parents vanished, were exiled, or imprisoned.','The character was abandoned or given away.','One or both parents were killed by monsters, plague, magic, or persecution.']);
      return{gender,age,ageBand:age<25?'Young adult':age<45?'Adult':age<70?'Older adult':'Long-lived adult',region,name,familyStatus,familyFate,parentFate,influentialFriend:pick(this.influences[group]),history:[`Born in ${region}; raised in a ${familyStatus.toLowerCase()}.`,familyFate,parentFate,`An early influence was ${pick(this.influences[group])}.`,...events.map(x=>`Decade ${x.decade}: ${x.title} — ${x.text}.`)]}
    }
    const gender=spec.gender||pick(['Male','Female']),exceptional=spec.exceptional;
    if(exceptional==='dragon')return ExceptionalIdentityService.dragon(spec,gender);
    if(exceptional==='higherVampire')return ExceptionalIdentityService.vampire(spec,gender,this.humanNames);
    return CreatureHistoryService.create(spec,gender)
  }
};


const CreatureHistoryService=Object.freeze({
  mortalName(region='Temeria',gender='Male'){
    const pool=LifeHistoryService?.humanNames?.[region]||LifeHistoryService?.humanNames?.Temeria;if(!pool)return gender==='Female'?'Marta':'Tomas';
    return `${pick(gender==='Female'?pool.f:pool.m)} ${pick(pool.s)}`;
  },
  specter(spec,gender){
    const region=spec.region||'Temeria',former=this.mortalName(region,gender),death=pick(['was murdered and the body hidden','died violently during a raid','was executed after a false accusation','drowned before an unfinished promise could be kept','died defending a home that was later abandoned','was betrayed and killed by someone trusted','died in a fire with no proper burial']),unfinished=pick(['vengeance against the killer','protection of a surviving relative','a body or grave that was never properly tended','a stolen heirloom that still lies nearby','a promise that was never fulfilled','hatred of those now occupying the death-site']),place=pick(['an abandoned house','a roadside shrine','a graveyard','a ruined hamlet','a river crossing','an old battlefield','a burned manor']);
    const sentient=Dice.d(100)<=5;
    return{gender,age:null,ageBand:'Dead / spectral',region,name:spec.name,formerName:former,sentient,history:[`In life, the spirit was ${former} of ${region}.`,`Death: ${death}.`,`Unfinished business: ${unfinished}.`,`Haunting: ${place}; the manifestation has persisted long enough to become dangerous.`,sentient?'A rare part of the old personality still surfaces and may communicate under exceptional circumstances.':'Rage and fixation have almost completely drowned the mortal personality.']}
  },
  cursed(spec,gender){
    const region=spec.region||'Temeria',key=String(spec.creatureKey||spec.id||spec.name||'').toLowerCase();
    if(key.includes('werewolf')){const former=this.mortalName(region,gender),wrong=pick(['a brutal killing committed in anger','repeated cruelty toward helpless people','a blood feud that ended in an atrocity','a violent betrayal of kin','an act of deliberate, beastlike cruelty']);return{gender,age:18+Dice.d(45),ageBand:'Cursed mortal',region,name:spec.name,formerName:former,history:[`The werewolf is ${former}, a mortal from ${region}.`,`Lycanthropy followed ${wrong}; the curse expresses the victim’s worst violent impulses.`,`The transformation has already cost ${pick(['a family relationship','a livelihood','several livestock and one human life','the trust of the local village','a former traveling companion'])}.`,`Lifting the curse would require confronting the transgression and accepting real pain or personal loss.`]}}
    if(key.includes('botchling'))return{gender:'None',age:null,ageBand:'Cursed dead child',region,name:spec.name,history:[`The botchling arose from an unborn child denied a proper place among the living and the dead.`,`Its haunting remains tied to the family, home, and circumstances surrounding the loss.`,`A proper ritual may matter more than simply treating the creature as an animal.`]};
    if(key.includes('vendigo'))return{gender,age:null,ageBand:'Ancient cursed predator',region,name:spec.name,history:[`The vendigo has haunted high mountain routes for years, spoiling food and stalking isolated travelers.`,`At least one previous traveler survived its supernatural hunger and spread warnings through nearby settlements.`,`Its curse has already begun a chain of fear, starvation, or cannibalistic violence somewhere in its territory.`]};
    if(key.includes('archespore'))return{gender:'None',age:null,ageBand:'Rooted cursed growth',region,name:spec.name,history:[`The archespore took root where human wrongdoing and death left the ground poisoned by memory and curse.`,`It has spread through the immediate site rather than wandering like an animal.`,`Locals remember the place more clearly than they understand the monster.`]};
    return{gender,age:null,ageBand:'Cursed',region,name:spec.name,history:[`The creature exists because a curse attached itself to a specific wrongdoing, death, or broken obligation in ${region}.`,`Its current behavior follows that curse rather than ordinary animal ecology.`,`Breaking the curse requires understanding its cause; killing the body may not answer every question.`]}
  },
  ecology(spec,gender){const region=spec.region||'the region',family=spec.family||'Monster';return{gender,age:null,ageBand:'Mature',region,name:spec.name,history:[pick([`Established territory in ${region} and learned the safest approaches to it.`,`Was displaced into ${region} by war, settlement, hunger, or another monster.`,`Survived an earlier encounter with hunters and changed its habits afterward.`,`Has fed or hunted successfully in ${region} long enough to know the ground.`]),`Ecology: ${family.toLowerCase()} behavior, food, territory, and local pressure determine why it is here.`]}},
  create(spec,gender){if(spec.family==='Specter')return this.specter(spec,gender);if(spec.family==='Cursed')return this.cursed(spec,gender);return this.ecology(spec,gender)}
});
function pick(a){return a[Dice.d(a.length)-1]}function pickWeighted(items,weights){let n=Dice.d(weights.reduce((a,b)=>a+b,0)),acc=0;for(let i=0;i<items.length;i++){acc+=weights[i];if(n<=acc)return items[i]}return items.at(-1)}

// ---------- Encounter generation ----------
let nextId=1;
function baseActor(spec: Record<string, unknown>): IActor{
  const id=spec.id||`actor-${nextId++}`,stats=structuredClone(spec.stats||{}),maxSta=spec.maxSta||Math.max(20,((stats.WILL||5)+(stats.BODY||5))*5/2|0),maxHp=spec.maxHp||spec.hp||30;
  const actor={id,name:spec.name,baseName:spec.name,family:spec.family||'Human',faction:spec.faction||null,gender:null,age:null,ageBand:null,ageText:null,identity:null,history:[],stats,skills:structuredClone(spec.skills||{}),hp:maxHp,maxHp,sta:spec.sta||maxSta,maxSta,rec:spec.rec||Math.max(4,Math.floor(maxSta/5)),armor:spec.armor||0,maxArmor:spec.armor||0,armorByLocation:spec.armorByLocation?structuredClone(spec.armorByLocation):null,armorMaxByLocation:spec.armorByLocation?structuredClone(spec.armorByLocation):null,resistances:parseResistance(spec.resistance||spec.resistances),immunities:[...(spec.immunities||[])],vulnerabilities:[...(spec.vulnerabilities||[])],defenses:structuredClone(spec.defenses||{dodge:spec.defense||10,reposition:spec.defense||10,block:spec.defense||10,magic:spec.magicDefense||10}),attack:spec.attack||10,attacks:structuredClone(spec.attacks||[]),abilities:[...(spec.abilities||[])],regen:spec.regen||0,silver:!!spec.silver,steelResistant:!!spec.steelResistant,silverImmune:!!spec.silverImmune,statuses:{},criticals:[],disabledLocations:{},death:null,dead:false,fled:false,removed:false,retreat:{state:'none',startedRound:null,exit:null,lastRoute:[],blocked:0,escapedRound:null,lastPos:null},pos:{x:0,y:0},ammo:spec.ammo??0,loaded:spec.loaded??true,weaponId:spec.weaponId||null,sidearmId:spec.sidearmId||null,preferredRange:spec.preferredRange??2,morale:{state:'steady',pressure:0,fear:0,courage:spec.courage||Math.max(8,(stats.WILL||5)+5),surrender:spec.surrender??(spec.family==='Human'?.35:.05),fearImmune:spec.family==='Construct'||spec.family==='Elementa'},ai:{experience:spec.experience||'normal',profileId:spec.aiProfileId||null,cognitionId:spec.cognitionId||null,recent:[],stall:0,lastMeaningfulRound:0,scores:[],rejections:[],memory:{},plan:null,planSince:0,targetId:null,teamIntent:null,lastDecision:null},creatureKey:spec.creatureKey||null,sourceLoot:Core.clone(spec.loot||null),powerBonus:0,exceptional:spec.exceptional||null,breath:null,dragonDefense:null,mage:spec.mage?{school:spec.mageSchool||pick(['Fire','Ice','Support']),spells:spec.spells||mageSpellsFor()}:null,loot:null};
  Pipeline.emit('actor:created',{actor,spec});
  return actor
}
function parseResistance(v){if(Array.isArray(v))return v;if(!v||v==='none')return[];return String(v).split('').filter(x=>['P','S','B','E'].includes(x))}

// ---------- Encounter catalog & variance: Witcher content, not engine logic ----------
const EncounterRegionService=Object.freeze({
  regions:Object.freeze([
    {id:'random',label:'Lore-plausible random',nameRegion:null},
    {id:'Temeria',label:'Temeria',nameRegion:'Temeria'},
    {id:'Velen',label:'Velen / No Man’s Land',nameRegion:'Temeria'},
    {id:'Redania',label:'Redania',nameRegion:'Redania'},
    {id:'Novigrad',label:'Novigrad & Pontar',nameRegion:'Redania'},
    {id:'Kaedwen',label:'Kaedwen',nameRegion:'Kaedwen'},
    {id:'Aedirn',label:'Aedirn',nameRegion:'Aedirn'},
    {id:'DolBlathanna',label:'Dol Blathanna',nameRegion:'Aedirn'},
    {id:'Kovir',label:'Kovir & Poviss',nameRegion:'Kovir'},
    {id:'Nilfgaard',label:'Nilfgaard',nameRegion:'Nilfgaard'},
    {id:'Skellige',label:'Skellige',nameRegion:'Skellige'},
    {id:'Toussaint',label:'Toussaint',nameRegion:'Toussaint'},
    {id:'Zerrikania',label:'Zerrikania',nameRegion:'Zerrikania'}
  ]),
  pools:Object.freeze({
    bandit:['Temeria','Velen','Redania','Novigrad','Kaedwen','Aedirn','Kovir','Nilfgaard','Skellige','Toussaint','Zerrikania'],
    soldier:['Temeria','Velen','Redania','Kaedwen','Aedirn','Kovir','Nilfgaard','Skellige','Toussaint'],knight:['Temeria','Redania','Kaedwen','Aedirn','Kovir','Nilfgaard','Skellige','Toussaint'],cavalry:['Temeria','Redania','Kaedwen','Aedirn','Kovir','Nilfgaard','Skellige','Toussaint'],lord:['Temeria','Redania','Kaedwen','Aedirn','Kovir','Nilfgaard','Skellige','Toussaint'],
    witchhunter:['Redania','Novigrad','Temeria','Velen','Kaedwen'],templeguard:['Novigrad','Redania'],inquisitor:['Novigrad','Redania','Temeria'],
    mage:['Temeria','Redania','Novigrad','Kaedwen','Aedirn','Kovir','Nilfgaard','Toussaint','Zerrikania'],
    scoiatael:['Velen','Temeria','Redania','Kaedwen','Aedirn','DolBlathanna','Nilfgaard'],
    truedragon:['Aedirn','Kaedwen','Kovir','Skellige','Nilfgaard','Zerrikania'],
    manticore:['Aedirn','Kaedwen','Kovir','Zerrikania'],
    highervampire:['Toussaint','Nilfgaard','Temeria','Redania','Novigrad'],
    bruxa:['Toussaint','Nilfgaard','Temeria','Redania'],garkain:['Toussaint','Nilfgaard','Temeria','Redania'],katakan:['Toussaint','Nilfgaard','Temeria','Redania','Novigrad'],
    leshen:['Velen','Temeria','Redania','Kaedwen','Aedirn','Kovir'],rocktroll:['Kaedwen','Aedirn','Kovir','Skellige','Velen'],
    slyzard:['Aedirn','Kaedwen','Kovir','Skellige'],wyvern:['Aedirn','Kaedwen','Kovir','Skellige','Velen'],cockatrice:['Temeria','Velen','Aedirn','Redania','Nilfgaard'],
    bear:['Temeria','Velen','Redania','Kaedwen','Aedirn','Kovir','Skellige'],boar:['Temeria','Velen','Redania','Aedirn','Nilfgaard','Toussaint'],panther:['Nilfgaard','Toussaint','Zerrikania']
  }),
  options(foeId){const pool=this.pools[foeId];if(!pool)return this.regions;const allowed=new Set(['random',...pool]);return this.regions.filter(r=>allowed.has(r.id))},
  resolve(foeId,requested='random'){
    const opts=this.options(foeId),valid=opts.some(r=>r.id===requested)?requested:'random';
    if(valid!=='random')return valid;
    const pool=this.pools[foeId]||this.fallbackPool(foeId);return pick(pool);
  },
  fallbackPool(foeId){
    const family=EncounterCatalog?.family?.(foeId)||Registry.bestiary.get(foeId)?.family||'Monster';
    if(family==='Beast')return['Temeria','Velen','Redania','Kaedwen','Aedirn','Kovir','Skellige','Nilfgaard'];
    if(/Draconid/i.test(family))return['Aedirn','Kaedwen','Kovir','Skellige','Zerrikania'];
    if(/Vampire/i.test(family))return['Toussaint','Nilfgaard','Temeria','Redania','Novigrad'];
    return['Temeria','Velen','Redania','Kaedwen','Aedirn','Kovir','Nilfgaard','Skellige','Toussaint'];
  },
  nameRegion(id){return this.regions.find(r=>r.id===id)?.nameRegion||'Temeria'},
  label(id){return this.regions.find(r=>r.id===id)?.label||id}
});

const EncounterCatalog = Object.freeze({
  categories: Object.freeze([
    { id:'outlaws', label:'Bandits & Gangs', foes:['bandit'] },
    { id:'military', label:'Soldiers, Knights & Cavalry', foes:['soldier','knight','cavalry','lord'] },
    { id:'faith', label:'Eternal Fire & Witch Hunters', foes:['witchhunter','templeguard','inquisitor'] },
    { id:'humanoids', label:'Mages & Scoia’tael', foes:['scoiatael','mage'] },
    { id:'necrophages', label:'Necrophages', foes:['drowner','ghoul','gravehag','bullvore','foglet','rotfiend'] },
    { id:'specters', label:'Specters', foes:['wraith','noonwraith','barghest','hym','pesta','penitent'] },
    { id:'cursed', label:'Cursed Ones', foes:['werewolf','archespore','botchling','vendigo'] },
    { id:'relicts', label:'Relicts', foes:['chort','fiend','godling','leshen','shaelmaar'] },
    { id:'draconids', label:'Draconids', foes:['slyzard','wyvern','cockatrice','phoenix','truedragon'] },
    { id:'hybrids', label:'Hybrids', foes:['siren','griffin','harpy','manticore','succubus'] },
    { id:'insectoids', label:'Insectoids', foes:['endrega','arachas','barbegazi','frightener','giantcentipede'] },
    { id:'elementa', label:'Elementa & Constructs', foes:['golem','earthelemental','fireelemental','iceelemental','livingarmor','corpseamalgam'] },
    { id:'ogroids', label:'Ogroids', foes:['nekker','rocktroll','cyclops','knocker'] },
    { id:'vampires', label:'Vampires', foes:['katakan','bruxa','garkain','plumard','highervampire'] },
    { id:'demons', label:'Demons & Dark Creations', foes:['bes','casglydd','marilwyd'] },
    { id:'animals', label:'Animals, Dogs & Mounts', foes:['dog','horse','warhorse','bear','boar','panther'] }
  ]),
  special: Object.freeze({
    bandit:{name:'Bandit / Gang',family:'Human'},
    soldier:{name:'Soldier',family:'Human'},
    knight:{name:'Knight',family:'Human'},
    cavalry:{name:'Mounted Cavalry',family:'Human'},
    lord:{name:'Lord / Noble',family:'Human'},
    witchhunter:{name:'Witch Hunter',family:'Human'},
    templeguard:{name:'Temple Guard',family:'Human'},
    inquisitor:{name:'Eternal Fire Inquisitor',family:'Human'},
    mage:{name:'Mage',family:'Human'}
  }),
  hasFoe(id){return !!this.special[id]||Registry.bestiary.has(id)},
  category(id){return this.categories.find(c=>c.id===id)||this.categories[0]},
  foes(id){return this.category(id).foes.filter(foe=>this.hasFoe(foe))},
  name(id){return this.special[id]?.name||Registry.bestiary.get(id)?.name||id},
  family(id){return this.special[id]?.family||Registry.bestiary.get(id)?.family||'Enemy'},
  variants(id){
    if(id==='bandit')return [
      ['random','Random gang member'],['rabble','Roadside rabble'],['standard','Bandit'],['veteran','Veteran outlaw'],['cutpurse','Cutpurse / knife fighter'],['bruiser','Bruiser'],['poacher','Poacher / archer'],['deserter','Deserter'],['enforcer','Gang enforcer'],['boss','Gang boss']
    ];
    if(id==='soldier')return [['random','Random soldier'],['infantry','Infantry'],['shield','Shield fighter'],['spearman','Spearman'],['halberdier','Halberdier'],['archer','Archer'],['arbalist','Arbalist'],['veteran','Veteran soldier']];
    if(id==='knight')return [['random','Random knight'],['foot','Foot knight'],['shield','Sword & shield'],['greatweapon','Great-weapon knight'],['mounted','Mounted knight'],['lancer','Lancer']];
    if(id==='cavalry')return [['random','Random cavalry'],['scout','Mounted scout'],['horseman','Horseman'],['lancer','Lancer'],['heavy','Heavy cavalry']];
    if(id==='lord')return [['random','Random noble'],['courtly','Courtly noble'],['duelist','Duelist'],['hunter','Noble hunter'],['warVeteran','War veteran'],['knightLord','Knightly lord']];
    if(id==='witchhunter')return [['random','Random witch hunter'],['hunter','Hunter'],['arbalist','Arbalist'],['swordsman','Swordsman'],['veteran','Veteran hunter'],['captain','Witch hunter captain']];
    if(id==='templeguard')return [['random','Random temple guard'],['guard','Guard'],['shield','Shield guard'],['polearm','Polearm guard'],['veteran','Veteran guard']];
    if(id==='inquisitor')return [['random','Random inquisitor'],['interrogator','Interrogator'],['hunter','Field inquisitor'],['veteran','Senior inquisitor']];
    if(id==='scoiatael')return [['random','Random commando role'],['archer','Archer'],['sword','Sword fighter'],['spear','Spear fighter'],['veteran','Vrihedd veteran']];
    if(id==='mage')return [
      ['random','Random mage archetype'],['fire','Fire mage'],['ice','Ice / water mage'],['air','Air / storm mage'],['earth','Earth mage'],
      ['illusion','Illusion / mind mage'],['support','Healing / warding mage'],['battlemage','Battlemage'],['necromancer','Necromancer'],['master','Master mage']
    ];
    if(id==='truedragon')return [
      ['random','Random age'],['age:Young','Young'],['age:Young Adult','Young Adult'],['age:Adult','Adult'],['age:Elder','Elder']
    ];
    if(id==='highervampire')return [['random','Random higher vampire'],['age:Young','Young'],['age:Young Adult','Young Adult'],['age:Adult','Adult']];
    return [['random','Random allowed variance'],['source','Source / typical'],['runt','Young / runt'],['large','Large / seasoned'],['scarred','Scarred veteran'],['wounded','Already wounded'],['aggressive','Aggressive'],['cautious','Cautious'],['alpha','Dominant / alpha']];
  },
  experienceOptions(id){
    if(['bandit','soldier','knight','cavalry','lord','witchhunter','templeguard','inquisitor','mage','scoiatael'].includes(id))return [['random','Random appropriate'],['novice','Green / novice'],['trained','Trained'],['veteran','Veteran'],['elite','Elite'],['master','Master / exceptional']];
    return [['source','Source profile']];
  },
  loadouts(id){
    const map={
      bandit:[['random','Random plausible'],['blade','Blade'],['axe','Axe / mace'],['spear','Spear / polearm'],['bow','Bow'],['crossbow','Crossbow'],['shield','Sword & shield']],
      soldier:[['random','Issued / regional'],['blade','Sword'],['shield','Sword & shield'],['spear','Spear'],['polearm','Polearm'],['bow','Bow'],['crossbow','Crossbow']],
      knight:[['random','Knightly kit'],['shield','Sword & shield'],['greatblade','Two-handed blade'],['heavy','Heavy weapon'],['lance','Mounted lance / spear']],
      cavalry:[['random','Mounted regional kit'],['spear','Spear / lance'],['blade','Sword'],['bow','Mounted bow'],['crossbow','Mounted crossbow']],
      lord:[['random','Personal arms'],['duelist','Fine blade'],['hunter','Hunting bow'],['war','War gear']],
      witchhunter:[['random','Hunter kit'],['crossbow','Crossbow & blade'],['sword','Sword'],['polearm','Polearm']],
      templeguard:[['random','Temple issue'],['shield','Sword & shield'],['polearm','Polearm'],['crossbow','Crossbow']],
      inquisitor:[['random','Inquisitorial kit'],['mace','Mace'],['crossbow','Crossbow'],['sword','Sword']],
      mage:[['random','Random combat style'],['focus','Staff focus'],['sword','Sword mage'],['greatblade','Great-blade mage'],['spear','Spear / staff mage'],['shield','Shield battlemage'],['ranged','Ranged weapon + focus']],
      scoiatael:[['random','Commando kit'],['bow','Bow & sidearm'],['sword','Sword'],['spear','Spear']]
    };return map[id]||[['source','Source / natural']]
  },
  allowsExperience(id){return this.experienceOptions(id).length>1},
  allowsLoadout(id){return this.loadouts(id).length>1},
  subtypes(id){
    if(id==='truedragon')return [['random','Random subspecies'],['green','Green Dragon'],['red','Red Dragon'],['black','Black Dragon'],['brown','Brown Dragon'],['white','White Dragon']];
    return [['random','Default']];
  },
  subtypeLabel(id,value){return this.subtypes(id).find(([key])=>key===value)?.[1]||value},
  variantLabel(id,value){return this.variants(id).find(([key])=>key===value)?.[1]||value}
});

const VariantService = Object.freeze({
  genericKeys:Object.freeze(['source','source','source','runt','large','scarred','wounded','aggressive','cautious','alpha']),
  resolve(foeId,variant){if(variant!=='random')return variant;if(['bandit','soldier','knight','cavalry','lord','witchhunter','templeguard','inquisitor','scoiatael','mage','truedragon','highervampire'].includes(foeId))return 'random';return pick(this.genericKeys)},
  creationOverrides(foeId,variant){
    const out={};
    if(foeId==='truedragon'){
      if(variant.startsWith('dragon:'))out.forcedDragonType=variant.split(':')[1];
      if(variant.startsWith('age:'))out.forcedAgeBand=variant.slice(4);
    }
    if(foeId==='highervampire'&&variant.startsWith('age:'))out.forcedAgeBand=variant.slice(4);
    return out;
  },
  apply(actor,foeId,variant){
    if(['bandit','soldier','knight','cavalry','lord','witchhunter','templeguard','inquisitor','scoiatael','mage','truedragon','highervampire'].includes(foeId)){actor.variance=EncounterCatalog.variantLabel(foeId,variant);return actor}
    const key=this.resolve(foeId,variant),rules={
      source:{hp:1,sta:1,attack:0,defense:0,armor:0,courage:0,label:'Source / typical'},
      runt:{hp:.72,sta:.85,attack:-1,defense:-1,armor:-1,courage:-1,label:'Young / runt'},
      large:{hp:1.22,sta:1.12,attack:1,defense:0,armor:2,courage:1,label:'Large / seasoned'},
      scarred:{hp:1.1,sta:1.08,attack:1,defense:1,armor:0,courage:2,label:'Scarred veteran',experience:'veteran'},
      wounded:{hp:1,sta:.85,attack:0,defense:0,armor:0,courage:-1,label:'Already wounded',currentHp:.55},
      aggressive:{hp:1,sta:1,attack:1,defense:-1,armor:0,courage:1,label:'Aggressive'},
      cautious:{hp:1,sta:1.05,attack:-1,defense:1,armor:0,courage:1,label:'Cautious'},
      alpha:{hp:1.35,sta:1.18,attack:2,defense:1,armor:2,courage:3,label:'Dominant / alpha',experience:'veteran'}
    },r=rules[key]||rules.source;
    actor.maxHp=Math.max(1,Math.round(actor.maxHp*r.hp));actor.hp=Math.min(actor.maxHp,Math.max(1,Math.round(actor.maxHp*(r.currentHp||1))));
    actor.maxSta=Math.max(1,Math.round(actor.maxSta*r.sta));actor.sta=Math.min(actor.maxSta,actor.maxSta);actor.attack=Math.max(1,actor.attack+r.attack);
    for(const d of Object.keys(actor.defenses||{}))actor.defenses[d]=Math.max(1,actor.defenses[d]+r.defense);
    actor.armor=Math.max(0,(actor.armor||0)+r.armor);actor.morale.courage=Math.max(1,actor.morale.courage+r.courage);if(r.experience)actor.ai.experience=r.experience;
    if(key==='aggressive'){actor.morale.surrender=Math.max(0,actor.morale.surrender-.12);actor.preferredRange=Math.min(actor.preferredRange||2,2)}
    if(key==='cautious')actor.preferredRange=Math.max(actor.preferredRange||2,4);
    if(key==='alpha')actor.morale.surrender=Math.max(0,actor.morale.surrender-.15);
    actor.variance=r.label;return actor;
  }
});





const TravelHistoryService=Object.freeze({
  regions:['Temeria','Redania','Kaedwen','Aedirn','Kovir','Nilfgaard','Skellige','Toussaint'],
  other(current){const pool=this.regions.filter(x=>x!==current);return pick(pool)},
  event(age,from,to,stage){
    const causes=stage==='child'
      ?['the family moved for seasonal or guild work','fighting reached the district and the household fled','a parent found steadier work elsewhere','the child was sent to relatives or another household','the family followed a military camp or supply road']
      :stage==='teen'
        ?['an apprenticeship or service took them away from home','they followed a caravan or military column','they ran from a family dispute','local fighting or hunger pushed them onto the road','they entered armed service unusually young']
        :['work, trade, or a contract took them across the border','military service shifted them with a unit','they followed family or a spouse','they fled debt, law, or a feud','they joined a caravan, company, or patron household'];
    return`Age ${age} — Moved from ${from} to ${to}; ${pick(causes)}.`
  },
  build(identity,currentRegion,archetype='soldier'){
    if(!identity?.age||identity.region==='Aen Seidhe')return[];
    const age=identity.age,birth=currentRegion&&Dice.d(100)<=58?currentRegion:this.other(currentRegion||'Temeria'),events=[];let place=birth;
    if(age>=6&&Dice.d(100)<=38){const at=6+Dice.d(Math.min(6,age-5))-1,to=this.other(place);events.push(this.event(at,place,to,'child'));place=to}
    if(age>=13&&Dice.d(100)<=45){const span=Math.max(1,Math.min(5,age-12)),at=12+Dice.d(span),to=this.other(place);events.push(this.event(at,place,to,'teen'));place=to}
    const adultMoves=Math.min(3,Math.floor(Math.max(0,age-18)/15));for(let i=0;i<adultMoves;i++){if(Dice.d(100)>35)continue;const at=Math.min(age-1,19+i*15+Dice.d(Math.max(1,Math.min(10,age-(19+i*15))))-1),to=this.other(place);events.push(this.event(at,place,to,'adult'));place=to}
    if(place!==currentRegion&&currentRegion){const why={bandit:'joined an outlaw band operating there',soldier:'was posted or hired there',knight:'entered service or traveled with a household there',cavalry:'rode there with a military or mercenary unit',lord:'took up residence, estate business, or political travel there',witchhunter:'followed warrants and church business there',templeguard:'entered temple service there',inquisitor:'was assigned church investigations there',mage:'followed research, patronage, or magical business there',scoiatael:'moved with a commando there'}[archetype]||'work and circumstance brought them there';events.push(`Age ${Math.max(16,age-Dice.d(Math.min(8,Math.max(1,age-15)))+1)} — Reached ${currentRegion}; ${why}.`)}
    return[`Birthplace: ${birth}.`,...events.sort((a,b)=>(Number(a.match(/Age (\d+)/)?.[1]||0)-Number(b.match(/Age (\d+)/)?.[1]||0))),`Current operating region: ${currentRegion}.`]
  }
});
const ActorComposer=Object.freeze({
  experienceRank(id,role){if(id&&id!=='random')return id;const weights=role==='lord'||role==='knight'?['trained','trained','veteran','veteran','elite']:role==='mage'?['trained','trained','veteran','elite']:['novice','trained','trained','trained','veteran','veteran','elite'];return pick(weights)},
  experienceMods(rank){return({novice:{hp:-8,atk:-2,def:-2,sta:-5,courage:-2},trained:{hp:0,atk:0,def:0,sta:0,courage:0},veteran:{hp:5,atk:2,def:2,sta:5,courage:2},elite:{hp:8,atk:3,def:3,sta:10,courage:3},master:{hp:10,atk:4,def:4,sta:15,courage:4}})[rank]||{hp:0,atk:0,def:0,sta:0,courage:0}},
  regionalPool(region){return Registry.loadoutPools.get('regionalHumanoid').roles[region]||Registry.loadoutPools.get('regionalHumanoid').roles.Temeria},
  pickWeapon(region,type='blade'){const pool=this.regionalPool(region)[type]||this.regionalPool(region).blade;return pick(pool.filter(id=>Registry.weapons.has(id)))},
  resolveLoadout(archetype,requested,region,variant){
    const load=requested&&requested!=='random'?requested:'random';let weapon='armingSword',sidearm='dagger',ammo=0,preferredRange=2,shield=false;
    const choose=(kind)=>this.pickWeapon(region,kind);
    const ranged=(kind)=>{weapon=choose(kind);sidearm=choose('blade');ammo=kind==='ranged'||weapon==='longBow'||weapon==='warBow'?12:10;preferredRange=16};
    if(archetype==='mage'){
      const styles=Registry.loadoutPools.get('mageCombat').roles,style=load==='random'?pick(['focus','focus','focus','focus','sword','greatblade']):load;
      if(style==='focus'){weapon=pick(styles.focus.filter(id=>Registry.weapons.has(id)));sidearm='dagger';preferredRange=12}
      else if(style==='sword'){weapon=pick(styles.sword.filter(id=>Registry.weapons.has(id)));sidearm='dagger';preferredRange=5}
      else if(style==='greatblade'){weapon=pick(styles.greatblade.filter(id=>Registry.weapons.has(id)));sidearm='dagger';preferredRange=5}
      else if(style==='spear'){weapon=pick(styles.spear.filter(id=>Registry.weapons.has(id)));sidearm='dagger';preferredRange=6}
      else if(style==='shield'){weapon=choose('blade');sidearm='dagger';shield=true;preferredRange=5}
      else{ranged('ranged')}
      return{style,weapon,sidearm,ammo,preferredRange,shield}
    }
    let style=load;
    if(style==='random'){
      const byArchetype={bandit:['blade','blade','axe','spear','bow','crossbow'],soldier:['shield','spear','polearm','crossbow','blade'],knight:['shield','greatblade','heavy'],cavalry:['lance','lance','spear','blade','bow'],lord:['duelist','hunter','war'],witchhunter:['crossbow','crossbow','sword','polearm'],templeguard:['shield','polearm','crossbow'],inquisitor:['mace','crossbow','sword'],scoiatael:['bow','bow','sword','spear']};style=pick(byArchetype[archetype]||['blade'])
    }
    if(style==='blade'||style==='sword'||style==='duelist'){weapon=choose('blade');sidearm='dagger'}
    else if(style==='axe'||style==='heavy'||style==='mace'){weapon=choose('heavy');sidearm='dagger'}
    else if(style==='greatblade'){const pool=(region==='Toussaint'?['flamberge','viroledanBlade']:['torrwr','vicovarian']).filter(id=>Registry.weapons.has(id));weapon=pick(pool);sidearm='dagger'}
    else if(style==='lance'){weapon='warLance';sidearm=choose('blade');preferredRange=3}
    else if(style==='spear'||style==='polearm'){weapon=choose('pole');sidearm=choose('blade')}
    else if(style==='shield'){weapon=choose('blade');sidearm='dagger';shield=true}
    else if(style==='bow'||style==='hunter'){ranged('ranged')}
    else if(style==='crossbow'){weapon='crossbow';sidearm=choose('blade');ammo=10;preferredRange=16}
    else if(style==='war'){weapon=choose('heavy');sidearm=choose('blade')}
    return{style,weapon,sidearm,ammo,preferredRange,shield}
  },
  clothing(region,archetype,wealth=1){
    const colors={Temeria:['blue','white','mud-brown'],Redania:['red','white','charcoal'],Kaedwen:['black','ochre','dark green'],Aedirn:['yellow','green','brown'],Kovir:['deep blue','grey','wine'],Nilfgaard:['black','gold','dark grey'],Skellige:['wool grey','sea blue','rust red'],Toussaint:['burgundy','blue','cream','gold'],Zerrikania:['indigo','red','sand','black']}[region]||['brown','grey','faded blue'];
    const wear=wealth>=3?pick(['well-tailored','well-maintained','decorated but practical']):wealth<=0?pick(['patched','rain-stained','mended repeatedly']):pick(['serviceable','faded','travel-worn']);
    const garment=archetype==='witchhunter'||archetype==='templeguard'||archetype==='inquisitor'?'quilted gambeson, belts and document pouches':archetype==='lord'?'tailored coat over practical armor pieces':archetype==='mage'?'layered travel clothing arranged around armor or a focus':archetype==='bandit'?'mismatched civilian clothing and stolen military pieces':'regional military clothing over armor';
    return`${wear} ${pick(colors)} ${garment}`
  },
  bag(archetype,region,wealth=1,mage=false){
    const base=['satchel','waterskin',`${2+Dice.d(5)} days of trail rations`,'flint and steel',pick(['10 m rope','20 m rope','bedroll','small lantern','two torches']),'small repair or sewing kit'];
    const role={bandit:['marked cards or dice','cheap spirits','spare cord','a stolen key'],soldier:['whetstone','bandage roll','unit token','spare bootlaces'],knight:['gloves','grooming cloth','seal wax','spare straps'],cavalry:['horse brush','feed bag','spare tack strap','cavalry gloves'],lord:['signet or household token','good gloves','writing kit','perfumed handkerchief'],witchhunter:['arrest warrants','parchment case','manacles or binding cord','Eternal Fire token'],templeguard:['temple token','torch','spare cord','duty roster'],inquisitor:['sealed warrants','notebook of names','branding or interrogation tools','Eternal Fire devotional token'],mage:['writing kit','component pouch','wax-sealed notes','focus wrapping'],scoiatael:['dry cord','spare bowstring','foraged herbs','small trophy from a patrol']}[archetype]||['wooden cup','small whetstone'];
    const nice=wealth>=3?[pick(['silver comb','fine tobacco','small book','jewelry pouch','quality perfume'])]:wealth<=0?[pick(['moldy heel of bread','empty purse','patched rag'])]:[];
    return[...base,...role,...nice,...mage?['spell component pouch']:[]]
  },
  template(archetype,variant){
    const role=variant==='random'?null:variant;
    const table={
      bandit:{hp:25,atk:13,def:12,armor:5,courage:10,surrender:.42,wealth:0,ai:'outlaw'},
      soldier:{hp:30,atk:14,def:14,armor:8,courage:13,surrender:.24,wealth:1,ai:'soldier'},
      knight:{hp:35,atk:16,def:16,armor:14,courage:16,surrender:.14,wealth:3,ai:'soldier'},
      cavalry:{hp:32,atk:15,def:14,armor:10,courage:14,surrender:.20,wealth:2,ai:'soldier'},
      lord:{hp:28,atk:12,def:12,armor:8,courage:12,surrender:.35,wealth:4,ai:'soldier'},
      witchhunter:{hp:30,atk:15,def:14,armor:8,courage:15,surrender:.18,wealth:1,ai:'soldier'},
      templeguard:{hp:35,atk:15,def:15,armor:12,courage:16,surrender:.14,wealth:1,ai:'soldier'},
      inquisitor:{hp:30,atk:13,def:14,armor:8,courage:16,surrender:.20,wealth:2,ai:'soldier'},
      mage:{hp:30,atk:12,def:14,armor:0,courage:13,surrender:.18,wealth:3,ai:'mageExpert'},
      scoiatael:{hp:28,atk:15,def:14,armor:5,courage:14,surrender:.24,wealth:1,ai:'skirmisher'}
    };return{...table[archetype],role}
  },
  create(archetype,region,{variant='random',experience='random',loadout='random',mageSchool=null,spells=null}={}){
    if(archetype==='scoiatael')region='Aen Seidhe';const baseRegion=region==='Aen Seidhe'?'Aedirn':region,tmpl=this.template(archetype,variant),rank=this.experienceRank(experience,archetype),mods=this.experienceMods(rank),resolvedVariant=variant==='random'?pick(Registry.actorArchetypes.get(archetype)?.variants?.filter(x=>x!=='random')||['standard']):variant;
    let requestedLoadout=loadout;
    if(requestedLoadout==='random'){
      const variantMap={arbalist:'crossbow',archer:'bow',poacher:'bow',shield:'shield',spearman:'spear',halberdier:'polearm',swordsman:'sword',cutpurse:'sword',bruiser:'axe',deserter:'random',enforcer:'heavy',boss:'random',mounted:'lance',lancer:'lance',greatweapon:'greatblade',hunter:'hunter',duelist:'duelist',warVeteran:'war',knightLord:'war',polearm:'polearm',guard:'shield',interrogator:'mace',captain:'crossbow',spear:'spear'};requestedLoadout=variantMap[resolvedVariant]||'random'
    }
    const kit=this.resolveLoadout(archetype,requestedLoadout,baseRegion,resolvedVariant),mounted=archetype==='cavalry'||['mounted','lancer'].includes(resolvedVariant),mountType=mounted?(resolvedVariant==='heavy'||archetype==='knight'?'warhorse':pick(['horse','warhorse'])):null;
    let hp=Math.max(15,tmpl.hp+mods.hp),sta=Math.max(20,30+mods.sta),armor=Math.max(0,tmpl.armor+(kit.shield?2:0));if(archetype==='lord'&&['warVeteran','knightLord'].includes(resolvedVariant)){hp+=7;armor+=6}
    if(archetype==='bandit'&&resolvedVariant==='rabble'){hp=15;armor=Math.max(0,armor-3)}if(archetype==='bandit'&&['veteran','boss'].includes(resolvedVariant)){hp+=5;armor+=2}
    if(archetype==='mage'&&['battlemage','master'].includes(mageSchool||resolvedVariant)){armor=(mageSchool||resolvedVariant)==='battlemage'?8:Math.max(armor,3)}
    const faction={bandit:'Bandit',soldier:`${baseRegion} Soldier`,knight:`${baseRegion} Knight`,cavalry:`${baseRegion} Cavalry`,lord:`${baseRegion} Noble`,witchhunter:'WitchHunter',templeguard:'EternalFire',inquisitor:'EternalFire',mage:'Mage',scoiatael:'Scoiatael'}[archetype];
    const stats={INT:archetype==='mage'?8:archetype==='lord'?7:5,REF:Math.max(3,7+Math.min(2,mods.atk)),DEX:Math.max(3,7+Math.min(2,mods.def)),BODY:archetype==='knight'?7:6,SPD:mounted?7:6,EMP:archetype==='lord'?7:archetype==='mage'?6:5,CRA:5,WILL:archetype==='mage'?9:archetype==='inquisitor'?8:6,STUN:archetype==='knight'?8:6};
    const spec={archetype,name:Registry.actorArchetypes.get(archetype)?.name||archetype,family:'Human',genderRule:'human',region:region,stats,hp,maxHp:hp,maxSta:sta,armor,attack:Math.max(8,tmpl.atk+mods.atk),defenses:{dodge:Math.max(8,tmpl.def+mods.def),reposition:Math.max(8,tmpl.def+mods.def),block:Math.max(8,tmpl.def+mods.def+(kit.shield?2:0)),magic:archetype==='mage'?16+Math.max(0,mods.def):11+Math.max(0,mods.def)},weaponId:kit.weapon,sidearmId:kit.sidearm,preferredRange:kit.preferredRange,ammo:kit.ammo,loaded:true,surrender:tmpl.surrender,courage:Math.max(6,tmpl.courage+mods.courage),faction,experience:rank,rideBase:mounted?Math.max(10,13+mods.atk):null,aiProfileId:tmpl.ai,mage:archetype==='mage',mageSchool,spells,skills:archetype==='mage'?{'Spell Casting':Math.max(10,16+mods.atk)}:undefined};
    const actor=baseActor(spec);actor.archetype=archetype;actor.role=resolvedVariant;actor.loadoutStyle=kit.style;actor.experienceRank=rank;actor.shieldEquipped=kit.shield;actor.appearance={clothing:this.clothing(baseRegion,archetype,tmpl.wealth),colors:'regional mix',armorCondition:pick(['well maintained','serviceable','scuffed','field-repaired'])};actor.carriedBag=this.bag(archetype,baseRegion,tmpl.wealth,archetype==='mage');actor.mount=mountType?this.makeMount(mountType):null;actor.mounted=!!actor.mount;actor.rideBase=spec.rideBase;actor.combatDoctrines=[...(actor.combatDoctrines||[]),...(mounted?['soldier']:[]),...(archetype==='knight'?['duelist']:[])];
    // Career and loadout are real history hooks, not just labels.
    actor.history.push(`Current role: ${Registry.actorArchetypes.get(archetype)?.name||archetype}; ${rank} experience; ${kit.style} loadout.`);if(mounted)actor.history.push(`Mounted service: rides a ${actor.mount.name.toLowerCase()} with practical tack and carries a long-reach weapon for mounted work.`);if(archetype==='witchhunter'||archetype==='templeguard'||archetype==='inquisitor')actor.history.push('Affiliation: the Eternal Fire network; papers, warrants, and field equipment reflect that service.');
    return actor
  },
  makeMount(id){const m=Registry.mountProfiles.get(id);return{id,name:m.name,hp:m.hp,maxHp:m.hp,sta:m.sta,maxSta:m.sta,rec:m.rec,controlMod:m.controlMod,athletics:m.athletics,stats:Core.clone(m.stats),attack:m.attack,damage:m.damage,statuses:{},armor:0}}
});
const EncounterFactory={
  applyRegion(actor,foeId,region){
    actor.encounterRegion=region;
    actor.region=region;
    if(actor.identity)actor.identity.encounterRegion=region;
    return actor
  },
  monster(id,variant='source',options={}){
    const profile=Registry.bestiary.get(id);if(!profile)throw new Error(`Missing bestiary ${id}`);
    const resolved=VariantService.resolve(id,variant),region=EncounterRegionService.resolve(id,options.region||'random'),overrides=VariantService.creationOverrides(id,resolved);
    if(id==='truedragon'&&options.subtype&&options.subtype!=='random')overrides.forcedDragonType=options.subtype;
    const actor=baseActor({...profile,id:undefined,creatureKey:id,region:EncounterRegionService.nameRegion(region),forcedLairRegion:EncounterRegionService.label(region),...overrides});
    this.applyRegion(actor,id,region);
    return VariantService.apply(actor,id,resolved);
  },
  foe(id,variant='random',options={}){
    const resolved=VariantService.resolve(id,variant),region=EncounterRegionService.resolve(id,options.region||'random'),nameRegion=EncounterRegionService.nameRegion(region);
    const humanArchetypes=['soldier','knight','cavalry','lord','witchhunter','templeguard','inquisitor'];
    if(humanArchetypes.includes(id)){const actor=ActorComposer.create(id,nameRegion,{variant:resolved,experience:options.experience||'random',loadout:options.loadout||'random'});actor.variance=EncounterCatalog.variantLabel(id,resolved);return this.applyRegion(actor,id,region)}
    if(id==='bandit'){
      const actor=ActorComposer.create('bandit',nameRegion,{variant:resolved,experience:options.experience||'random',loadout:options.loadout||'random'});actor.variance=EncounterCatalog.variantLabel(id,resolved);return this.applyRegion(actor,id,region);
    }
    if(id==='scoiatael'){
      const actor=ActorComposer.create('scoiatael','Aen Seidhe',{variant:resolved,experience:options.experience||'random',loadout:options.loadout||'random'});actor.variance=EncounterCatalog.variantLabel(id,resolved);return this.applyRegion(actor,id,region);
    }
    if(id==='mage'){
      const school=resolved==='random'?pick(['fire','ice','air','earth','illusion','support','battlemage']):resolved;const rank=school==='master'?'master':options.experience||'random';
      const actor=ActorComposer.create('mage',nameRegion,{variant:resolved,experience:rank,loadout:options.loadout||'random',mageSchool:school,spells:mageSpellsForSchool(school)});actor.mage.school=mageSchoolLabel(school);actor.variance=EncounterCatalog.variantLabel(id,resolved==='random'?school:resolved);return this.applyRegion(actor,id,region);
    }
    return this.monster(id,resolved,{...options,region});
  },
  finalize(enemies){const out=enemies.map(e=>({...e,id:`enemy-${nextId++}`,pos:{x:0,y:0}}));ensureUniqueNames(out);for(const e of out)e.loot=LootService.generate(e);return out},
  build(lineup){const enemies=[];for(const row of lineup||[]){const quantity=Math.max(1,Math.min(20,Number(row.quantity)||1));for(let i=0;i<quantity;i++)enemies.push(this.foe(row.foe,row.variant||'random',{region:row.region||'random',subtype:row.subtype||'random',experience:row.experience||'random',loadout:row.loadout||'random'}))}return this.finalize(enemies)},
  make(key){
    const presets={
      bandits:[{foe:'bandit',variant:'random',region:'random',quantity:3}],
      scoiatael:[{foe:'scoiatael',variant:'random',region:'random',quantity:3}],
      troll:[{foe:Registry.bestiary.has('rocktroll')?'rocktroll':'troll',variant:'source',region:'random',quantity:1}],
      bear:[{foe:'bear',variant:'source',region:'random',quantity:1}],
      leshen:[{foe:'leshen',variant:'source',region:'random',quantity:1}],
      slyzard:[{foe:'slyzard',variant:'source',region:'random',quantity:1}],
      higherVampire:[{foe:'highervampire',variant:'random',region:'random',quantity:1}],
      trueDragon:[{foe:'truedragon',variant:'random',region:'random',subtype:'random',quantity:1}],
      mage:[{foe:'mage',variant:'random',region:'random',quantity:1},{foe:'bandit',variant:'shieldman',region:'random',quantity:1},{foe:'bandit',variant:'arbalist',region:'random',quantity:1}],
      construct:[{foe:'livingarmor',variant:'source',region:'random',quantity:1}]
    };
    return this.build(presets[key]||[{foe:'bandit',variant:'random',region:'random',quantity:1}])
  }
};
function human(role,region,extra={}){
  if(region==='Aen Seidhe')return ActorComposer.create('scoiatael','Aen Seidhe',{variant:role==='archer'?'archer':'sword',experience:extra.experience||'trained',loadout:role==='archer'?'bow':'sword'});
  const archetype=extra.faction==='Bandit'?'bandit':extra.mage||role==='mage'?'mage':'soldier',variant=role==='arbalist'?'arbalist':role==='shieldman'?'shield':role==='archer'?'archer':role==='sword'?'infantry':'standard';
  return ActorComposer.create(archetype,region,{variant,experience:extra.experience||'trained',loadout:role==='arbalist'?'crossbow':role==='archer'?'bow':role==='shieldman'?'shield':'random',mageSchool:extra.mageSchool,spells:extra.spells});
}
function mageSchoolLabel(key){return({fire:'Fire',ice:'Ice / Water',air:'Air / Storm',earth:'Earth',illusion:'Illusion / Mind',support:'Healing / Warding',battlemage:'Battlemage',necromancer:'Necromancer',master:'Master Mage'})[key]||'Generalist'}
function mageSpellsForSchool(key){const sets={
  fire:['Aenye','Wave of Fire','Tanio Ilchar','Flaming Vortex','Fire From the Sky'],
  ice:['Rhewi','Hailstrike','Ice Slick','Anialwch','Tryferi Gaeaf'],
  air:['Buffeting Gust','Static Storm','Zephyr','Thunderbolt','Suffocate','Lightning Storm'],
  earth:['Earthen Spike','Blinding Dust','Binding Roots','Earthshake','Transmutation'],
  illusion:['Mirror Ward','Mind Manipulation','Illusion','Teleportation','Mental Command','Suffocate'],
  support:['Magic Healing','Magic Screen','Mirror Ward','Teleportation','Aenye'],
  battlemage:['Aenye','Earthen Spike','Buffeting Gust','Magic Screen','Teleportation'],
  necromancer:['Storm of Souls','Corpse Restoration','Suffocate','Mental Command','Magic Screen'],
  master:['Fire From the Sky','Tryferi Gaeaf','Lightning Storm','Transmutation','Mental Command','Magic Healing','Magic Screen','Teleportation']
};return(sets[key]||sets.support).filter(x=>MAGE_SPELL_CATALOG[x])}
function mageSpellsFor(){return mageSpellsForSchool('support')}
function ensureUniqueNames(list){const used=new Set();for(const e of list){let base=e.name||e.baseName||'Opponent',candidate=base,n=1;while(used.has(candidate.toLowerCase())){const identity=LifeHistoryService.createIdentity({name:e.baseName,family:e.family,faction:e.faction,region:e.identity?.region,gender:e.gender,genderRule:e.gender==='None'?'none':'biological',exceptional:e.exceptional,forcedAgeBand:e.ageBand,forcedDragonType:e.variantKey});candidate=identity.name&&identity.name!==base?identity.name:`${base} ${++n}`;if(n>20){candidate=`${base} ${Dice.d(999)}`;break}}e.name=candidate;if(e.identity)e.identity.name=candidate;used.add(candidate.toLowerCase())}}

const DialogueService=Object.freeze({
  voiceKey(e){return this.voiceKeys(e)[0]||null},
  voiceKeys(e){
    if(e.exceptional==='dragon')return['Dragon'];
    if(e.exceptional==='higherVampire')return['HigherVampire'];
    if(/troll/i.test(e.family)||/troll/i.test(e.baseName||''))return['Troll'];
    const keys=[];
    const factionKey={Scoiatael:'Scoiatael',Bandit:'Bandit',WitchHunter:'WitchHunter',EternalFire:'EternalFire'}[e.faction]||(/Knight/.test(e.faction||'')?'Knight':/Noble/.test(e.faction||'')?'Noble':null);if(factionKey)keys.push(factionKey);if(e.archetype==='bandit'&&String(e.encounterRegion||'').match(/Novigrad|Redania/))keys.unshift('Gang');
    if(e.family==='Beast'||e.gender==='None')return keys;
    if(e.family!=='Human'){
      if(/godling|succubus|incubus/i.test(`${e.creatureKey||''} ${e.baseName||''}`))keys.push('SapientMonster');
      return keys
    }
    const region=e.identity?.region||EncounterRegionService.nameRegion(e.encounterRegion)||e.region||'generic';
    if(Registry.voiceSets.has(region))keys.push(region);
    keys.push('generic');return[...new Set(keys)]
  },
  line(state,e,kind){
    for(const key of this.voiceKeys(e)){
      const set=Registry.voiceSets.get(key),pool=set?.lines?.[kind]||[];if(!pool.length)continue;
      state.battleMemory.linesUsed??={};const recent=e.ai?.memory?.recentLines||[];
      let choices=pool.filter(line=>(state.battleMemory.linesUsed[line]||0)<2&&!recent.includes(line));
      if(!choices.length)choices=pool.filter(line=>(state.battleMemory.linesUsed[line]||0)<2);if(!choices.length)continue;
      const line=pick(choices);state.battleMemory.linesUsed[line]=(state.battleMemory.linesUsed[line]||0)+1;
      if(e.ai){e.ai.memory??={};e.ai.memory.recentLines=[line,...recent.filter(x=>x!==line)].slice(0,4)}
      return line
    }
    return''
  }
});

const ReactionAssessmentService=Object.freeze({
  personality(actor){return Registry.personalityProfiles.get(actor?.personalityProfile)||Registry.personalityProfiles.get(actor?.ai?.experience==='veteran'?'disciplined':'cautious')||{discipline:.5,painTolerance:.5,talkativeness:.15}},
  assess(actor,result){
    const max=Math.max(1,Number(actor.maxHp)||1),dealt=Math.max(0,Number(result.dealt)||0),ratio=dealt/max,critical=!!(result.injury||result.critical),hpAfter=Number(result.hpAfter??actor.hp),fatal=!!actor.dead;
    let severity='impact';
    if(dealt>0&&ratio<=.05)severity='trivial';
    else if(dealt>0&&ratio<=.15)severity='minor';
    else if(dealt>0&&ratio<=.30)severity='moderate';
    else if(dealt>0)severity='severe';
    if(critical)severity='critical';
    if(hpAfter<=0&&!fatal)severity='deathState';
    if(fatal)severity='fatal';
    const anatomy=AnatomyService.location(actor,result.location),personality=this.personality(actor),armorHeld=dealt===0&&(result.armorAbsorbed>0||result.coverDamage>0),armorMostlyHeld=dealt>0&&result.raw>0&&dealt<=Math.max(1,result.raw*.2);
    return{severity,damage:dealt,ratio,critical:result.injury||result.critical||null,location:anatomy,armorHeld,armorMostlyHeld,hpBefore:result.hpBefore,hpAfter,discipline:personality.discipline??.5,painTolerance:personality.painTolerance??.5,talkativeness:personality.talkativeness??.15};
  }
});

const ReactionService=Object.freeze({
  sounds:{
    Human:{impact:['',''],trivial:['gives a short grunt.','draws a tight breath through the teeth.','makes almost no sound.'],minor:['grunts sharply.','hisses through clenched teeth.','lets out a brief pained sound.'],moderate:['grunts hard and fights the pain back.','gives a short involuntary cry.','gasps once before forcing the breath steady.'],severe:['cries out despite trying to keep control.','lets out a raw grunt that breaks into a gasp.','shouts once as the injury lands.'],critical:['screams before control snaps back into place.','lets out a sharp involuntary cry.','chokes out a ragged shout.'],deathState:['gasps raggedly as strength drops out.','makes a broken sound and struggles to stay conscious.'],fatal:['']},
    Beast:{impact:['snorts and fixes harder on the threat.'],trivial:['gives an irritated growl.','snarls and keeps pressing.'],minor:['yelps once and bares its teeth.','growls harshly through the pain.'],moderate:['bellows and recoils a step.','lets out a hard animal cry.'],severe:['roars in unmistakable pain.','howls and favors the injured side.'],critical:['screams like a badly wounded animal.','releases a full-throated roar of pain.'],deathState:['whines or snarls weakly as its legs begin to fail.'],fatal:['']},
    Draconid:{impact:['rasps in irritation.'],trivial:['hisses and snaps its jaws.'],minor:['gives a rough reptilian growl.'],moderate:['roars and recoils from the wound.'],severe:['bellows hard enough to shake the air.'],critical:['releases a harsh, piercing reptilian scream.'],deathState:['gives a broken rumble as its body sags.'],fatal:['']},
    Hybrid:{impact:['rasps and keeps its guard.'],trivial:['hisses sharply.'],minor:['screeches once.'],moderate:['answers with a furious roar.'],severe:['lets out a piercing cry.'],critical:['thrashes and shrieks in pain.'],deathState:['makes a ragged, failing sound.'],fatal:['']},
    Necrophage:{impact:['gurgles irritably.'],trivial:['gives a wet hiss.'],minor:['snarls through corpse-stiff jaws.'],moderate:['releases a graveyard shriek.'],severe:['howls with a broken, corpse-throated cry.'],critical:['screams in a ragged wail.'],deathState:['gurgles weakly as the body fails.'],fatal:['']},
    Specter:{impact:['flickers without a living cry.'],trivial:['keens faintly.'],minor:['releases a cold, distant wail.'],moderate:['shivers with a crypt-cold shriek.'],severe:['erupts in a piercing spectral scream.'],critical:['wails hard enough to set the teeth on edge.'],deathState:['fades in and out with a long dead cry.'],fatal:['']},
    Insectoid:{impact:['clatters its shell.'],trivial:['clicks its mandibles in irritation.'],minor:['chatters sharply.'],moderate:['emits a dry chittering shriek.'],severe:['thrashes with a sawing scream.'],critical:['clatters wildly as the wound tears open.'],deathState:['scrapes weakly against the ground.'],fatal:['']},
    Elementa:{impact:['rings or cracks under the impact.'],trivial:['rumbles faintly.'],minor:['answers with a grinding crack.'],moderate:['shudders with a deep elemental roar.'],severe:['erupts in a violent rumble.'],critical:['splits with a brutal crack and grinding boom.'],deathState:['destabilizes with a low failing rumble.'],fatal:['']},
    Construct:{impact:['answers only with the sound of material under force.'],trivial:['grinds without any living cry.'],minor:['rings and buckles.'],moderate:['shudders with a mechanical crack.'],severe:['breaks with a brutal grinding report.'],critical:['a major section fails with a violent crash.'],deathState:['sags as its working structure fails.'],fatal:['']},
    Vampire:{impact:['barely acknowledges the impact.'],trivial:['gives a thin irritated hiss.'],minor:['hisses sharply, the expression tightening.'],moderate:['lets out a restrained predatory snarl.'],severe:['a harsh sound escapes before it can be suppressed.'],critical:['releases a feral shriek and immediately fights for control.'],deathState:['breathes in a ragged, unnatural rhythm.'],fatal:['']}
  },
  familyKey(e){if(e.exceptional==='dragon')return'Draconid';const f=String(e.family||'Human');if(this.sounds[f])return f;if(/draconid/i.test(f))return'Draconid';if(/hybrid/i.test(f))return'Hybrid';if(/necro/i.test(f))return'Necrophage';if(/spect/i.test(f))return'Specter';if(/insect/i.test(f))return'Insectoid';if(/element/i.test(f))return'Elementa';if(/construct/i.test(f))return'Construct';if(/vamp/i.test(f))return'Vampire';return'Human'},
  physical(actor,a){
    const group=a.location.group,sev=a.severity,name=GrammarService.name(actor),poss=GrammarService.possessive(actor);
    if(a.armorHeld){const map={head:`The impact snaps ${name}'s head slightly, but the protection holds.`,torso:`The blow lands solidly against ${name}'s protection and fails to get through.`,arm:`The strike jars ${poss} ${a.location.label.toLowerCase()}, but armor catches it.`,leg:`The hit bumps ${poss} ${a.location.label.toLowerCase()} off line, but does not penetrate.`,limb:`The blow jars ${poss} ${a.location.label.toLowerCase()}, but protection holds.`,special:`The strike lands against ${poss} ${a.location.label.toLowerCase()} without getting through.`};return map[group]||map.special}
    const pools={
      head:{trivial:[`${name}'s head jerks a fraction, then steadies.`,`${name} blinks once and refocuses.`],minor:[`${name}'s head snaps aside before ${GrammarService.subject(actor)} resets ${poss} guard.`,`${name} blinks hard as the hit lands high.`],moderate:[`${name} reels half a step, vision visibly shaken for an instant.`],severe:[`${name}'s head whips aside and ${GrammarService.subject(actor)} staggers before recovering.`],critical:[`${name} reels from the head wound, balance and focus visibly compromised.`],deathState:[`${name}'s focus goes glassy as ${GrammarService.subject(actor)} struggles to remain upright.`],fatal:[`${name} goes slack under the fatal head trauma.`]},
      torso:{trivial:[`${name}'s posture tightens around the small wound.`],minor:[`${name} folds slightly around the hit, then forces ${GrammarService.reflexive(actor)} upright.`],moderate:[`The impact empties ${name}'s lungs and forces ${GrammarService.object(actor)} backward.`],severe:[`${name} doubles around the torso wound before dragging ${GrammarService.reflexive(actor)} back into guard.`],critical:[`${name}'s torso gives around the critical injury; breathing and posture both break down.`],deathState:[`${name}'s strength drains as the torso wound overwhelms ${GrammarService.object(actor)}.`],fatal:[`${name} collapses around the fatal torso wound.`]},
      arm:{trivial:[`${name}'s grip tightens after the nick to the ${a.location.label.toLowerCase()}.`],minor:[`${name} checks the ${a.location.label.toLowerCase()} and immediately brings it back into the fight.`],moderate:[`${name}'s ${a.location.label.toLowerCase()} dips under the hit before ${GrammarService.subject(actor)} wrestles it back into position.`],severe:[`${name} recoils around the badly hurt ${a.location.label.toLowerCase()}, the limb slow to answer.`],critical:[`${name}'s ${a.location.label.toLowerCase()} gives under the critical injury and stops working normally.`],deathState:[`${name} struggles to keep the injured ${a.location.label.toLowerCase()} useful as ${GrammarService.subject(actor)} fades.`],fatal:[`${name} collapses with the ruined ${a.location.label.toLowerCase()} hanging uselessly.`]},
      leg:{trivial:[`${name}'s step hitches after the hit to the ${a.location.label.toLowerCase()}.`],minor:[`${name} shifts weight off the ${a.location.label.toLowerCase()} for a heartbeat, then resets.`],moderate:[`${name}'s ${a.location.label.toLowerCase()} buckles briefly and ${GrammarService.subject(actor)} catches ${GrammarService.reflexive(actor)}.`],severe:[`${name} nearly goes down as the ${a.location.label.toLowerCase()} fails under ${GrammarService.object(actor)}.`],critical:[`${name}'s ${a.location.label.toLowerCase()} gives way under the critical injury and ${GrammarService.subject(actor)} crashes or catches ${GrammarService.reflexive(actor)} at the last instant.`],deathState:[`${name} sags as the injured ${a.location.label.toLowerCase()} can no longer reliably hold ${GrammarService.object(actor)}.`],fatal:[`${name} goes down with the destroyed ${a.location.label.toLowerCase()} beneath ${GrammarService.object(actor)}.`]},
      limb:{trivial:[`${name}'s ${a.location.label.toLowerCase()} twitches away from the hit.`],minor:[`${name} favors the ${a.location.label.toLowerCase()} for an instant.`],moderate:[`${name}'s ${a.location.label.toLowerCase()} gives ground under the wound.`],severe:[`${name} can no longer use the ${a.location.label.toLowerCase()} cleanly.`],critical:[`The critical wound compromises ${name}'s ${a.location.label.toLowerCase()} immediately.`],deathState:[`${name}'s injured ${a.location.label.toLowerCase()} begins to fail completely.`],fatal:[`${name} collapses as the damaged anatomy gives out.`]},
      special:{trivial:[`${name} reacts only slightly to the wound.`],minor:[`${name} checks the damaged ${a.location.label.toLowerCase()} and keeps fighting.`],moderate:[`${name}'s ${a.location.label.toLowerCase()} recoils under the injury.`],severe:[`The wound badly compromises ${name}'s ${a.location.label.toLowerCase()}.`],critical:[`The critical hit tears into ${name}'s ${a.location.label.toLowerCase()} and changes how ${GrammarService.subject(actor)} can move or fight.`],deathState:[`${name}'s body begins to fail around the injured ${a.location.label.toLowerCase()}.`],fatal:[`${name} collapses under the catastrophic injury.`]}
    };
    const list=(pools[group]||pools.special)[sev]||(pools[group]||pools.special).minor;return pick(list)
  },
  vocal(actor,a){const family=this.familyKey(actor),profile=ReactionAssessmentService.personality(actor);if(a.severity==='impact'&&family==='Human'&&a.discipline>.65)return'';if(a.severity==='trivial'&&family==='Human'&&a.discipline>.82&&Dice.d(100)<=70)return'';const pool=this.sounds[family]?.[a.severity]||this.sounds[family]?.minor||[];return pool.length?pick(pool):''},
  dialogue(state,actor,a,allow=true){if(!allow||['impact','trivial','fatal'].includes(a.severity))return'';const chance=Math.round((a.talkativeness||.15)*100*({minor:.55,moderate:.8,severe:1,critical:1.2,deathState:.9}[a.severity]||.5));if(Dice.d(100)>Math.min(35,chance))return'';return DialogueService.line(state,actor,['severe','critical','deathState'].includes(a.severity)?'critical':'pain')},
  fromDamage(state,actor,result,meta={}){if(!actor||result?.contact===false)return null;const a=ReactionAssessmentService.assess(actor,result),physical=this.physical(actor,a),vocal=this.vocal(actor,a),speech=this.dialogue(state,actor,a,meta.allowDialogue!==false);const quote=speech?`${actor.exceptional==='dragon'?'Telepathy: ':''}“${speech}”`:'';const pieces=[physical,vocal,quote].filter(Boolean);if(!pieces.length)return null;const reaction={actorId:actor.id,name:actor.name,text:pieces.join(' '),physical,vocal,dialogue:speech,severity:a.severity,kind:['critical','deathState','fatal'].includes(a.severity)?'critical':'pain',mode:speech?'mixed':'sound',damage:a.damage,location:a.location.label,round:state.round,context:`${a.severity.toUpperCase()} · ${a.location.label} · ${a.damage} damage${a.armorHeld?' · armor held':''}`};state.ui.reaction=reaction;Pipeline.emit('reaction:created',{state,actor,result,assessment:a,reaction});return reaction},
  trigger(state,actor,kind='pain',meta={}){const location=meta.location||{id:'torso',name:'Torso'},damage=Math.max(0,Number(meta.damage)||0),result={dealt:damage,raw:damage,penetrated:damage,armor:0,armorAbsorbed:0,location,critical:kind==='critical'?{tier:'simple'}:null,injury:kind==='critical'?{tier:'simple',name:'Critical injury'}:null,hpBefore:actor.hp+damage,hpAfter:actor.hp,maxHp:actor.maxHp,contact:true};return this.fromDamage(state,actor,result,{allowDialogue:meta.allowSpeech!==false})}
});

const NarrativeService=Object.freeze({
  attackHit(a,t,w,damage){const loc=damage.location.name.toLowerCase(),name=w.name||'attack',material=(w.effects||[]).includes('Silver')||/silver/i.test(name)?'silver':'steel',kind=/bow|crossbow/i.test(name)?'missile':/axe/i.test(name)?'axe':/mace|maul|hammer|shield/i.test(name)?'blunt':/bite/i.test(name)?'bite':/claw|talon/i.test(name)?'claw':'blade';const pools={blade:[`${a.name}'s ${name} opens ${t.name} at the ${loc}, ${material} dragging through the wound.`,`${a.name} finds the ${loc}; the ${name} bites cleanly before ${t.name} can close the line.`,`${name} meets the ${loc} with a hard, wet cut and forces ${t.name} to compensate.`],axe:[`${name} chops into ${t.name}'s ${loc} with weight behind the edge.`,`${a.name} drives the axe through the line and jars the ${loc}.`,`${t.name}'s ${loc} catches the descending edge with ugly force.`],blunt:[`${a.name} hammers the ${loc}; the impact lands through flesh, bone, and whatever armor remains.`,`${name} crashes into ${t.name}'s ${loc} and knocks the body out of its rhythm.`,`${t.name} takes the blunt force on the ${loc} and folds around it.`],missile:[`The shot reaches ${t.name}'s ${loc} before the target can clear the line.`,`The missile punches into the ${loc} and snaps the shaft or bolt with the impact.`,`${a.name}'s shot finds the ${loc}, burying itself through the opening.`],bite:[`${a.name}'s jaws close on ${t.name}'s ${loc} and wrench before releasing.`,`Teeth find the ${loc}; ${t.name} is caught for a brutal instant in the bite.`,`${a.name} bites down on the ${loc} with enough force to shake the whole body.`],claw:[`${a.name}'s claws rake the ${loc} and leave parallel tears behind.`,`The claw strike hooks the ${loc} and drags across it.`,`${t.name}'s ${loc} catches the talons at full extension.`]};return pick(pools[kind]||pools.blade)},
  attackMiss(a,t,w){const name=w.name||'attack';return pick([`${a.name}'s ${name} cuts through empty space as ${t.name} slips the line.`,`${t.name} gets clear before ${a.name}'s ${name} can connect.`,`${a.name} commits to the ${name}, but the attack never reaches flesh or armor.`])},
  spell(caster,spell,hit,dealt=0,target={name:'the target'}){const n=spell.name||'spell',tn=target?.name||'the target';if(!hit)return pick([`${caster.name} sends ${n} across the line, but ${tn} clears the working before it closes.`,`${n} tears through the space ${tn} occupied a heartbeat earlier.`,`${caster.name}'s ${n} fails to catch ${tn}.`]);const tags=spell.tags||[],school=String(caster.mage?.school||'').toLowerCase();if(/fire/.test(school)||/fire|flam|aenye/i.test(n))return `${caster.name} shapes ${n} into a hard wash of heat and sparks; it catches ${target.name} for ${dealt} damage.`;if(/ice|water/.test(school)||/ice|rhewi|gaef|hail/i.test(n))return `${n} snaps cold across the field, frost whitening armor as it catches ${tn}${dealt?` for ${dealt} damage`:''}.`;if(/air|storm/.test(school)||/thunder|lightning|gust|suffocate/i.test(n))return `${caster.name} drags the air itself into ${n}; pressure and crackling force close around ${tn}${dealt?` for ${dealt} damage`:''}.`;if(/earth/.test(school)||/earth|stone|spike|prison/i.test(n))return `${n} answers from the ground with stone and force, catching ${tn}${dealt?` for ${dealt} damage`:''}.`;if(/illusion|mind/.test(school)||/mental|illusion|mirror/i.test(n))return `${caster.name}'s ${n} bends perception and intent rather than simply throwing force.`;return `${caster.name}'s ${n} takes hold${dealt?` and deals ${dealt} damage`:''}.`},
  dragonBreath(dragon,breath,hit,target={name:'the target'}){const key=dragon.variantKey,tn=target?.name||'the target';const miss=hit?'':`${tn} escapes the center of ${dragon.name}'s ${breath.name.toLowerCase()} before it closes.`;if(miss)return miss;const text={green:`${dragon.name}'s throat flexes and a white wall of scalding steam rolls over ${tn}, turning breath and sight into pain.`,red:`${dragon.name} exhales catastrophic fire; the air itself seems to ignite before the blast reaches ${tn}.`,black:`${dragon.name} spits a burning, corrosive jet that hisses against metal and stone before it reaches ${tn}.`,brown:`${dragon.name} floods the ground ahead with old dragon-fire, heat reflecting from stone beneath ${tn}'s feet.`,white:`${dragon.name} exhales winter. Frost races ahead of the blast and ice closes over anything too slow to escape.`};return text[key]||`${dragon.name} releases ${breath.name.toLowerCase()} across ${tn}'s position.`}
});

const DefeatService=Object.freeze({
  profile(enemy){if(!enemy)return'monster';if(enemy.exceptional==='dragon')return'dragon';if(enemy.exceptional==='higherVampire')return'vampire';if(enemy.faction==='Scoiatael')return'scoiatael';if(enemy.mage)return'mage';if(enemy.family==='Human')return enemy.identity?.region==='Nilfgaard'?'soldier':'bandit';if(['Construct','Elementa'].includes(enemy.family))return'construct';if(enemy.family==='Beast')return'beast';return'monster'},
  decisiveCritical(victim,last){const loc=String(last?.location||'').toLowerCase();return[...(victim.criticals||[])].reverse().find(w=>!loc||String(w.location||'').toLowerCase()===loc.replace(/\s/g,''))||[...(victim.criticals||[])].reverse()[0]||null},
  headline({profile,victor,last,critical,captured}){if(captured)return'TAKEN ALIVE';const source=String(last?.source||'').toLowerCase(),name=String(critical?.name||'').toLowerCase();if(/dismembered leg/.test(name))return'LEG TAKEN OFF';if(/dismembered arm/.test(name))return'ARM TAKEN OFF';if(/decap|skull|head/.test(name)&&critical?.fatal)return'KILLED BY HEAD TRAUMA';if(profile==='dragon'){if(victor?.breath&&String(victor.breath.name).toLowerCase()===source)return({red:'BURNED TO DEATH',green:'SCALDED TO DEATH',black:'DISSOLVED IN ACID',white:'FROZEN SOLID',brown:'INCINERATED'})[victor.variantKey]||'KILLED BY DRAGONFIRE';if(/bite|jaw/.test(source))return'BROKEN IN ITS JAWS';if(/claw|wing|crush|eruption|stomp/.test(source))return'CRUSHED BY A DRAGON';return'KILLED BY A DRAGON'}if(profile==='beast')return/ bite|jaw/.test(` ${source}`)?'MAULED TO DEATH':'TORN APART';if(profile==='construct')return'CRUSHED TO DEATH';if(profile==='vampire')return/bite|fang|drain/.test(source)?'DRAINED BY A VAMPIRE':'KILLED BY A HIGHER VAMPIRE';if(profile==='mage')return/fire|flam|aenye/.test(source)?'BURNED BY MAGIC':/ice|rhewi|frost/.test(source)?'FROZEN BY MAGIC':'KILLED BY MAGIC';if(profile==='scoiatael')return'MURDERED BY THE SCOIA’TAEL';if(profile==='soldier')return'KILLED IN BATTLE';if(profile==='bandit')return'MURDERED';return'YOU DIED'},
  injurySummary(victim){const bad=(victim.criticals||[]).filter(x=>x.state!=='treated').map(x=>x.name),conditions=Object.keys(victim.statuses||{}).filter(k=>victim.statuses[k]);return bad.length?`${bad.slice(0,3).join(', ')}${bad.length>3?' and more':''}.`:conditions.length?`${conditions.slice(0,4).join(', ')}.`:'Accumulated trauma overwhelmed the body.'},
  causeLine({victor,victim,last,critical,captured}){const vn=victor?.name||'The enemy',name=GrammarService.name(victim),loc=last?.location||'the body',source=last?.source||'the final attack';if(captured)return`${vn} defeated ${name} and deliberately kept ${GrammarService.object(victim)} alive.`;const crit=String(critical?.name||'');if(/Dismembered Leg/i.test(crit))return`${vn} murdered ${name} by cutting through ${GrammarService.possessive(victim)} ${String(loc).toLowerCase()} and taking the leg off.`;if(/Dismembered Arm/i.test(crit))return`${vn} destroyed ${name}'s ${String(loc).toLowerCase()} with ${source}; the catastrophic wound ended the fight.`;return`${vn} killed ${name} with ${source} to the ${String(loc).toLowerCase()}${last?.dealt?` for ${last.dealt} penetrating damage`:''}.`},
  storyFor({profile,outcome,victor,victim,last,critical,captured}){const vn=victor?.name||'The victor',name=GrammarService.name(victim),subj=GrammarService.subject(victim),obj=GrammarService.object(victim),poss=GrammarService.possessive(victim),refl=GrammarService.reflexive(victim),loc=String(last?.location||'the body').toLowerCase(),source=String(last?.source||'the final attack'),crit=String(critical?.name||'');if(captured){if(profile==='mage'||profile==='vampire')return`${vn} has a reason to keep ${name} breathing. ${GrammarService.subject(victim,true)} is disarmed, restrained, and taken from the battlefield for questioning or study.`;return`${vn} binds ${name}, strips away the weapons that could make ${obj} dangerous, and takes ${obj} from the field alive.`}if(/Dismembered Leg/i.test(crit))return`${source} tears catastrophically through ${name}'s ${loc}. The leg comes away or is ruined beyond support; ${name} crashes down in blood and damaged armor. ${vn} gives ${obj} no time to recover and finishes the fight.`;if(/Dismembered Arm/i.test(crit))return`${source} destroys ${name}'s ${loc}. The limb is lost, the guard opens, and ${vn} presses the helpless moment until the fight is over.`;if(profile==='dragon'&&victor?.breath?.name===last?.source){const v=victor.variantKey;return{red:`${vn}'s fire overtakes ${name}. Heat overwhelms armor, cloth, and breath until ${subj} can no longer move.`,green:`${vn}'s scalding steam gets beneath ${name}'s protection and cooks every breath into another injury.`,black:`${vn}'s burning acid washes across ${name}; metal hisses and protection is eaten away with the body beneath it.`,white:`${vn}'s winter breath closes over ${name}, frost becoming rigid ice around ${obj}.`,brown:`${vn}'s dragon-fire fills the ground around ${name} until scorched stone and ruined gear are all that remain.`}[v]||`${vn}'s breath ends the fight.`}if(profile==='dragon'&&/bite|jaw/i.test(source))return`${vn} catches ${name} in its jaws and closes with enough force to break armor and body together before casting ${obj} aside.`;if(profile==='beast'||profile==='monster')return`${vn} keeps attacking after ${name} goes down. There is no concept of quarter—only teeth, claws, weight, and the helpless body beneath them.`;if(profile==='construct')return`${vn} continues the motion that defeated ${name}, crushing and breaking until ${subj} no longer presents a threat.`;if(profile==='bandit'||profile==='soldier'||profile==='scoiatael')return`${name} goes down from the wound to ${loc}. ${vn} closes the distance and makes certain ${subj} will not stand again.`;if(profile==='mage')return`${vn}'s magic leaves ${name} unable to recover. The working is followed through until the body finally gives out.`;if(profile==='vampire')return`${vn} watches ${name} fail, then finishes the encounter with the cold certainty of a predator that understands exactly how difficult a witcher can be to kill.`;return`${vn} ends the fight decisively after the wound to ${loc}.`},
  build(state,{captured=false,victorId=null}={}){const victim=state.player,victor=ActorAccess.find(state,victorId||state.battleMemory.lastHarm?.attackerId)||state.enemies.filter(isHostile).sort((a,b)=>b.attack-a.attack)[0]||state.enemies[0],profile=this.profile(victor),registry=Registry.defeatProfiles.get(profile),last=state.battleMemory.lastHarm||{},critical=this.decisiveCritical(victim,last);let outcome=captured?pick((registry?.outcomes||[]).filter(x=>/capture|imprison|ransom|interrogate|study|strip|leave/i.test(x))):pick(registry?.outcomes||['finish']);const title=captured?'Captured':'Defeat',headline=this.headline({profile,victor,last,critical,captured}),causeLine=this.causeLine({victor,victim,last,critical,captured}),story=this.storyFor({profile,outcome,victor,victim,last,critical,captured}),condition=`${GrammarService.name(victim)} went down at ${victim.hp}/${victim.maxHp} HP with ${this.injurySummary(victim)}`,appearance=victim.appearance||{},visual=`${GrammarService.name(victim)} is still recognizable beneath blood and damaged equipment${appearance.notable?.length?`, including ${appearance.notable.slice(0,2).join(' and ')}`:''}.`;return{title,headline,causeLine,story,condition,visual,victor:victor?.name||'Unknown opponent',profile,outcome,place:victor?.identity?.region||victor?.family||'the battlefield',lastBlow:last?.source?`${last.source} to ${last.location||'the body'} for ${last.dealt||0} damage.`:'The final exchange is lost in the collapse.',captured,critical:critical?.name||null}},
  maybeSubdue(state,attacker,target){if(!target||target.dead||!target.death?.active||state.phase!=='combat')return false;const profile=this.profile(attacker);if(!['bandit','soldier','scoiatael','mage','vampire'].includes(profile))return false;const chance={bandit:35,soldier:45,scoiatael:30,mage:60,vampire:55}[profile]||0;if(Dice.d(100)>chance)return false;state.aftermath.defeat=this.build(state,{captured:true,victorId:attacker.id});state.phase='ended';state.winner='enemies';state.turn.side='none';state.ui.pendingDefeat=true;return true}
});

function maintainActiveSigns(st){for(const key of ['fireStream']){const a=st.player.activeSigns[key];if(!a)continue;if(st.player.sta>=a.upkeep)st.player.sta-=a.upkeep;else{delete st.player.activeSigns[key];pushFeed(st,{title:'Sign collapses',story:`${st.player.name} cannot pay the ${a.upkeep} STA upkeep for ${key==='fireStream'?'Fire Stream':key}.`,math:'Active Sign ended.'})}}if(st.player.activeShield){const u=st.player.activeShield.upkeep;if(st.player.sta>=u)st.player.sta-=u;else{st.player.activeShield=null;pushFeed(st,{title:'Active Shield collapses',story:`${st.player.name} cannot sustain the Active Shield; the shell gutters out.`,math:`Needed ${u} STA upkeep.`})}}}
function resolveMagicTraps(st){
  for(const z of st.map.zones.filter(z=>z.type==='magicTrap'&&z.duration>0)){
    const origin={x:z.x,y:z.y};
    const targets=st.enemies.filter(e=>isHostile(e)&&GridService.distance(origin,e.pos)<=z.radius).sort((a,b)=>GridService.distance(origin,a.pos)-GridService.distance(origin,b.pos));
    const t=targets[0];if(!t)continue;
    const attack=Dice.check(effectiveSkill(st.player,'Spell Casting'),{label:'Magic Trap'}),def=Dice.check(t.defenses.dodge,{label:'Dodge'});
    if(attack.total>def.total){
      const loc=Rules.location(t.family==='Human'?'human':'monster','random'),dr=Dice.rollNotation('3d6'),out=DamageService.resolve(st,{attacker:st.player,target:t,raw:dr.total,type:'E',location:loc,weapon:{effects:[]},source:'Magic Trap'});
      const resultText=out.dealt?` for ${out.dealt} damage`:` but armor catches the force`;
      pushFeed(st,{kind:out.dealt?'hit':'miss',title:'Magic Trap strikes',story:`The prepared Yrden snaps at ${t.name}${resultText}.`,math:`${attack.text}; ${def.text}; ${dr.text}.`});
    }else{
      pushFeed(st,{kind:'miss',title:'Magic Trap misses',story:`${t.name} escapes the trap's sudden lash.`,math:`${attack.text}; ${def.text}.`});
    }
  }
}
function actorMoveBudget(st,e){let m=(e.mounted&&e.mount?e.mount.stats?.SPD:e.stats?.SPD)||6;for(const z of st.map.zones)if(z.type==='yrden'&&GridService.distance({x:z.x,y:z.y},e.pos)<=z.radius)m=Math.max(1,m-(z.power||1));return m}

// ---------- Tactical retreat / escape service ----------
// "Flee" is an intent, not teleportation. A routed actor remains a legal hostile
// target until it physically reaches a battlefield edge. If it gets out, its
// carried loot leaves with it; if the player catches and kills it first, normal
// battlefield loot rules apply.
// Loot names armour after the region it came from; that catalogue is still in this bridge.
setRegionLabeller(region => EncounterRegionService.label(region));

const EscapeService = new EscapeSystem({
  moveBudget: (state, actor) => actorMoveBudget(state, actor),
  retreatLine: (state, actor) => DialogueService.line(state, actor, 'retreat')
});

function findApproach(state,actor,target,reach,budget){const reachable=GridService.reachable(state,actor,budget),c=[];for(const [index,cost] of reachable){const {x,y}=GridService.pos(index);if(GridService.distance({x,y},target.pos)<=reach)c.push({x,y,cost})}c.sort((a,b)=>a.cost-b.cost);return c[0]||null}
function findClosestReachable(state,actor,target,budget){const reachable=GridService.reachable(state,actor,budget),c=[];for(const [index,cost] of reachable){const {x,y}=GridService.pos(index),dist=GridService.distance({x,y},target.pos);c.push({x,y,cost,dist})}c.sort((a,b)=>a.dist-b.dist||b.cost-a.cost);return c[0]||null}
function findFiringTile(state,actor,target,weapon,budget){const reachable=GridService.reachable(state,actor,budget),max=Number(weapon.range)*2,c=[];for(const [index,cost] of reachable){const {x,y}=GridService.pos(index),pos={x,y},dist=GridService.distance(pos,target.pos),los=GridService.los(state,pos,target.pos);if(dist<=max&&los.clear)c.push({x,y,cost,score:Math.abs(dist-Number(weapon.range)*.4)+cost-(GridService.tile(state,x,y)?.coverSp?3:0)})}c.sort((a,b)=>a.score-b.score);return c[0]||null}


// ---------- Persistent zone service ----------
// Stored zones are rules state, not renderer state. The renderer only asks which
// registered zones cover each tile. This keeps future AOE types LEGO-like.
const ZoneService = new ZoneSystem({
  definitions: Registry.zones,
  conditions: ConditionService,
  damage: DamageService,
  actors: ActorAccess,
  location: (model, called) => CombatRules.location(model, called)
});

// ---------- Bug-tester service ----------
// These are explicit simulator utilities. They do not pretend to be combat
// actions and therefore never consume turn resources.
const TesterService=Object.freeze({
  fullHeal(state){const p=state.player;p.hp=p.maxHp;p.sta=p.maxSta;p.toxicity=0;p.statuses={};p.criticals=[];p.disabledLocations={};p.death=null;p.dead=false;p.quenBlocks=0;p.activeShield=null;p.activeSigns={};p.morale={state:'steady',fear:0};pushFeed(state,{title:'Tester · full heal',story:'Health, stamina, toxicity, conditions, critical wounds, and death state are restored for another test pass.',math:`HP ${p.hp}/${p.maxHp} · STA ${p.sta}/${p.maxSta} · Toxicity 0`})},
  repairArmor(state){const p=state.player,maximum=p.armorMaxByLocation||{head:0,torso:14,leftArm:14,rightArm:14,leftLeg:14,rightLeg:14};p.armorMaxByLocation??=Core.clone(maximum);for(const [part,max] of Object.entries(maximum))p.armorByLocation[part]=max;pushFeed(state,{title:'Tester · armor repaired',story:'Every armor location is restored to its configured maximum SP.',math:Object.entries(p.armorByLocation).map(([k,v])=>`${k} ${v}`).join(' · ')})},
  restock(state){const p=state.player;p.crossbowLoaded=true;p.ammo={standard:20,bodkin:5,broadhead:5};for(const [id,item] of Registry.alchemy){const bag=item.kind==='potion'?'potions':item.kind==='decoction'?'decoctions':item.kind==='bomb'?'bombs':item.kind==='oil'?'oils':null;if(!bag)continue;p.inventory[bag][id]=item.kind==='decoction'?1:item.kind==='oil'?3:2}pushFeed(state,{title:'Tester · supplies restocked',story:'Ammunition and test alchemy are restored to the engine’s standard test loadout.',math:'20 standard · 5 bodkin · 5 broadhead · test alchemy replenished.'})},
  fullRestore(state){this.fullHeal(state);this.repairArmor(state);this.restock(state);state.map.zones=[];pushFeed(state,{title:'Tester · full restore',story:'The player sheet, armor, supplies, and lingering battlefield zones are reset without rebuilding the encounter.',math:'Current encounter preserved.'})}
});


// ---------- Battlefields: one Witcher wiring block over the generic builder ----------
const BattlefieldService = new BattlefieldBuilder({
  terrain: Registry.terrain,
  roll: (max) => Dice.int(max)
});
const DeploymentService = new DeploymentSystem({ roll: (max) => Dice.int(max) });

// Terrain effects apply through the attack/defense modifier events, so combat resolution never
// needs to know what ground it is standing on.
new TerrainRules({
  pipeline: Pipeline,
  terrain: Registry.terrain,
  conditions: { add: (actor, id, duration) => ConditionService.add(actor, id, duration) },
  skill: (actor, name) => effectiveSkill(actor, name),
  check: (base, label) => Dice.check(base, { label }),
  feed: (state, entry) => pushFeed(state, entry),
  exempt: (actor, tag) => CreatureAbilityService.hasTag(actor, tag)
}).attach();

/**
 * Builds a battlefield by id. Terrain, shapes, and light level all come from the registry, so a new
 * environment is a content row rather than a branch here.
 */
const SituationService = {
  apply(draft, kind) {
    const recipe = Registry.battlefieldPresets.get(kind) || Registry.battlefieldPresets.get('open');
    draft.situation = recipe ? kind : 'open';
    draft.map.objects = [];
    BattlefieldService.build(draft, recipe || { base: 'ground', features: [] });
  },
  /** Deployment bands for the current grid. */
  zones() { return BattlefieldService.zones(); }
};

// ---------- Default state ----------
// Who is in the player's seat is the roster's business; nothing in the bridge names a hero.
const Heroes = new HeroRoster({ registry: Registry, pronouns: gender => Core.clone(PronounSets[gender] || PronounSets.Unknown) });
function createPlayer(): IActor { return Heroes.create(); }
const CharacterRegistryService=Object.freeze({
  definitionFromActor(actor,{source={status:'project',origin:'Project character'},aliases=[]}={}){
    return{id:actor.id,name:actor.name,aliases:[...aliases],source:Core.clone(source),identity:{gender:actor.gender,age:actor.age,region:actor.identity?.region||null,pronouns:Core.clone(GrammarService.pronouns(actor))},raceSpecies:actor.family,faction:actor.faction||actor.team||null,stats:Core.clone(actor.stats||{}),skills:Core.clone(actor.skills||{}),derived:{maxHp:actor.maxHp,maxSta:actor.maxSta,rec:actor.rec,vigor:actor.vigor||0},equipment:{weapons:Core.clone(actor.weapons||[]),tools:Core.clone(actor.tools||[]),armorMaxByLocation:Core.clone(actor.armorMaxByLocation||{})},combat:{doctrines:Core.clone(actor.combatDoctrines||[]),personalityProfile:actor.personalityProfile||'disciplined',aiProfileId:actor.ai?.profileId||((actor.combatDoctrines||[]).includes('witcher')?'witcherExpert':null),cognitionId:actor.ai?.cognitionId||null},complete:true};
  },
  register(id,definition){return Registry.add('characters',id,{...Core.clone(definition),id})},
  spawn(id,{actorId=null,team='A',control='AI',position={x:0,y:0},overrides={}}: {actorId?:string|null;team?:string;control?:string;position?:IPosition;overrides?:Record<string,unknown>}={}){const def=Registry.require('characters',id);Core.invariant(def.complete!==false,`${def.name} is registered but lacks a complete combat sheet.`);const actor={id:actorId||`${id}-${Dice.int(999999)}`,name:def.name,baseName:def.name,family:def.raceSpecies||'Human',gender:def.identity?.gender||'Unknown',identity:Core.clone(def.identity),team,control,stats:Core.clone(def.stats||{}),skills:Core.clone(def.skills||{}),maxHp:def.derived?.maxHp||25,hp:def.derived?.maxHp||25,maxSta:def.derived?.maxSta||25,sta:def.derived?.maxSta||25,rec:def.derived?.rec||5,vigor:def.derived?.vigor||0,weapons:Core.clone(def.equipment?.weapons||[]),tools:Core.clone(def.equipment?.tools||[]),armorMaxByLocation:Core.clone(def.equipment?.armorMaxByLocation||{}),armorByLocation:Core.clone(def.equipment?.armorMaxByLocation||{}),statuses:{},criticals:[],disabledLocations:{},dead:false,fled:false,pos:{...position},combatDoctrines:Core.clone(def.combat?.doctrines||[]),personalityProfile:def.combat?.personalityProfile||'disciplined',ai:{experience:'veteran',profileId:def.combat?.aiProfileId||null,cognitionId:def.combat?.cognitionId||null,recent:[],stall:0,lastMeaningfulRound:0,scores:[],rejections:[],memory:{},plan:null,planSince:0,targetId:null,teamIntent:null,lastDecision:null},objective:{id:'eliminate'},...Core.clone(overrides)};GrammarService.ensure(actor);AnatomyService.ensure(actor);KnowledgeService.ensure(actor);EquipmentStateService.ensure(actor);ObjectiveService.ensure(actor);AIProfileService.ensure(actor);return actor}
});
for(const seed of [createPlayer()])if(!Registry.characters.has(seed.id))CharacterRegistryService.register(seed.id,CharacterRegistryService.definitionFromActor(seed));

function defaultState(): IState{const player=createPlayer();return{version:'4.4-modular-perf-bridge',phase:'setup',round:0,situation:'open',setup:{category:'outlaws',foe:'bandit',region:'random',subtype:'random',variant:'random',experience:'random',loadout:'random',quantity:1,lineup:[]},player,enemies:[],selectedEnemyId:null,map:{tiles:createTiles(),visibilityPenalty:0,zones:[],objects:[]},turn:{side:'none',action:0,bonus:0,reaction:0,movement:0,defensesUsed:0,extraAttackUsed:false},ui:{palette:'attack',attackPane:'melee',attackMode:'normal',weapon:player.selectedWeapon||'',called:'random',signCost:2,signAugments:[],showLife:false,aiDebug:false,audio:true,route:[],notice:null,pendingSurrender:null,pendingVictory:false,pendingDefeat:false,pendingLoot:false,pendingTester:false,reaction:null,encounterCollapsed:false,feedExpanded:false,mapZoom:1,latestEventId:null},feed:[],events:[],eventSeq:0,teamRelations:{'player|enemy':'hostile'},battleMemory:{playerTactics:[],linesUsed:{},roundMeaningful:false,lastHarm:null},winner:null,aftermath:{looted:false,loot:null,defeat:null}}}


// ---------- Pipeline plugins: no wrapping, no reassignment ----------
Pipeline.on('actor:created',ctx=>{
  const identity=LifeHistoryService.createIdentity(ctx.spec);Object.assign(ctx.actor,{identity,gender:identity.gender,age:identity.age,ageBand:identity.ageBand,ageText:identity.ageText,history:identity.history||[],name:identity.name||ctx.actor.name,powerBonus:identity.powerBonus||0});
  ctx.actor.team??='enemy';ctx.actor.control??='AI';ctx.actor.personalityProfile??=(ctx.actor.ai?.experience==='veteran'?'disciplined':ctx.actor.family==='Beast'?'predatory':'cautious');ctx.actor.combatDoctrines??=[];GrammarService.ensure(ctx.actor);AnatomyService.ensure(ctx.actor);KnowledgeService.ensure(ctx.actor);EquipmentStateService.ensure(ctx.actor);ObjectiveService.ensure(ctx.actor);AIProfileService.ensure(ctx.actor);
  if(ctx.actor.exceptional){const b=ctx.actor.powerBonus||0;if(b){ctx.actor.attack+=b;for(const k of Object.keys(ctx.actor.defenses||{}))ctx.actor.defenses[k]+=b;ctx.actor.maxSta+=b*5;ctx.actor.sta+=b*5}if(ctx.actor.exceptional==='dragon'){ctx.actor.variant=identity.variant;ctx.actor.variantKey=identity.variantKey;ctx.actor.breath={...Core.clone(Registry.dragonBreaths.get(identity.variantKey)),cooldownRemaining:0};if(b){ctx.actor.maxHp+=b*10;ctx.actor.hp=ctx.actor.maxHp}if(identity.variantKey==='green'){for(const attack of ctx.actor.attacks)if(/bite/i.test(attack.name)&&!attack.effects.includes('Poison100'))attack.effects.push('Poison100')}if(identity.variantKey==='black'){ctx.actor.resistances=[...new Set([...(ctx.actor.resistances||[]),'P','S','B'])];ctx.actor.dragonDefense={ignoreArmorPiercing:true,halveAblation:true}}if(identity.variantKey==='brown'&&!ctx.actor.abilities.includes('Burrow'))ctx.actor.abilities.push('Burrow')}if(ctx.actor.exceptional==='higherVampire'&&identity.specialAbility&&!ctx.actor.abilities.includes(identity.specialAbility))ctx.actor.abilities.push(identity.specialAbility)}
},100);
Pipeline.on('actor:created',ctx=>{if(ctx.actor.family!=='Human'||ctx.actor.exceptional)return;const region=EncounterRegionService.nameRegion(ctx.spec.region)||ctx.spec.region||ctx.actor.identity?.region||'Temeria',extra=TravelHistoryService.build(ctx.actor.identity,region,ctx.actor.archetype||ctx.spec.archetype||'soldier');ctx.actor.history=[...(ctx.actor.history||[]),...extra];ctx.actor.identity.birthplace=extra.find(x=>x.startsWith('Birthplace:'))?.replace('Birthplace: ','').replace(/\.$/,'')||ctx.actor.identity.region;ctx.actor.identity.currentRegion=region;},80);
Pipeline.on('situation:apply',ctx=>SituationService.apply(ctx.state,ctx.kind),100);
Pipeline.on('combat:beforeStart',ctx=>{ensureUniqueNames(ctx.state.enemies)},100);
Pipeline.on('action:beforeRun',ctx=>{if(ctx.state?.ui)ctx.state.ui.reaction=null},1000);
Pipeline.on('attack:modifier',ctx=>{if(ctx.state.map.visibilityPenalty&&ctx.ranged)ctx.mod+=ctx.state.map.visibilityPenalty;const ah=GridService.tile(ctx.state,ctx.actor.pos.x,ctx.actor.pos.y)?.elevation||0,th=GridService.tile(ctx.state,ctx.target.pos.x,ctx.target.pos.y)?.elevation||0;if(ah>th)ctx.mod+=1;if(ah<th)ctx.mod-=1;if(ctx.target.statuses.prone)ctx.mod+=2;const yrden=ctx.state.map.zones.find(z=>z.type==='yrden'&&GridService.distance({x:z.x,y:z.y},ctx.actor.pos)<=z.radius);if(yrden)ctx.mod-=Math.min(7,yrden.power||1)},30);
Pipeline.on('damage:before',ctx=>{if(!isPlayerControlled(ctx.target))return;const p=ctx.target;if(p.activeShield){const absorb=Math.min(ctx.raw,p.activeShield.hp);p.activeShield.hp-=absorb;ctx.raw-=absorb;ctx.blockedBy='Active Shield';if(p.activeShield.hp<=0)p.activeShield=null;if(ctx.raw<=0){ctx.cancelled=true;ctx.reason='Active Shield absorbs the entire attack.'}return}if(p.quenBlocks>0){p.quenBlocks--;ctx.cancelled=true;ctx.reason='Quen absorbs the attack.';ctx.blockedBy='Quen'}},100);
Pipeline.on('damage:before',ctx=>{if(!ctx.ranged)return;const los=GridService.los(ctx.state,ctx.attacker.pos,ctx.target.pos);if(los.cover)ctx.coverSp=Math.max(ctx.coverSp||0,los.cover)},40);
Pipeline.on('damage:after',ctx=>{const {target,result,state,attacker,source}=ctx;
  if(result.dealt>0){state.battleMemory.roundMeaningful=true;if(!isPlayerControlled(target)){MoraleService.onDamage(state,target,result.dealt);if(target.ai)target.ai.lastMeaningfulRound=state.round}else{state.battleMemory.playerTactics.push({round:state.round,type:'wasHit',location:result.location.id});state.battleMemory.lastHarm={attackerId:attacker?.id||null,source,dealt:result.dealt,location:result.location?.name||result.location?.id,round:state.round,critical:result.injury?.name||result.critical?.tier||null};if(attacker)DefeatService.maybeSubdue(state,attacker,target)}}
  if(attacker&&result.dealt>0){KnowledgeService.observe(attacker,{type:'damageDealt',targetId:target.id,detail:result.location?.id||'unknown'},state.round);KnowledgeService.observe(target,{type:'hurtBy',targetId:attacker.id,detail:source},state.round)}
  if(!target.dead&&result.contact!==false){const reaction=ReactionService.fromDamage(state,target,result,{allowDialogue:!isPlayerControlled(target)});if(reaction&&['moderate','severe','critical','deathState'].includes(reaction.severity))pushFeed(state,{title:`${target.name} — ${reaction.severity} reaction`,story:reaction.text,math:reaction.context})}
  if(result.dealt>0)requestPresentationEffect(result.injury||result.critical?'critical':'hit',Math.min(1,result.dealt/Math.max(10,target.maxHp*.35)))},50);
Pipeline.on('critical:inflicted',ctx=>{if(!isPlayerControlled(ctx.target))ctx.target.morale.pressure+=2},20);

Pipeline.on('turn:begin',ctx=>{const st=ctx.state;if(ctx.side==='player'){st.turn.side='player';st.turn.defensesUsed=0;st.turn.extraAttackUsed=false;delete st.player.statuses.activeDodge;if(st.player.death?.active&&!st.player.dead){DeathStateService.save(st,st.player,'Start of round');if(st.player.dead){st.turn.action=0;st.turn.bonus=0;st.turn.reaction=0;st.turn.movement=0;Pipeline.emit('combat:checkEnd',{state:st});return}}const move=st.player.death?.active?Math.max(1,Math.floor(st.player.stats.SPD/3)):st.player.stats.SPD;st.turn.action=1;st.turn.bonus=0;st.turn.reaction=0;st.turn.movement=move;maintainActiveSigns(st)}},50);
Pipeline.on('turn:end',ctx=>{const st=ctx.state;resolveMagicTraps(st);const beforeHp=st.player.hp,beforeDeath=!!st.player.death?.active;ConditionService.tickActor(st.player);if(st.player.hp<beforeHp&&st.player.hp<=0&&!st.player.dead){DeathStateService.save(st,st.player,beforeDeath?'Ongoing damage in Death State':'Ongoing damage caused Death State');if(st.player.dead)Pipeline.emit('combat:checkEnd',{state:st})}for(const e of st.enemies.filter(isHostile)){const enemyHp=e.hp,enemyDeath=!!e.death?.active;ConditionService.tickActor(e);if(e.hp<enemyHp&&e.hp<=0&&!e.dead)DeathStateService.save(st,e,enemyDeath?'Ongoing damage in Death State':'Ongoing damage caused Death State')}ZoneService.tick(st);for(const [id,e] of Object.entries(st.player.activeAlchemy)){e.remaining--;if(e.remaining<=0){delete st.player.activeAlchemy[id];TemporaryHealth.revoke(st.player,id)}}for(const enemy of st.enemies)if(enemy.breath?.cooldownRemaining>0)enemy.breath.cooldownRemaining--},20);
Pipeline.on('ai:score',ctx=>{
  const e=ctx.enemy,a=ctx.action;ctx.breakdown??=[];
  const add=(label,value)=>{if(!value)return;ctx.score+=value;ctx.breakdown.push({label,value:Math.round(value)});};
  if(e.ai.recent.slice(-2).includes(a.name)&&['reposition','recover','reload'].includes(a.name))add('repetition',-22);
  if(e.ai.stall>=2&&['defend','wait','reposition'].includes(a.name))add('anti-stall',-35);
  if(e.ai.memory?.blockedAction===a.name)add('blocked last time',-28);
  const objective=ObjectiveService.utility(e,a.name);if(objective)add('objective',objective);
},20);
Pipeline.on('action:beforeRun',ctx=>{
  if(!isPlayerControlled(findActor(ctx.state,ctx.actorId)))return;
  const state=ctx.state,action=ctx.actionName;
  for(const enemy of state.enemies.filter(isHostile)){
    AIProfileService.ensure(enemy);
    if(!AITacticalState.visible(state,enemy,state.player)&&AIProfileService.cognitionTier(enemy)<4)continue;
    KnowledgeService.observe(enemy,{type:'playerAction',targetId:ctx.actorId,detail:action},state.round);
    if(action==='sign')KnowledgeService.observe(enemy,{type:'playerMagic',targetId:ctx.actorId},state.round);
    if(action==='ranged')KnowledgeService.observe(enemy,{type:'playerRanged',targetId:ctx.actorId},state.round);
    if(action==='melee')KnowledgeService.observe(enemy,{type:'playerMelee',targetId:ctx.actorId},state.round);
  }
},30);
Pipeline.on('combat:checkEnd',ctx=>{const st=ctx.state,hostile=st.enemies.filter(isHostile),controlled=st.enemies.filter(e=>ActorStateService.unresolvedControl(e));if(st.phase==='ended'){ctx.ended=true;return}if(st.player.dead){st.phase='ended';st.winner='enemies';st.turn.side='none';st.aftermath.defeat=DefeatService.build(st,{captured:false});st.ui.pendingDefeat=true;ctx.ended=true;return}if(!hostile.length&&!controlled.length){st.phase='ended';st.winner='player';st.turn.side='none';st.ui.pendingVictory=true;ctx.ended=true}},100);
Pipeline.on('surrender:resolved', ctx => { if (ctx.resumeEnemy) CombatFlow.scheduleEnemyPhase(); }, 0);



const MoraleService={
  onDamage(state,e,dealt){if(e.morale.fearImmune)return;e.morale.pressure+=dealt>=e.maxHp*.3?2:1;if(e.hp<=e.maxHp*.5)e.morale.pressure++;if(e.hp<=e.maxHp*.25)e.morale.pressure+=2;this.recalculate(state,e)},
  recalculate(state,e){const p=e.morale.pressure;if(p>=7)e.morale.state='broken';else if(p>=5)e.morale.state='panicked';else if(p>=3)e.morale.state='frightened';else if(p>=1)e.morale.state='shaken';else e.morale.state='steady'},
  intimidate(state,e,actor){if(e.morale.fearImmune)return{ok:false,reason:'This opponent is immune to fear pressure.'};const a=Dice.check(effectiveSkill(actor,'Intimidation'),{label:'Intimidation'}),d=Dice.check(e.morale.courage,{label:'Courage'});if(a.total>d.total){e.morale.pressure+=Math.max(1,Math.floor((a.total-d.total)/3));this.recalculate(state,e);return{ok:true,a,d}}return{ok:false,a,d,reason:'The threat does not break their nerve.'}},
  shouldSurrender(e){return!e.morale.fearImmune&&e.morale.state==='broken'&&e.morale.surrender>0&&Dice.d(100)<=Math.round(e.morale.surrender*100)}
};

// ---------- Death State tactical response ----------
// Entering Death State does not remove an actor from combat. Surviving actors make
// a lore/personality-weighted decision about how to spend the little time they may
// have left: fight on, withdraw toward safer ground, rout, or yield. The choice is
// only an AI intent; all movement/attacks still go through normal legal actions.
const DeathStateTacticsService=Object.freeze({
  response(actor){return actor?.death?.tactics?.choice||null},
  prepare(state,actor,{force=false}={}){
    if(!actor?.death?.active||actor.dead)return null;
    actor.death.tactics??={round:0,choice:null};
    if(!force&&actor.death.tactics.round===state.round&&actor.death.tactics.choice)return actor.death.tactics.choice;

    const profile=AIProfileService.profile(actor),personality=AIProfileService.personality(actor),tags=profile.tags||[],morale=actor.morale?.state||'steady';
    const choices=['fight','withdraw','flee','surrender'];
    let fight=45,withdraw=22,flee=18,surrender=15;

    // Discipline and creature nature shape expression without changing the rules.
    fight+=Math.round((personality.discipline||.5)*22);
    withdraw+=Math.round((personality.selfPreservation||.5)*18);
    if(tags.includes('formation')||tags.includes('skirmisher')||tags.includes('expert'))withdraw+=12;
    if(tags.includes('beast')||tags.includes('pack')||tags.includes('predator')){fight+=10;surrender=0;flee+=10}
    if(tags.includes('construct')||actor.morale?.fearImmune){fight+=28;surrender=0;flee=Math.max(0,flee-8)}
    if(AIProfileService.cognitionTier(actor)>=5){fight+=8;withdraw+=22;surrender=Math.max(0,surrender-8)}
    if(morale==='frightened'){flee+=8;surrender+=5}
    if(morale==='panicked'){flee+=18;surrender+=10;fight=Math.max(5,fight-12)}
    if(morale==='broken'){flee+=30;surrender+=25;fight=Math.max(2,fight-24)}
    if((actor.morale?.surrender||0)<=0||actor.morale?.fearImmune)surrender=0;
    if(!EscapeService.plan(state,actor))flee=0;
    if(AITacticalState.allies(state,actor).some(a=>GridService.distance(a.pos,actor.pos)<=5))withdraw+=10;

    const weights=[fight,withdraw,flee,surrender].map(v=>Math.max(0,Math.round(v)));
    const choice=pickWeighted(choices,weights);
    actor.death.tactics={round:state.round,choice};
    const text={
      fight:`${actor.name} is in Death State but chooses to keep fighting.`,
      withdraw:`${actor.name} survives the Death Save and tries to fall back toward safer ground.`,
      flee:`${actor.name} survives the Death Save, breaks nerve, and tries to escape the battlefield.`,
      surrender:`${actor.name} survives the Death Save but decides another exchange is not worth dying for.`
    }[choice];
    pushFeed(state,{kind:'action',title:`${actor.name} — Death State response`,story:text,math:`Rolled response: ${choice}. The actor remains targetable until dead, escaped, captured, or an accepted surrender resolves.`});
    return choice;
  }
});


// ---------- Target acquisition ----------
// Actions may carry an explicit target from the UI/AI. If that target is absent
// or no longer attackable (for example, the previous target died), the engine
// deterministically falls back to the closest legal hostile actor. This is a
// targeting convenience only: range, LOS, movement, ammunition, STA, and all
// other action rules are still validated normally after a target is acquired.

// ---------- Presentation effects are emitted as data; Layer 1 owns no browser audio. ----------
function requestPresentationEffect(kind,intensity=.5){Pipeline.emit('presentation:effect',{kind,intensity})}


function validateState(state) {
  Core.invariant(state && typeof state === 'object', 'State must be an object.');
  Core.invariant(['setup', 'combat', 'ended'].includes(state.phase), `Unknown battle phase ${state.phase}.`);
  Core.invariant(typeof state.player?.id === 'string' && state.player.id.length > 0, 'Player state is missing.');
  Core.invariant(['none', 'player', 'enemy'].includes(state.turn?.side), `Invalid turn side ${state.turn?.side}.`);

  const ids = new Set();
  for (const enemy of state.enemies ?? []) {
    Core.invariant(enemy.id && !ids.has(enemy.id), `Duplicate or missing enemy id: ${enemy.id}.`);
    ids.add(enemy.id);
    if (isActiveOnMap(enemy)) {
      Core.invariant(GridService.inside(enemy.pos?.x, enemy.pos?.y), `${enemy.name || enemy.id} is off the tactical grid.`);
    }
    Core.invariant(Number.isFinite(enemy.hp), `${enemy.name || enemy.id} has invalid HP.`);
    Core.invariant(Number.isFinite(enemy.sta), `${enemy.name || enemy.id} has invalid STA.`);
  }

  Core.invariant(Number.isFinite(state.player.hp), 'Player HP is invalid.');
  Core.invariant(Number.isFinite(state.player.sta), 'Player STA is invalid.');
  Core.invariant(Number.isFinite(state.turn?.movement), 'Movement pool is invalid.');
}

const Store = new Core.MemoryStore(defaultState, {
  historyLimit: 12,
  validate: validateState,
  sidecar: {
    capture: () => Dice.snapshot(),
    restore: seed => { if (seed != null) Dice.restore(seed); }
  }
});


// Rules resolve the acting hero from the payload, falling back to whoever holds the player's seat.
const ActionDispatcher = new ActionGateway({ store: Store, pipeline: Pipeline, defaultActorId: () => Store.read().player.id });

function validCombat(state, payload) {
  if (state.phase !== 'combat') return { ok: false, reason: 'Battle is not active.' };
  const actor = findActor(state, payload.actorId || state.player.id);
  if (state.turn.side !== 'player' && isPlayerControlled(actor)) return { ok: false, reason: `It is not ${actor.name}’s turn.` };
  if (!actor || actor.dead) return { ok: false, reason: 'The acting combatant cannot act.' };
  return { ok: true };
}

function spendActionResource(draft, payload, { allowExtra = true, kind = 'action' } = {}) {
  if (!isPlayerControlled(findActor(draft, payload.actorId || draft.player.id))) return;

  if (kind === 'bonus') {
    draft.turn.bonus--;
    return;
  }

  if (draft.turn.action > 0) {
    draft.turn.action--;
    return;
  }

  if (allowExtra && !draft.turn.extraAttackUsed && draft.player.sta >= 1) {
    draft.player.sta--;
    draft.turn.extraAttackUsed = true;
    payload.extraPenalty = (payload.extraPenalty || 0) - 3;
    payload.usedExtraAttack = true;
    return;
  }

  throw new Error('No Action remains.');
}

function validateActionResource(state, payload, { allowExtra = true, kind = 'action' } = {}) {
  if (!isPlayerControlled(findActor(state, payload.actorId || state.player.id))) return { ok: true };
  if (kind === 'bonus') return state.turn.bonus > 0 ? { ok: true } : { ok: false, reason: 'No Bonus Action remains.' };
  if (state.turn.action > 0) return { ok: true };
  if (allowExtra && !state.turn.extraAttackUsed && state.player.sta >= 1) return { ok: true };

  return {ok:false,reason:'No Action remains and the 1 STA / -3 Extra Attack is unavailable.'};
}

const BrawlRules = Object.freeze({
  resolveSpecial(draft, kind, target) {
    const attack = Dice.check(effectiveSkill(draft.player, 'Brawling'), { label: kind });
    const defense = Dice.check(target.defenses.dodge, { label: 'Dodge' });

    if (attack.total > defense.total) {
      if (kind === 'sweep') ConditionService.add(target, 'prone');
      else target.weaponDropped = true;

      pushFeed(draft, {
        title: kind === 'sweep' ? 'Trip' : 'Disarm',
        story: kind === 'sweep' ? `${target.name} is knocked prone.` : `${target.name}'s weapon is knocked away.`,
        math: `${attack.text} > ${defense.text}`
      });
      return;
    }

    pushFeed(draft, {
      kind: 'miss',
      title: `${kind} fails`,
      story: `${target.name} avoids the maneuver.`,
      math: `${attack.text}; ${defense.text}`
    });
  }
});
// ---------- Witcher action registrations ----------
ActionDispatcher.register('move',{validate(s,p){const v=validCombat(s,p);if(!v.ok)return v;if(!isPlayerControlled(findActor(s,p.actorId||s.player.id)))return{ok:true};if(s.turn.movement<=0)return{ok:false,reason:'No movement remains.'};const a=s.player,path=GridService.path(s,a.pos,p.to,a.id);if(path.length<2)return{ok:false,reason:'No legal path to that tile.'};return{ok:true}},spend(d,p){if(!isPlayerControlled(findActor(d,p.actorId||d.player.id)))return;const a=d.player,path=GridService.path(d,a.pos,p.to,a.id),max=d.turn.movement;let used=0,last=a.pos;for(let i=1;i<path.length;i++){const seg=GridService.pathCost(d,[path[i-1],path[i]]);if(used+seg>max)break;used+=seg;last=path[i]}p.actualTo=last;p.moveSpent=used;d.turn.movement=Math.max(0,d.turn.movement-used)},run(d,p){const a=findActor(d,p.actorId||d.player.id);const from={...a.pos};a.pos={...(p.actualTo||p.to)};d.ui.route=[];pushFeed(d,{kind:'move',title:`${a.name} moves`,story:`${a.name} crosses ${Number(p.moveSpent||0).toFixed(1)} m of the battlefield.`,math:`${from.x},${from.y} → ${a.pos.x},${a.pos.y}`});requestPresentationEffect('move',.2)}});

ActionDispatcher.register('melee',{validate(s,p){const v=validCombat(s,p);if(!v.ok)return v;const r=validateActionResource(s,p);if(!r.ok)return r;const w=Registry.weapons.get(p.weaponId||s.player.selectedWeapon);if(!w||w.range!=='melee')return{ok:false,reason:'Select a melee weapon.'};const t=TargetingService.bind(s,p);if(!t)return{ok:false,reason:'No legal target is available.'};const dist=GridService.distance(s.player.pos,t.pos),reach=Rules.meleeRange(w);if(dist>reach){const ap=findApproach(s,s.player,t,reach,s.turn.movement);if(ap)p.approach=ap;else{const closest=findClosestReachable(s,s.player,t,s.turn.movement);if(!closest||closest.cost<=0)return{ok:false,reason:'Target cannot be reached and no useful approach is possible.'};p.approachOnly=closest}}return{ok:true}},spend(d,p){const dest=p.approach||p.approachOnly;if(dest){const path=GridService.path(d,d.player.pos,dest,d.player.id),cost=GridService.pathCost(d,path);d.player.pos={x:dest.x,y:dest.y};d.turn.movement=Math.max(0,d.turn.movement-cost);p.moveSpent=cost}if(!p.approachOnly)spendActionResource(d,p)},run(d,p){if(p.approachOnly){const t=findActor(d,p.targetId||d.selectedEnemyId);pushFeed(d,{kind:'move',title:'Closing distance',story:`${d.player.name} uses the movement available to close on ${t?.name||'the target'}, but cannot reach striking distance this turn.`,math:`Movement spent: ${Number(p.moveSpent||0).toFixed(1)} m; Action preserved.`});return}TargetingService.select(d,p.targetId);const wid=p.weaponId||d.player.selectedWeapon,out=AttackService.attack(d,{actorId:d.player.id,targetId:p.targetId||d.selectedEnemyId,weaponId:wid,mode:p.mode||'normal',called:p.called||'random',extraPenalty:p.extraPenalty||0});recordAttackOutcome(d,out)}});

ActionDispatcher.register('ranged',{validate(s,p){const v=validCombat(s,p);if(!v.ok)return v;const r=validateActionResource(s,p);if(!r.ok)return r;const w=Registry.weapons.get(p.weaponId||s.player.selectedWeapon);if(!w||w.range==='melee')return{ok:false,reason:'Select a ranged weapon.'};const blocked=Ammunition.shotBlockedReason(s.player,w,p.ammoType);if(blocked)return{ok:false,reason:blocked};const t=TargetingService.bind(s,p,{requireLos:true});if(!t)return{ok:false,reason:'No legal target is available.'};const dist=GridService.distance(s.player.pos,t.pos);if(dist>Number(w.range)*2)return{ok:false,reason:'Target is beyond maximum ranged distance.'};const los=GridService.los(s,s.player.pos,t.pos);if(!los.clear){const ft=findFiringTile(s,s.player,t,w,s.turn.movement);if(!ft)return{ok:false,reason:'No firing line is reachable with the movement remaining.'};p.firingTile=ft}return{ok:true}},spend(d,p){if(p.firingTile){const path=GridService.path(d,d.player.pos,p.firingTile,d.player.id),cost=GridService.pathCost(d,path);d.player.pos={x:p.firingTile.x,y:p.firingTile.y};d.turn.movement=Math.max(0,d.turn.movement-cost)}spendActionResource(d,p);p.ammoSpent=Ammunition.spendRound(d.player,Registry.weapons.get(p.weaponId||d.player.selectedWeapon),p.ammoType)},run(d,p){TargetingService.select(d,p.targetId);const wid=p.weaponId||d.player.selectedWeapon,out=AttackService.attack(d,{actorId:d.player.id,targetId:p.targetId||d.selectedEnemyId,weaponId:wid,mode:p.mode||'normal',called:p.called||'random',extraPenalty:p.extraPenalty||0});recordAttackOutcome(d,out)}});

ActionDispatcher.register('barehanded',{validate(s,p){const v=validCombat(s,p);if(!v.ok)return v;const r=validateActionResource(s,p);if(!r.ok)return r;const a=findActor(s,p.actorId||s.player.id),t=TargetingService.bind(s,p);if(!t)return{ok:false,reason:'No legal target is available.'};if(GridService.distance(a.pos,t.pos)>2.2){const ap=findApproach(s,a,t,2.2,s.turn.movement);if(ap)p.approach=ap;else{const closest=findClosestReachable(s,a,t,s.turn.movement);if(!closest||closest.cost<=0)return{ok:false,reason:'Target is outside brawling reach and no useful approach is possible.'};p.approachOnly=closest}}if(['pin','choke','throw'].includes(p.move)&&!t.statuses.grappled)return{ok:false,reason:'Establish a grapple first.'};return{ok:true}},spend(d,p){const dest=p.approach||p.approachOnly;if(dest){const path=GridService.path(d,d.player.pos,dest,d.player.id),cost=GridService.pathCost(d,path);d.player.pos={x:dest.x,y:dest.y};d.turn.movement=Math.max(0,d.turn.movement-cost);p.moveSpent=cost}if(!p.approachOnly)spendActionResource(d,p)},run(d,p){if(p.approachOnly){const t=findActor(d,p.targetId||d.selectedEnemyId);pushFeed(d,{kind:'move',title:'Closing distance',story:`${d.player.name} closes as far as ${GrammarService.subject(d.player)} can toward ${t?.name||'the target'}, but cannot reach brawling distance this turn.`,math:`Movement spent: ${Number(p.moveSpent||0).toFixed(1)} m; Action preserved.`});return}TargetingService.select(d,p.targetId);const a=findActor(d,p.actorId||d.player.id),t=findActor(d,p.targetId||d.selectedEnemyId),base=effectiveSkill(a,'Brawling'),atk=Dice.check(base+(p.mode==='strong'?-3:0)+(p.extraPenalty||0),{label:p.move||'Brawling'}),def=Dice.check(t.defenses?.dodge??10,{label:`${t.name} defense`}),hit=atk.total>def.total;if(!hit){pushFeed(d,{kind:'miss',title:`${p.move||'Brawl'} misses`,story:`${a.name}'s ${p.move||'attack'} fails to catch ${t.name}.`,math:`${atk.text}; ${def.text}`});requestPresentationEffect('miss',.2);return}const move=p.move||'punch';if(move==='grapple'){ConditionService.add(t,'grappled');t.grappledBy=a.id;pushFeed(d,{kind:'hit',title:'Grapple established',story:`${a.name} gets control of ${t.name}'s balance and locks them in close.`,math:`${atk.text} > ${def.text}`});return}if(move==='pin'){ConditionService.add(t,'pinned');pushFeed(d,{kind:'hit',title:'Pinned',story:`${a.name} drives ${t.name} down and keeps them immobilized.`,math:`${atk.text} > ${def.text}`});return}if(move==='choke'){ConditionService.add(t,'suffocating');pushFeed(d,{kind:'hit',title:'Choke',story:`${a.name} closes the choke and ${t.name} starts losing air.`,math:`${atk.text} > ${def.text}`});return}if(move==='throw'){delete t.statuses.grappled;ConditionService.add(t,'prone');const dmg=Dice.rollNotation('2d6');t.sta=Math.max(0,t.sta-dmg.total);pushFeed(d,{kind:'hit',title:'Throw',story:`${a.name} turns the clinch and throws ${t.name} hard to the ground.`,math:`${atk.text}; ${dmg.text} non-lethal STA`});return}if(move==='sweep'){ConditionService.add(t,'prone');pushFeed(d,{kind:'hit',title:'Leg sweep',story:`${a.name} takes ${t.name}'s base out from under them.`,math:`${atk.text} > ${def.text}`});return}if(move==='disarm'){t.weaponDropped=true;pushFeed(d,{kind:'hit',title:'Unarmed disarm',story:`${a.name} knocks ${t.name}'s weapon clear.`,math:`${atk.text} > ${def.text}`});return}const dice=move==='kick'?'1d6+8':'1d6+4',dr=Dice.rollNotation(dice),amount=(p.mode==='strong'?dr.total*2:dr.total);t.sta=Math.max(0,t.sta-amount);pushFeed(d,{kind:'hit',title:`${move[0].toUpperCase()+move.slice(1)} lands`,story:`${a.name} catches ${t.name} with a ${move}; the impact drains ${amount} STA.`,math:`${atk.text} > ${def.text}; ${dr.text}${p.mode==='strong'?' ×2':''}`});requestPresentationEffect('hit',Math.min(1,amount/20))}});

// ---------- Signs: one Witcher wiring block for the extracted action module ----------
// Collaborators are read through arrow functions so this block never depends on declaration order.
const CastingService = new SpellCastingSystem(Registry.signAugments, {
  fumbles: Registry.magicFumbles,
  maxAugments: 2,
  roll: (sides) => Dice.d(sides)
});
registerSignActions({
  gateway: ActionDispatcher,
  casting: CastingService,
  signs: Registry.signs,
  focusItems: Registry.focusItems,
  validCombat: (state, payload) => validCombat(state, payload),
  validateActionResource: (state, payload) => validateActionResource(state, payload),
  spendActionResource: (draft, payload) => spendActionResource(draft, payload),
  conditions: { add: (actor, id, duration) => ConditionService.add(actor, id, duration) },
  damage: { resolve: (draft, request) => DamageService.resolve(draft, request) },
  zones: {
    create: (draft, request) => ZoneService.create(draft, request),
    igniteDream: (draft, position) => ZoneService.igniteDream(draft, position)
  },
  location: (model, called) => CombatRules.location(model, called),
  grammar: { object: (actor) => GrammarService.object(actor), subject: (actor) => GrammarService.subject(actor) },
  findActor: (state, id) => findActor(state, id),
  presentationEffect: (kind, intensity) => requestPresentationEffect(kind, intensity)
});
// ---------- Creature abilities: the behaviour that makes a monster that monster ----------
const CreatureAbilityService = new CreatureAbilitySystem({
  abilities: Registry.creatureAbilities,
  lookup: (creatureId) => abilitiesFor(creatureId, Registry.bestiary.get(creatureId)),
  lookupVariant: (variantKey) => variantAbilitiesFor(variantKey)
});
// Passives become the actor fields the existing rules already read.
Pipeline.on('actor:created', ctx => CreatureAbilityService.applyPassives(ctx.actor));
// Yrden forces incorporeal creatures to materialise, which is the standard counter to a wraith.
CreatureAbilityService.attachRules(Pipeline, {
  corporealZones: ['yrden', 'magicTrap'],
  onDrain: (state, actor, amount) => pushFeed(state, {
    kind: 'critical',
    title: `${actor.name} feeds`,
    story: `The copies circling ${state.player.name} pull ${amount} Health across and give it to the thing that made them.`,
    math: `${amount} drained, ${amount} healed.`
  })
});

registerCreatureActions({
  gateway: ActionDispatcher,
  abilities: CreatureAbilityService,
  conditions: { add: (actor, id, duration) => ConditionService.add(actor, id, duration) },
  damage: { resolve: (draft, request) => DamageService.resolve(draft, request) },
  location: (model, called) => CombatRules.location(model, called),
  findActor: (state, id) => findActor(state, id),
  presentationEffect: (kind, intensity) => requestPresentationEffect(kind, intensity),
  teleport: (draft, actor, to) => { actor.pos = { x: to.x, y: to.y } }
});

registerScenarioActions({
  gateway: ActionDispatcher,
  pipeline: Pipeline,
  scenarios: Registry.scenarios,
  focusItems: Registry.focusItems,
  zones: { create: (draft, request) => ZoneService.create(draft, request) }
});

ActionDispatcher.register('bomb',{validate(s,p){const v=validCombat(s,p);if(!v.ok)return v;const r=validateActionResource(s,p);if(!r.ok)return r;const id=p.itemId,count=s.player.inventory.bombs[id]||0;if(count<=0)return{ok:false,reason:'That bomb is not packed.'};const t=TargetingService.bind(s,p);if(!t)return{ok:false,reason:'No legal blast target is available.'};return{ok:true}},spend(d,p){spendActionResource(d,p);d.player.inventory.bombs[p.itemId]--},run(d,p){TargetingService.select(d,p.targetId);resolveBomb(d,p);requestPresentationEffect('bomb',.8)}});

ActionDispatcher.register('potion',{validate(s,p){const v=validCombat(s,p);if(!v.ok)return v;const id=p.itemId,item=Registry.alchemy.get(id);if(!item||!['potion','decoction'].includes(item.kind))return{ok:false,reason:'Unknown potion/decoction.'};if((s.player.inventory[item.kind==='potion'?'potions':'decoctions'][id]||0)<=0)return{ok:false,reason:'No dose remains.'};if(item.name!=='White Honey'&&s.player.toxicity+item.tox>s.player.maxToxicity)return{ok:false,reason:'That dose would exceed maximum toxicity.'};const r=validateActionResource(s,p,{kind:'action'});return r},spend(d,p){const item=Registry.alchemy.get(p.itemId);spendActionResource(d,p,{kind:'action'});d.player.inventory[item.kind==='potion'?'potions':'decoctions'][p.itemId]--;if(item.name==='White Honey'){d.player.toxicity=0;d.player.activeAlchemy={};TemporaryHealth.revokeAll(d.player)}else d.player.toxicity+=item.tox},run(d,p){const item=Registry.alchemy.get(p.itemId);if(item.name==='White Honey'){pushFeed(d,{title:'White Honey',story:`${d.player.name} clears the accumulated potion and decoction effects from ${GrammarService.possessive(d.player)} system.`,math:'Toxicity → 0.'});return}d.player.activeAlchemy[p.itemId]={remaining:item.duration,name:item.name};if(item.name==='Full Moon')TemporaryHealth.grant(d.player,p.itemId,30);if(item.name==='Golden Oriole')delete d.player.statuses.poisoned;if(item.name==='Swallow')d.player.statuses.swallow=true;pushFeed(d,{title:item.name,story:`${d.player.name} takes ${item.name}. ${item.desc}`,math:`Toxicity +${item.tox}; duration ${item.duration}.`})}});

ActionDispatcher.register('reload',{validate(s,p){const v=validCombat(s,p);if(!v.ok)return v;const a=findActor(s,p.actorId||s.player.id),w=Ammunition.findReloadableWeapon(a,id=>Registry.weapons.get(id),p.weaponId);const blocked=Ammunition.reloadBlockedReason(a,w);if(blocked)return{ok:false,reason:blocked};return validateActionResource(s,p)},spend(d,p){spendActionResource(d,p)},run(d,p){const a=findActor(d,p.actorId||d.player.id),w=Ammunition.findReloadableWeapon(a,id=>Registry.weapons.get(id),p.weaponId);Ammunition.reload(a,w);pushFeed(d,{title:'Reload',story:`${a.name} works the weapon back into a ready state.`,math:'Action spent.'})}});

ActionDispatcher.register('recover',{validate(s,p){const v=validCombat(s,p);if(!v.ok)return v;return validateActionResource(s,p)},spend(d,p){spendActionResource(d,p)},run(d,p){const a=findActor(d,p.actorId||d.player.id),before=a.sta;a.sta=Math.min(a.maxSta,a.sta+a.rec+(a.activeAlchemy?.[slug('Tawny Owl')]?2:0));pushFeed(d,{title:'Recover stamina',story:`${a.name} takes a measured moment to recover breath and balance.`,math:`STA ${before} → ${a.sta}.`})}});

ActionDispatcher.register('testerHeal',{validate(){return{ok:true}},spend(){},run(d){TesterService.fullHeal(d)}});
ActionDispatcher.register('testerRepair',{validate(){return{ok:true}},spend(){},run(d){TesterService.repairArmor(d)}});
ActionDispatcher.register('testerRestock',{validate(){return{ok:true}},spend(){},run(d){TesterService.restock(d)}});
ActionDispatcher.register('testerFullRestore',{validate(){return{ok:true}},spend(){},run(d){TesterService.fullRestore(d)}});

ActionDispatcher.register('tool',{validate(s,p){const v=validCombat(s,p);if(!v.ok)return v;if(p.kind==='stand'&&!s.player.statuses.prone)return{ok:false,reason:`${s.player.name} is already standing.`};if(['aim','activeDodge','stabilize','feint','charge','trip','disarm','shieldAttack'].includes(p.kind))return validateActionResource(s,p);return{ok:true}},spend(d,p){if(p.kind==='stand'){d.turn.movement=Math.max(0,d.turn.movement-2);return}if(['aim','activeDodge','stabilize','feint','charge','trip','disarm','shieldAttack'].includes(p.kind))spendActionResource(d,p)},run(d,p){const t=findActor(d,d.selectedEnemyId);if(p.kind==='stand'){delete d.player.statuses.prone;pushFeed(d,{title:'Stand',story:`${d.player.name} regains ${GrammarService.possessive(d.player)} feet.`,math:'Movement spent.'});return}if(p.kind==='aim'){d.player.aim=(d.player.aim||0)+1;pushFeed(d,{title:'Aim',story:`${d.player.name} settles the crossbow sight line instead of rushing the shot.`,math:`Aim bonus now +${d.player.aim}.`});return}if(p.kind==='activeDodge'){d.player.statuses.activeDodge=true;pushFeed(d,{title:'Active dodge',story:`${d.player.name} gives the exchange to footwork and defense.`,math:'Defensive posture active until next turn.'});return}if(p.kind==='stabilize'){const o=CriticalService.stabilize(d.player,effectiveSkill(d.player,'First Aid'));pushFeed(d,{kind:o.ok?'hit':'miss',title:'Stabilize wound',story:o.ok?`${o.wound.name} is stabilized.`:o.reason,math:o.roll?.text||''});return}if(!t)throw new Error('Select a target.');if(p.kind==='feint'){const a=Dice.check(10,{label:'Deceit'}),b=Dice.check(t.stats?.INT+5||10,{label:'Human Perception'});if(a.total>b.total){d.player.pendingFeint=3;pushFeed(d,{title:'Feint',story:`${t.name} bites on the false line; ${d.player.name} has a +3 opening on the next attack.`,math:`${a.text} > ${b.text}`})}else pushFeed(d,{kind:'miss',title:'Feint read',story:`${t.name} does not chase the false opening.`,math:`${a.text}; ${b.text}`});return}if(p.kind==='trip'){BrawlRules.resolveSpecial(d,'sweep',t);return}if(p.kind==='disarm'){BrawlRules.resolveSpecial(d,'disarm',t);return}if(p.kind==='shieldAttack'){const out=AttackService.attack(d,{actorId:d.player.id,targetId:t.id,weaponId:'sipar',mode:'normal',called:'random'});recordAttackOutcome(d,out);return}if(p.kind==='charge'){const path=GridService.path(d,d.player.pos,t.pos,d.player.id);if(path.length>1){const adjacent=path.at(-2);d.player.pos={...adjacent}}const out=AttackService.attack(d,{actorId:d.player.id,targetId:t.id,weaponId:d.player.selectedWeapon,mode:'strong',called:'random'});recordAttackOutcome(d,out)}}});

ActionDispatcher.register('social',{validate(s,p){
  const surrenderResponse=p.kind==='acceptSurrender'||p.kind==='refuseSurrender';
  if(surrenderResponse){
    if(s.phase!=='combat')return{ok:false,reason:'Battle is not active.'};
    const targetId=p.targetId||s.ui.pendingSurrender;
    const t=findActor(s,targetId);
    if(!t)return{ok:false,reason:'That surrendering opponent no longer exists.'};
    if(s.ui.pendingSurrender!==t.id)return{ok:false,reason:'That surrender is no longer awaiting a decision.'};
    return{ok:true};
  }
  const v=validCombat(s,p);if(!v.ok)return v;
  const t=findActor(s,p.targetId||s.selectedEnemyId);if(!t)return{ok:false,reason:'Select a target.'};
  return validateActionResource(s,p)
},spend(d,p){if(!['acceptSurrender','refuseSurrender'].includes(p.kind))spendActionResource(d,p)},run(d,p){
  const t=findActor(d,p.targetId||d.ui.pendingSurrender||d.selectedEnemyId);
  if(p.kind==='intimidate'){const o=MoraleService.intimidate(d,t,d.player);pushFeed(d,{kind:o.ok?'hit':'miss',title:'Intimidation',story:o.ok?`${t.name}'s nerve visibly gives ground.`:o.reason,math:o.a?`${o.a.text}; ${o.d.text}`:''});if(MoraleService.shouldSurrender(t))offerSurrender(d,t);return}
  if(p.kind==='demand'){t.morale.pressure+=2;MoraleService.recalculate(d,t);if(t.morale.state==='broken'&&MoraleService.shouldSurrender(t))offerSurrender(d,t);else pushFeed(d,{title:'Demand surrender',story:`${t.name} hears the demand but does not yet put the weapon down.`,math:`Morale: ${t.morale.state}.`});return}
  if(p.kind==='acceptSurrender'){ConditionService.add(t,'surrendered');d.ui.pendingSurrender=null;pushFeed(d,{title:'Surrender accepted',story:`${t.name} is removed from hostile initiative and no longer takes combat actions.`,math:'Status: surrendered.'});Pipeline.emit('surrender:resolved',{state:d,target:t,accepted:true,resumeEnemy:d.turn.side==='enemy'});return}
  if(p.kind==='refuseSurrender'){t.morale.surrender=0;t.morale.state='panicked';d.ui.pendingSurrender=null;pushFeed(d,{title:'Surrender refused',story:`${t.name} understands there will be no quarter and returns to the fight.`,math:'Future surrender attempts disabled.'});Pipeline.emit('surrender:resolved',{state:d,target:t,accepted:false,resumeEnemy:d.turn.side==='enemy'});return}
}});

ActionDispatcher.register('collectLoot',{validate(s,p){if(s.phase!=='ended'||s.winner!=='player')return{ok:false,reason:'Loot is available only after a victory.'};if(s.aftermath.looted)return{ok:false,reason:'The battlefield has already been searched.'};return{ok:true}},spend(){},run(d){
  const eligible=d.enemies.filter(e=>LootService.recoverableCarried(e));
  const carried=eligible.map(e=>({...e.loot,harvest:[]})),bundle=LootService.combine(carried);
  bundle.carcasses=eligible.filter(e=>e.family!=='Human'&&ActorStateService.harvestable(e)&&!e.harvested&&HarvestService.hasHarvest(e)).map(e=>e.id);
  d.aftermath.looted=true;d.aftermath.loot=bundle;d.ui.pendingVictory=false;d.ui.pendingLoot=true;
  pushFeed(d,{title:'Battlefield searched',story:`${d.player.name} searches recoverable gear and possessions. Monster loot is table driven: ${bundle.carcasses.length} carcass${bundle.carcasses.length===1?' is':'es are'} ready to harvest.`,math:`${bundle.currency.crowns} crowns · ${bundle.equipment.length} equipment · ${bundle.ammunition.reduce((n,x)=>n+(x.count||0),0)} missiles · ${bundle.hoards.length} hoard${bundle.hoards.length===1?'':'s'}.`})
}});

ActionDispatcher.register('harvestMonster',{
  validate(s,p){if(s.phase!=='ended'||s.winner!=='player'||!s.aftermath.looted)return{ok:false,reason:'Carving is available only in the post-battle aftermath.'};const e=findActor(s,p.targetId);if(!e||e.family==='Human')return{ok:false,reason:'That is not a monster carcass.'};if(e.fled||e.statuses.surrendered)return{ok:false,reason:'That creature is not a carcass on the field.'};if(!ActorStateService.harvestable(e))return{ok:false,reason:'Only a dead, recoverable carcass can be harvested.'};if(!HarvestService.hasHarvest(e))return{ok:false,reason:'This creature has no source-backed harvest pool.'};if(e.harvested)return{ok:false,reason:'That carcass has already been carved.'};return{ok:true}},
  spend(){},
  run(d,p){HarvestService.carve(d,p.targetId);d.aftermath.loot.carcasses=(d.aftermath.loot.carcasses||[]).filter(id=>id!==p.targetId);d.ui.pendingLoot=true}
});

ActionDispatcher.register('endTurn',{validate(s,p){const v=validCombat(s,{...p,actorId:s.player.id});if(!v.ok)return v;if(s.turn.side!=='player')return{ok:false,reason:'It is not the player turn to end.'};return{ok:true}},spend(){},run(d,p){d.turn.side='enemy';d.turn.enemyCursor=0;pushFeed(d,{title:p.automatic?'Turn ends automatically':'End turn',story:p.automatic?`${d.player.name} has spent every usable turn resource; the opposition moves immediately.`:`${d.player.name} yields the remaining tempo and the opposition acts.`,math:''});Pipeline.emit('turn:end',{state:d,side:'player'});setTimeout(()=>CombatFlow.scheduleEnemyPhase(),0)}});


const PuppetService=Object.freeze({
  isControlled(e){return!!e&&e.statuses?.puppet>0},
  resist(state,e){if(!this.isControlled(e))return false;const resist=Dice.check(e.defenses?.magic??10,{label:`${e.name} Resist Magic`}),caster=Dice.check(e.controlEffect?.castBase||effectiveSkill(state.player,'Spell Casting'),{label:'Puppet control'});if(resist.total>caster.total){const original=e.controlEffect?.originalFaction;e.faction=original||null;delete e.statuses.puppet;delete e.controlEffect;pushFeed(state,{title:`${e.name} breaks Puppet`,story:`${e.name} tears free of Axii and turns hostile again.`,math:`${resist.text}; ${caster.text}`});return true}e.statuses.puppet=Math.max(0,e.statuses.puppet-1);if(e.controlEffect)e.controlEffect.remaining=e.statuses.puppet;if(e.statuses.puppet<=0){e.faction=e.controlEffect?.originalFaction||null;delete e.statuses.puppet;delete e.controlEffect;pushFeed(state,{title:'Puppet expires',story:`Axii's hold on ${e.name} runs out.`,math:'Temporary control ended.'});return true}return false},
  act(state,e){const hostiles=state.enemies.filter(x=>isHostile(x)&&x.id!==e.id).sort((a,b)=>GridService.distance(e.pos,a.pos)-GridService.distance(e.pos,b.pos));if(!hostiles.length){pushFeed(state,{title:`${e.name} — puppeted`,story:`${e.name} remains under Axii, but there is no other hostile target to attack.`,math:`Puppet ${e.statuses.puppet} round${e.statuses.puppet===1?'':'s'} remaining.`});return}const target=hostiles[0],distance=GridService.distance(e.pos,target.pos),attack=e.attacks?.[0]||null,w=e.weaponId&&Registry.weapons.get(e.weaponId),reach=Number(attack?.range||w?.reach||2);if(distance<=reach){const a=attack||{name:w?.name||'Attack',attack:e.attack,type:w?.type||'B',damage:w?.damage||'2d6',range:reach,effects:w?.effects||[],rof:1};const out=AttackService.attack(state,{actorId:e.id,targetId:target.id,enemyAttack:a,weaponId:e.weaponId||'enemy',mode:'normal',called:'random'});recordAttackOutcome(state,out);pushFeed(state,{title:`Puppet command — ${e.name}`,story:`Under Axii, ${e.name} attacks ${target.name}.`,math:'The controlled creature uses its own attack statistics.'});return}const path=GridService.path(state,e.pos,target.pos,e.id),budget=actorMoveBudget(state,e);let used=0,last=e.pos;for(let i=1;i<path.length;i++){const c=GridService.pathCost(state,[path[i-1],path[i]]);if(used+c>budget)break;used+=c;last=path[i]}e.pos={...last};pushFeed(state,{title:`Puppet command — ${e.name}`,story:`Under Axii, ${e.name} moves toward ${target.name}.`,math:`Movement ${used.toFixed(1)} m.`})}
});

const MountedCombatService=Object.freeze({
  controlBase(actor){return Math.max(1,Number(actor.rideBase||actor.attack||10)+(actor.mount?.controlMod||0)-(actor.mount?.tackDropped?1:0))},
  control(state,actor,reason='mounted attack'){
    if(!actor?.mounted||!actor.mount)return{ok:true,roll:null};
    const roll=Dice.check(this.controlBase(actor),{label:`${actor.name} Control`}),ok=roll.total>=15;
    if(!ok){actor.mount.refusing=true;pushFeed(state,{kind:'miss',title:`${actor.name} loses the mounted attack`,story:`The ${actor.mount.name.toLowerCase()} breaks the line and the attack never develops.`,math:`${reason}: ${roll.text} vs DC 15.`})}
    else actor.mount.refusing=false;
    return{ok,roll}
  },
  directCharge(state,actor,target,reach){
    const start={...actor.pos},line=GridService.bresenham(start,target.pos),budget=actorMoveBudget(state,actor);let end=null;
    for(let i=1;i<line.length;i++){
      const c=line[i];if(c.x===target.pos.x&&c.y===target.pos.y)break;
      const tile=GridService.tile(state,c.x,c.y);if(!tile||tile.blocksMove||isOccupied(state,c.x,c.y,actor.id))return{ok:false,reason:'The charge lane is blocked.'};
      const moved=GridService.distance(start,c);if(moved>budget+0.01)break;if(GridService.distance(c,target.pos)<=reach){end={...c};break}
    }
    if(!end)return{ok:false,reason:'The mount cannot reach charging distance in a straight line.'};
    return{ok:true,end,moved:GridService.distance(start,end),budget,line}
  },
  bonusDice(weapon,moved){const divisor=weapon?.effects?.includes('Charging')?1:2;return Math.min(5,Math.max(0,Math.floor(moved/divisor)))}
});
ActionDispatcher.register('enemyMove',{validate(s,p){const e=findActor(s,p.actorId);if(!isHostile(e))return{ok:false,reason:'Enemy is not hostile.'};return p.to?{ok:true}:{ok:false,reason:'No destination.'}},spend(){},run(d,p){const e=findActor(d,p.actorId),path=GridService.path(d,e.pos,p.to,e.id),move=actorMoveBudget(d,e);let used=0,last=e.pos;for(let i=1;i<path.length;i++){const c=GridService.pathCost(d,[path[i-1],path[i]]);if(used+c>move)break;used+=c;last=path[i]}e.pos={...last};markAi(e,'reposition',used>0);pushFeed(d,{title:`${e.name} — repositions`,story:`${e.name} moves ${used.toFixed(1)} m toward a more useful line.`,math:`AI path ${path.length} nodes.`})}});

ActionDispatcher.register('enemyMountedCharge',{
  validate(s,p){const e=findActor(s,p.actorId),t=s.player;if(!isHostile(e))return{ok:false,reason:'Enemy is not hostile.'};if(!e.mounted||!e.mount)return{ok:false,reason:'Actor is not mounted.'};const w=e.weaponId&&Registry.weapons.get(e.weaponId);if(!w||w.range!=='melee')return{ok:false,reason:'Mounted charge requires a melee weapon.'};if(e.sta<=0)return{ok:false,reason:'Enemy is exhausted.'};const reach=Number(w.reach||2),distance=GridService.distance(e.pos,t.pos);if(distance<=reach)return{ok:false,reason:'Already in melee reach.'};const lane=MountedCombatService.directCharge(s,e,t,reach);if(!lane.ok)return lane;p.end=lane.end;p.moved=lane.moved;p.weaponId=e.weaponId;return{ok:true}},
  spend(d,p){const e=findActor(d,p.actorId);e.sta=Math.max(0,e.sta-1)},
  run(d,p){const e=findActor(d,p.actorId),w=Registry.weapons.get(p.weaponId||e.weaponId),control=MountedCombatService.control(d,e,'Mounted charge');if(!control.ok){markAi(e,'mountedCharge',false);return}const start={...e.pos};e.pos={...p.end};const moved=Number(p.moved||GridService.distance(start,e.pos)),bonus=MountedCombatService.bonusDice(w,moved),a={name:w.name,attack:e.attack,type:w.type,damage:w.damage,range:w.reach||2,effects:w.effects||[],rof:1};const out=AttackService.attack(d,{actorId:e.id,targetId:d.player.id,enemyAttack:a,weaponId:e.weaponId,mode:'normal',called:'random',chargeBonusDice:bonus});recordAttackOutcome(d,out);const meaningful=out.results.some(x=>x.hit&&x.damage?.dealt>0);markAi(e,'mountedCharge',meaningful);pushFeed(d,{title:`${e.name} — mounted charge`,story:`${e.name} drives the ${e.mount.name.toLowerCase()} ${moved.toFixed(1)} m down a straight lane and attacks with ${w.name}.`,math:`Control ${control.roll.text} vs DC 15 · charge bonus ${bonus}d6${w.effects?.includes('Charging')?' (Charging weapon)':''}.`})}
});
ActionDispatcher.register('enemyMelee',{validate(s,p){const e=findActor(s,p.actorId),t=s.player;if(!isHostile(e))return{ok:false,reason:'Enemy is not hostile.'};const w=e.weaponId&&Registry.weapons.get(e.weaponId),a=p.attack||((w&&w.range==='melee')?{name:w.name,attack:e.attack,type:w.type,damage:w.damage,range:w.reach||2,effects:w.effects||[],rof:1}:e.attacks?.find(x=>Number(x.range||2)<=4));if(!a)return{ok:false,reason:'No melee attack profile.'};if(GridService.distance(e.pos,t.pos)>Number(a.range||2.2))return{ok:false,reason:'Out of melee range.'};if(e.sta<=0)return{ok:false,reason:'Enemy is exhausted.'};p.resolvedAttack=a;return{ok:true}},spend(d,p){const e=findActor(d,p.actorId);e.sta=Math.max(0,e.sta-1)},run(d,p){const e=findActor(d,p.actorId),a=p.resolvedAttack||p.attack||e.attacks[0],control=MountedCombatService.control(d,e,'Mounted melee attack');if(!control.ok){markAi(e,'attack',false);return}const rof=Math.max(1,Number(a.rof||1));let meaningful=false;for(let i=0;i<rof&&!d.player.dead;i++){const out=AttackService.attack(d,{actorId:e.id,targetId:d.player.id,enemyAttack:a,weaponId:e.weaponId||'enemy',mode:'normal',called:'random'});recordAttackOutcome(d,out);meaningful ||= out.results.some(x=>x.hit&&x.damage?.dealt>0)}markAi(e,'attack',meaningful)}});
ActionDispatcher.register('enemyRanged',{validate(s,p){const e=findActor(s,p.actorId),a=p.attack||null,w=e?.weaponId&&Registry.weapons.get(e.weaponId),weaponShot=!a;if(!e||!isHostile(e))return{ok:false,reason:'Enemy is not hostile.'};if(weaponShot){if(!w||w.range==='melee')return{ok:false,reason:'No ranged weapon.'};if(e.ammo<=0)return{ok:false,reason:'No ammunition.'};if(w.effects?.includes('SlowReload')&&!e.loaded)return{ok:false,reason:'Crossbow not loaded.'}}const range=Number(a?.range||w?.range||0);if(!GridService.los(s,e.pos,s.player.pos).clear)return{ok:false,reason:'No LOS.'};if(GridService.distance(e.pos,s.player.pos)>range*(weaponShot?2:1))return{ok:false,reason:'Out of range.'};p.weaponShot=weaponShot;return{ok:true}},spend(d,p){if(!p.weaponShot)return;const e=findActor(d,p.actorId);Ammunition.spendRound(e,Registry.weapons.get(e.weaponId))},run(d,p){const e=findActor(d,p.actorId),w=Registry.weapons.get(e.weaponId),a=p.attack||{name:w.name,attack:e.attack,type:w.type,damage:w.damage,range:w.range,effects:w.effects,rof:1},control=MountedCombatService.control(d,e,'Mounted ranged attack');if(!control.ok){markAi(e,'shoot',false);return}const rof=Math.max(1,Number(a.rof||1));let meaningful=false;for(let i=0;i<rof&&!d.player.dead;i++){const out=AttackService.attack(d,{actorId:e.id,targetId:d.player.id,enemyAttack:a,weaponId:e.weaponId||'enemy',mode:'normal',called:'random'});recordAttackOutcome(d,out);meaningful ||= out.results.some(x=>x.hit&&x.damage?.dealt>0)}markAi(e,'shoot',meaningful)}});
ActionDispatcher.register('enemyReload',{validate(s,p){const e=findActor(s,p.actorId);if(!isHostile(e))return{ok:false,reason:'Not hostile.'};if(e.ammo<=0)return{ok:false,reason:'No ammunition.'};if(e.loaded)return{ok:false,reason:'Already loaded.'};return{ok:true}},spend(){},run(d,p){const e=findActor(d,p.actorId);Ammunition.reload(e,Registry.weapons.get(e.weaponId));markAi(e,'reload',true);pushFeed(d,{title:`${e.name} — reloads`,story:`${e.name} uses the lull to span and load the crossbow.`,math:'Reload action.'})}});
ActionDispatcher.register('enemySwitchWeapon',{validate(s,p){const e=findActor(s,p.actorId);return e&&isHostile(e)&&e.sidearmId&&Registry.weapons.has(e.sidearmId)?{ok:true}:{ok:false,reason:'No melee sidearm available.'}},spend(){},run(d,p){const e=findActor(d,p.actorId),old=e.weaponId;e.weaponId=e.sidearmId;e.preferredRange=2;markAi(e,'switch',true);pushFeed(d,{title:`${e.name} draws steel`,story:`With the ammunition gone, ${e.name} abandons the ${Registry.weapons.get(old)?.name||'ranged weapon'} and draws ${Registry.weapons.get(e.weaponId)?.name||'a sidearm'}.`,math:'Weapon switch.'})}});
ActionDispatcher.register('enemyCast',{
  validate(s,p){const e=findActor(s,p.actorId),spell=Registry.spells.get(p.spellId);if(!e||!isHostile(e)||!e.mage)return{ok:false,reason:'Not a casting enemy.'};if(!spell)return{ok:false,reason:'Unknown spell.'};if(e.sta<spell.cost)return{ok:false,reason:'Insufficient STA.'};if(spell.range>0&&GridService.distance(e.pos,s.player.pos)>spell.range&&!spell.tags?.includes('heal')&&!spell.tags?.includes('escape'))return{ok:false,reason:'Target out of spell range.'};if(spell.range>0&&!GridService.los(s,e.pos,s.player.pos).clear&&!spell.tags?.includes('heal')&&!spell.tags?.includes('escape'))return{ok:false,reason:'No LOS.'};return{ok:true}},
  spend(d,p){const e=findActor(d,p.actorId),spell=Registry.spells.get(p.spellId);e.sta=Math.max(0,e.sta-spell.cost)},
  run(d,p){
    const e=findActor(d,p.actorId),spell=Registry.spells.get(p.spellId);
    if(spell.tags?.includes('heal')){const wounded=d.enemies.filter(x=>isHostile(x)&&x.hp<x.maxHp).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0]||e,w=Dice.rollNotation('3d6');wounded.hp=Math.min(wounded.maxHp,wounded.hp+w.total);pushFeed(d,{title:`${e.name} — ${spell.name}`,story:`${e.name} turns magic toward ${wounded.name}, closing wounds for ${w.total} HP.`,math:`Cost ${spell.cost} STA.`});markAi(e,'cast',true);return}
    if(spell.tags?.includes('escape')){const tile=AI.Positioning.bestEscapeTile(d,e,Number(spell.range||20));if(tile){const before={...e.pos};e.pos={x:tile.x,y:tile.y};pushFeed(d,{title:`${e.name} — ${spell.name}`,story:`${e.name} refuses the close exchange and reappears on a safer line.`,math:`Teleport ${GridService.distance(before,e.pos).toFixed(1)} m · cost ${spell.cost} STA.`});markAi(e,'cast',true);return}}
    const cast=Dice.check(effectiveSkill(e,'Spell Casting'),{label:spell.name}),def=Dice.check(effectiveSkill(d.player,'Dodge / Escape'),{label:'Dodge'});if(cast.total<=def.total){pushFeed(d,{kind:'miss',title:`${spell.name} misses`,story:NarrativeService.spell(e,spell,false,0,d.player),math:`${cast.text}; ${def.text}.`});markAi(e,'cast',false);return}
    let dealt=0;if(spell.damage&&spell.damage!=='0'){const loc=Rules.location('human','random'),dr=Dice.rollNotation(spell.damage),out=DamageService.resolve(d,{attacker:e,target:d.player,raw:dr.total,type:spell.type||'E',location:loc,weapon:{effects:[]},source:spell.name});dealt=out.dealt}
    for(const effect of spell.effects||[]){if(/Freeze/i.test(effect))ConditionService.add(d.player,'frozen',Math.max(1,Dice.d(6)));if(/Blind/i.test(effect))ConditionService.add(d.player,'blinded',Math.max(1,Dice.d(6)));if(/Stagger/i.test(effect))ConditionService.add(d.player,'staggered',1);if(/Stun/i.test(effect))ConditionService.add(d.player,'stunned',1);if(/Grapple/i.test(effect))ConditionService.add(d.player,'grappled',1);if(/KnockDown/i.test(effect)&&Dice.d(100)<=Number(effect.match(/(\d+)/)?.[1]||50))ConditionService.add(d.player,'prone',1)}
    pushFeed(d,{kind:dealt?'hit':'action',title:`${e.name} — ${spell.name}`,story:NarrativeService.spell(e,spell,true,dealt,d.player),math:`${cast.text}; ${def.text}; cost ${spell.cost} STA.`});markAi(e,'cast',dealt>0||spell.tags?.includes('control'))
  }
});
ActionDispatcher.register('enemyRecover',{validate(s,p){const e=findActor(s,p.actorId);return e&&isHostile(e)&&e.sta<e.maxSta?{ok:true}:{ok:false,reason:'Recovery not useful.'}},spend(){},run(d,p){const e=findActor(d,p.actorId),b=e.sta;e.sta=Math.min(e.maxSta,e.sta+e.rec);markAi(e,'recover',true);pushFeed(d,{title:`${e.name} — recovers`,story:`${e.name} gives ground to breathing and balance instead of forcing a bad attack.`,math:`STA ${b} → ${e.sta}`})}});
ActionDispatcher.register('enemySurrender',{validate(s,p){const e=findActor(s,p.actorId);return e&&isHostile(e)&&!e.morale.fearImmune?{ok:true}:{ok:false,reason:'Cannot surrender.'}},spend(){},run(d,p){const e=findActor(d,p.actorId);offerSurrender(d,e);markAi(e,'surrender',true)}});
ActionDispatcher.register('enemyFlee',{validate(s,p){const e=findActor(s,p.actorId);if(!e||!isHostile(e))return{ok:false,reason:'Cannot flee.'};const plan=EscapeService.plan(s,e);if(!plan)return{ok:false,reason:'No viable escape route reaches a battlefield edge.'};p.escapePlan=plan;return{ok:true}},spend(){},run(d,p){const e=findActor(d,p.actorId),result=EscapeService.step(d,e,p.escapePlan);markAi(e,'flee',result.escaped||result.moved>0);if(!result.ok){e.retreat.state='cornered';e.ai.memory.blockedAction='flee';pushFeed(d,{title:`${e.name} cannot escape`,story:`${e.name} looks for a way out but every usable route is cut off.`,math:result.reason||'No viable route.'})}}});



function resolveBomb(d,p){const item=Registry.alchemy.get(p.itemId),t=findActor(d,p.targetId||d.selectedEnemyId),radius=Number(item.desc?.match(/(\d+)\s*m/)?.[1]||4),throwRoll=Dice.check(effectiveSkill(d.player,'Athletics'),{label:'Bomb throw'}),dc=15,onTarget=throwRoll.total>=dc,drift=onTarget?{...t.pos}:CombatRules.scatter(t.pos),center={x:Math.max(0,Math.min(GridService.W-1,drift.x)),y:Math.max(0,Math.min(GridService.H-1,drift.y))};if(!onTarget)pushFeed(d,{kind:'miss',title:`${item.name} goes wide`,story:`The throw is off. The ${item.name} lands ${Math.round(GridService.distance(t.pos,center))} m from ${t.name} and goes off there.`,math:`${throwRoll.text}; DC ${dc}; scattered to ${center.x},${center.y}.`});const victims=[d.player,...d.enemies].filter(e=>ActorStateService.attackable(e)&&GridService.distance(center,e.pos)<=radius);for(const e of victims){if(item.damage){const model=e.family==='Human'?'human':'monster';for(const row of HitLocations[model]){const loc={...row,rolled:null},dr=Dice.rollNotation(item.damage);DamageService.resolve(d,{attacker:d.player,target:e,raw:dr.total,type:item.name==='Grapeshot'?'P':'E',location:loc,weapon:{effects:[]},source:item.name})}}if(item.name==='Dancing Star')ConditionService.add(e,'burning');if(item.name==='Devil’s Puffball')ConditionService.add(e,'poisoned',3);if(item.name==='Dimeritium Bomb')ConditionService.add(e,'dimeritium',20);if(item.name==='Moon Dust')e.statuses.moonDust=20;if(item.name==='Northern Wind')ConditionService.add(e,'frozen',8);if(item.name==='Samum'){ConditionService.add(e,'blinded',6);ConditionService.add(e,'stunned',1)}}if(item.name==='Dancing Star')ZoneService.create(d,{type:'flame',center,radius,duration:2,source:item.name,metadata:{adaptation:'visual/terrain aftermath; Burning remains the core damage mechanic'}});if(item.name==='Devil’s Puffball')ZoneService.create(d,{type:'poisonCloud',center,radius,duration:3,source:item.name});if(item.name==='Dragon’s Dream')ZoneService.create(d,{type:'dreamCloud',center,radius,duration:3,source:item.name});if(item.name==='Dimeritium Bomb')ZoneService.create(d,{type:'dimeritiumCloud',center,radius,duration:20,source:item.name});if(item.name==='Moon Dust')ZoneService.create(d,{type:'moonDust',center,radius,duration:20,source:item.name});pushFeed(d,{kind:victims.some(v=>v.id===d.player.id)?'critical':'hit',title:item.name,story:`${item.name} bursts across a ${radius} m area and catches ${victims.length} target${victims.length===1?'':'s'}${victims.some(v=>v.id===d.player.id)?`, ${d.player.name} among them`:''}${d.map.zones.some(z=>z.source===item.name)?'; its lingering area remains visible on the map':''}.`,math:`${throwRoll.text}; explosive damage resolves separately against each location.`})}
ActionDispatcher.register('enemyBrownBurrow',{
  validate(s,p){const e=findActor(s,p.actorId);if(!e||!isHostile(e)||!CreatureAbilityService.hasTag(e,'burrower'))return{ok:false,reason:'This creature cannot burrow.'};if(e.ai.memory.lastBurrowRound===s.round-1)return{ok:false,reason:'It just came up from below; the ground needs a moment.'};return{ok:true}},
  spend(){},
  run(d,p){const e=findActor(d,p.actorId),target=d.player,candidates=[];for(let y=Math.max(0,target.pos.y-2);y<=Math.min(GridService.H-1,target.pos.y+2);y++)for(let x=Math.max(0,target.pos.x-2);x<=Math.min(GridService.W-1,target.pos.x+2);x++){if(GridService.tile(d,x,y)?.blocksMove||isOccupied(d,x,y,e.id))continue;candidates.push({x,y,dist:GridService.distance({x,y},target.pos)})}candidates.sort((a,b)=>a.dist-b.dist);const landing=candidates[0];if(landing)e.pos={x:landing.x,y:landing.y};const attack=Dice.check(20+(e.powerBonus||0),{label:'Burrowing Eruption'}),def=DefenseService.resolve(d,target,attack,{weapon:{name:'Burrowing Eruption'},actor:e,ranged:false});let dealt=0;if(attack.total>def.roll.total){const raw=Dice.rollNotation('6d6'),loc=Rules.location('human','torso'),out=DamageService.resolve(d,{attacker:e,target,raw:raw.total,type:'B',location:loc,weapon:{effects:['CrushingForce']},source:'Burrowing Eruption'});dealt=out.dealt;ConditionService.add(target,'prone');pushFeed(d,{kind:out.dealt?'critical':'hit',title:`${e.name} — Burrowing Eruption`,story:`The brown dragon vanishes into stone and soil. A heartbeat later the ground under ${d.player.name} ruptures and ${e.name} erupts from below in a storm of shattered earth.`,math:`${attack.text}; defense ${def.roll.text}; ${raw.text}; torso ${out.dealt} damage; prone.`})}else pushFeed(d,{kind:'miss',title:`${e.name} — Burrowing Eruption misses`,story:`The ground heaves beneath ${d.player.name}, but ${GrammarService.subject(d.player)} clears the eruption before stone and dragon can close around ${GrammarService.object(d.player)}.`,math:`${attack.text}; defense ${def.roll.text}.`});e.ai.memory.lastBurrowRound=d.round;markAi(e,'burrow',dealt>0)}
});

ActionDispatcher.register('enemyDragonBreath',{
  validate(s,p){const e=findActor(s,p.actorId);if(!e||!isHostile(e)||!e.breath)return{ok:false,reason:'No breath weapon.'};if(e.breath.cooldownRemaining>0)return{ok:false,reason:`Breath recovers in ${e.breath.cooldownRemaining} rounds.`};if(GridService.distance(e.pos,s.player.pos)>10)return{ok:false,reason:`${s.player.name} is outside the breath line.`};if(!GridService.los(s,e.pos,s.player.pos).clear)return{ok:false,reason:'The breath line is blocked.'};return{ok:true}},
  spend(){},
  run(d,p){const e=findActor(d,p.actorId),breath=e.breath,attack=Dice.check(20+(e.powerBonus||0),{label:breath.name}),def=DefenseService.resolve(d,d.player,attack,{weapon:{name:breath.name},actor:e,ranged:true}),hit=attack.total>def.roll.total;e.breath.cooldownRemaining=breath.cooldown;if(!hit){pushFeed(d,{kind:'miss',title:`${e.name} — ${breath.name} misses`,story:NarrativeService.dragonBreath(e,breath,false),math:`${attack.text}; defense ${def.roll.text}; cooldown ${breath.cooldown}.`});markAi(e,'breath',false);return}const raw=Dice.rollNotation(breath.damage),parts=HitLocations.human,damageRows=[];for(const row of parts){const loc={...row,rolled:null},before=DamageService.armorSlot(d.player,loc),out=DamageService.resolve(d,{attacker:e,target:d.player,raw:raw.total,type:breath.type||'E',location:loc,weapon:{effects:[]},source:breath.name,ranged:true});let ablate=breath.armorAblation==='halfDamage'?Math.max(1,Math.floor(raw.total/2)):Number(breath.armorAblation||0);if(ablate>0)DamageService.setArmorSlot(d.player,loc,Math.max(0,before-ablate));damageRows.push(`${loc.name} ${out.dealt}`);if(d.player.dead)break}if(breath.condition==='burning')ConditionService.add(d.player,'burning');if(breath.condition==='frozen')ConditionService.add(d.player,'frozen',8);pushFeed(d,{kind:'critical',title:`${e.name} — ${breath.name}`,story:NarrativeService.dragonBreath(e,breath,true),math:`${attack.text}; defense ${def.roll.text}; ${raw.text} to every body location · ${damageRows.join(' · ')}.`});markAi(e,'breath',true)}
});

ActionDispatcher.register('enemyShakeStun', {
  validate(state, payload) {
    const enemy = findActor(state, payload.actorId);
    return enemy && isHostile(enemy) && enemy.statuses.stunned ? { ok: true } : { ok: false, reason: 'Enemy is not stunned.' };
  },
  spend() {},
  run(draft, payload) {
    const enemy = findActor(draft, payload.actorId);
    const roll = Dice.d(10);
    const base = enemy.stats?.STUN || 6;
    if (roll <= base) {
      delete enemy.statuses.stunned;
      pushFeed(draft, { title: `${enemy.name} — stunned`, story: `${enemy.name} spends the turn recovering from the stun.`, math: `Stun save ${roll} ≤ ${base}.` });
    } else {
      pushFeed(draft, { title: `${enemy.name} — stunned`, story: `${enemy.name} reels and cannot recover enough to act.`, math: `Stun save ${roll} > ${base}.` });
    }
    markAi(enemy, 'recoverStun', true);
  }
});

ActionDispatcher.register('enemyStand', {
  validate(state, payload) {
    const enemy = findActor(state, payload.actorId);
    return enemy && isHostile(enemy) && enemy.statuses.prone ? { ok: true } : { ok: false, reason: 'Enemy is not prone.' };
  },
  spend() {},
  run(draft, payload) {
    const enemy = findActor(draft, payload.actorId);
    delete enemy.statuses.prone;
    markAi(enemy, 'stand', true);
    pushFeed(draft, { title: `${enemy.name} rises`, story: `${enemy.name} spends the immediate movement recovering footing.`, math: 'Prone cleared.' });
  }
});
// ============================================================================
// AI — legal actions, utility scoring, positioning, memory, controller.
// ============================================================================

const AI = (() => {
  const Memory = Object.freeze({
    note(enemy, action, meaningful) {
      AIProfileService.ensure(enemy);
      enemy.ai.recent.push(action);
      enemy.ai.recent = enemy.ai.recent.slice(-6);
      enemy.ai.stall = meaningful ? 0 : (enemy.ai.stall || 0) + 1;
      if(meaningful)enemy.ai.lastMeaningfulRound=Store.read()?.round||enemy.ai.lastMeaningfulRound||0;
      enemy.ai.lastDecision=action;
    }
  });

  const Positioning = Object.freeze({
    tileScore(state,enemy,pos,{preferredRange=2,target=state.player,needLos=false,mode='normal'}={}){
      const distance=GridService.distance(pos,target.pos),los=GridService.los(state,pos,target.pos),tile=GridService.tile(state,pos.x,pos.y),tier=AIProfileService.cognitionTier(enemy),profile=AIProfileService.profile(enemy),pattern=AITacticalState.playerPattern(state,enemy);
      let score=-Math.abs(distance-preferredRange)*5+(los.clear?12:-16)+(tile?.coverSp?Math.min(22,tile.coverSp*.7):0)-AITacticalState.zoneRisk(state,enemy,pos);
      // Terrain affinity: something amphibious fights where it is at home, and everything else
      // avoids ground that would penalise it. Both come from ability tags and terrain data.
      score+=terrainAffinity(tile,Registry.terrain,{waterNative:CreatureAbilityService.hasTag(enemy,WATER_NATIVE_TAG)});
      if(needLos&&!los.clear)score-=40;
      if(profile.tags.includes('pack')){
        const allies=AITacticalState.allies(state,enemy).filter(a=>GridService.distance(a.pos,target.pos)<=4);
        const occupiedAngles=new Set(allies.map(a=>Math.round(Math.atan2(a.pos.y-target.pos.y,a.pos.x-target.pos.x)*4/Math.PI)));
        const angle=Math.round(Math.atan2(pos.y-target.pos.y,pos.x-target.pos.x)*4/Math.PI);if(!occupiedAngles.has(angle))score+=8+Math.min(12,allies.length*3);
      }
      if(profile.tags.includes('skirmisher')||profile.tags.includes('formation'))score+=(tile?.coverSp||0)>0?10:0;
      if(pattern.ranged>=2&&tier>=3&&tile?.coverSp)score+=8;
      if(mode==='escape')score+=distance*3+(tile?.coverSp?10:0);
      if(mode==='breathSetup'){if(distance>=5&&distance<=10)score+=22;if(los.clear)score+=26;else score-=30;}
      if(mode==='close')score-=distance*4;
      return score;
    },
    desiredTile(state,enemy,preferredRange,options={}){
      const reachable=GridService.reachable(state,enemy,actorMoveBudget(state,enemy)),candidates=[];
      for(const [index,cost] of reachable){const {x,y}=GridService.pos(index),pos={x,y};let score=this.tileScore(state,enemy,pos,{preferredRange,...options})-cost;const weapon=enemy.weaponId&&Registry.weapons.get(enemy.weaponId);if(weapon&&weapon.range!=='melee'&&GridService.distance(pos,state.player.pos)<3)score-=30;candidates.push({x,y,score,cost})}
      candidates.sort((a,b)=>b.score-a.score);return candidates[0]||null;
    },
    bestEscapeTile(state,enemy,maxRange=20){let best=null;for(const tile of Object.values(state.map.tiles)){if(tile.blocksMove||isOccupied(state,tile.x,tile.y,enemy.id))continue;const dist=GridService.distance(enemy.pos,tile);if(dist>maxRange)continue;const score=this.tileScore(state,enemy,{x:tile.x,y:tile.y},{preferredRange:maxRange,target:state.player,mode:'escape'});if(!best||score>best.score)best={x:tile.x,y:tile.y,score}}return best},
  });

  const Planning = Object.freeze({
    refresh(state,enemy){
      const tier=AIProfileService.cognitionTier(enemy),distance=GridService.distance(enemy.pos,state.player.pos),los=GridService.los(state,enemy.pos,state.player.pos),hp=AITacticalState.woundedRatio(enemy),profile=AIProfileService.profile(enemy);
      let plan=null;
      const deathResponse=DeathStateTacticsService.response(enemy);
      if(EscapeService.isRouting(enemy))plan={id:'escape',label:'Reach a battlefield edge',priority:100,since:state.round};
      else if(enemy.death?.active&&deathResponse==='flee')plan={id:'deathFlee',label:'Escape while in Death State',priority:120,since:state.round};
      else if(enemy.death?.active&&deathResponse==='surrender')plan={id:'deathSurrender',label:'Yield rather than die',priority:118,since:state.round};
      else if(enemy.death?.active&&deathResponse==='withdraw')plan={id:'deathWithdraw',label:'Fall back while in Death State',priority:108,since:state.round};
      else if(enemy.death?.active&&deathResponse==='fight')plan={id:'deathFight',label:'Keep fighting in Death State',priority:104,since:state.round};
      else if(enemy.regen>0&&tier>=4&&hp<.48&&!enemy.statuses.moonDust)plan={id:'disengageRegenerate',label:'Break contact and regenerate',priority:94,since:state.round};
      else if(enemy.breath){
        if(enemy.breath.cooldownRemaining<=0&&(!los.clear||distance<5||distance>10))plan={id:'breathSetup',label:'Create a clean breath line',priority:92,since:state.round};
        else if(hp<.28&&tier>=4)plan={id:'dragonSurvival',label:'Use flight to preserve the dragon',priority:78,since:state.round};
      } else if(enemy.mage&&distance<3&&(enemy.mage.spells||[]).includes('Teleportation'))plan={id:'escapeMelee',label:'Escape melee before casting',priority:90,since:state.round};
      else if(profile.tags.includes('pack')&&AITacticalState.allies(state,enemy).length)plan={id:'surround',label:'Spread around the target',priority:64,since:state.round};
      else if((profile.tags.includes('skirmisher')||profile.tags.includes('formation'))&&(!los.clear||distance<Math.max(4,enemy.preferredRange*.5)))plan={id:'findLane',label:'Create a useful firing/attack lane',priority:60,since:state.round};
      if(!plan&&tier>=4){const pattern=AITacticalState.playerPattern(state,enemy);if(pattern.ranged>=3)plan={id:'denyRanged',label:'Deny repeated ranged attacks with cover or pressure',priority:56,since:state.round}}
      if(!plan&&enemy.ai?.plan&&state.round-(enemy.ai.planSince||enemy.ai.plan.since||0)<=Math.max(1,AIProfileService.cognition(enemy).planningDepth))plan=enemy.ai.plan;
      return plan;
    },
    bonus(enemy,action){const plan=action.plan?.id||enemy.ai?.plan?.id;if(!plan)return 0;const map={escape:{flee:35,reposition:18},deathFlee:{flee:60,reposition:20,attack:-30},deathSurrender:{surrender:70,flee:15,attack:-35},deathWithdraw:{reposition:48,recover:16,shoot:10,attack:-10},deathFight:{attack:30,shoot:26,cast:24,throwRock:18,reposition:-6},disengageRegenerate:{reposition:34,recover:10,attack:-8},breathSetup:{flight:34,reposition:28,breath:22,attack:-8},dragonSurvival:{flight:36,reposition:20,attack:-12},escapeMelee:{cast:34,reposition:18,attack:-12},surround:{reposition:22,attack:8,throwRock:6},findLane:{reposition:26,shoot:14,reload:8},denyRanged:{reposition:18,attack:12,flight:18}};return map[plan]?.[action.name]||0}
  });

  const LegalActions = Object.freeze({
    build(state,enemy){
      const plan=Planning.refresh(state,enemy),player=state.player,distance=GridService.distance(enemy.pos,player.pos),los=GridService.los(state,enemy.pos,player.pos),actions=[];
      const add=(name,base,actionName,payload={},meta={})=>actions.push({name,base,score:base,actionName,payload:{actorId:enemy.id,...payload},tags:meta.tags||[],resourceCost:meta.resourceCost||0,expectedDamage:meta.expectedDamage||0,controlValue:meta.controlValue||0,risk:meta.risk||0,futureValue:meta.futureValue||0,plan});

      if(EscapeService.isRouting(enemy)){const route=EscapeService.plan(state,enemy);if(route){add('flee',125,'enemyFlee',{}, {tags:['escape']});return actions}if(enemy.morale.surrender>0&&!enemy.morale.fearImmune)add('surrender',112,'enemySurrender')}
      if(enemy.death?.active){
        const response=DeathStateTacticsService.response(enemy);
        if(response==='flee')add('flee',150,'enemyFlee',{}, {tags:['escape','deathState']});
        else if(response==='surrender'&&!enemy.morale.fearImmune&&(enemy.morale.surrender||0)>0)add('surrender',150,'enemySurrender',{}, {tags:['surrender','deathState']});
        else if(response==='withdraw'){
          const tile=Positioning.bestEscapeTile(state,enemy,Math.max(3,actorMoveBudget(state,enemy)));
          if(tile)add('reposition',132,'enemyMove',{to:tile},{tags:['movement','deathState','withdraw'],futureValue:22,risk:-10});
          if(enemy.sta<enemy.maxSta)add('recover',88,'enemyRecover',{}, {tags:['resource','deathState'],futureValue:12});
        }
      }
      if(enemy.morale.state==='broken'&&!EscapeService.isRouting(enemy)&&!enemy.death?.active){const surrenderBias=Math.max(0,Math.min(1,Number(enemy.morale.surrender||0)));if(surrenderBias>0&&!enemy.morale.fearImmune)add('surrender',68+surrenderBias*45,'enemySurrender');add('flee',86+(1-surrenderBias)*18,'enemyFlee')}
      if(enemy.sta<=Math.max(2,enemy.maxSta*.12))add('recover',82,'enemyRecover',{}, {tags:['resource'],futureValue:18});

      // Nothing here asks what the creature is. A breath weapon and the
      // ability to burrow are things an actor either has or does not. Flight is an ability row.
      if(CreatureAbilityService.hasTag(enemy,'burrower')&&distance>2&&(!enemy.ai.memory.lastBurrowRound||enemy.ai.memory.lastBurrowRound<state.round-1))add('burrow',88+(player.statuses.prone?6:0),'enemyBrownBurrow',{}, {tags:['control','setup'],futureValue:14});
      if(enemy.breath&&enemy.breath.cooldownRemaining<=0&&distance<=10&&los.clear){let base=92;if(player.statuses.prone||player.statuses.stunned)base+=8;if(player.hp<player.maxHp*.4)base+=7;add('breath',base,'enemyDragonBreath',{}, {tags:['damage','area','breath'],expectedDamage:26,futureValue:8})}

      if(enemy.mage){
        const wounded=state.enemies.filter(x=>isHostile(x)&&x.hp<x.maxHp*.72).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0]||null,spellCtx={distance,health:enemy.hp/Math.max(1,enemy.maxHp),woundedAlly:wounded?wounded.hp/Math.max(1,wounded.maxHp):null,hasLineOfSight:los.clear,tier:AIProfileService.cognitionTier(enemy)};for(const spellName of enemy.mage.spells||[]){const spell=Registry.spells.get(slug(spellName));if(!spell||enemy.sta<spell.cost)continue;const candidate=spellCandidate(spell,spellCtx);if(candidate)add('cast',candidate.base,'enemyCast',{spellId:spell.id},candidate)}
      }

      // Creature abilities are ordinary candidates: they are scored against attacking, moving, and
      // fleeing rather than pre-empting them, so a griffin still bites when charging is worse.
      for(const option of CreatureAbilityService.available(state,enemy,player)){
        const candidate=abilityCandidate(option);
        add(candidate.name,candidate.base,'enemyAbility',{abilityId:option.id},candidate);
      }

      const mountedWeapon=enemy.weaponId&&Registry.weapons.get(enemy.weaponId);if(enemy.mounted&&enemy.mount&&mountedWeapon?.range==='melee'&&distance>Number(mountedWeapon.reach||2)&&distance<=actorMoveBudget(state,enemy)+Number(mountedWeapon.reach||2))add('mountedCharge',96+(mountedWeapon.effects?.includes('Charging')?10:0),'enemyMountedCharge',{}, {tags:['attack','melee','movement','charge'],expectedDamage:24,futureValue:6});
      const meleeAttacks=(enemy.attacks||[]).filter(a=>Number(a.range||2)<=4);for(const attack of meleeAttacks)if(distance<=Number(attack.range||2.2))add('attack',75+(player.statuses.prone?18:0)+(player.statuses.stunned?22:0)+(player.hp<player.maxHp*.35?12:0),'enemyMelee',{attack},{tags:['attack','melee'],expectedDamage:18});
      const weapon=enemy.weaponId&&Registry.weapons.get(enemy.weaponId);if(weapon?.range==='melee'&&distance<=Number(weapon.reach||2))add('attack',78+(player.statuses.prone?18:0)+(player.statuses.stunned?22:0),'enemyMelee',{}, {tags:['attack','melee'],expectedDamage:16});


      if(weapon&&weapon.range!=='melee'){
        if(enemy.ammo<=0){if(enemy.sidearmId)add('switch',96,'enemySwitchWeapon');else add('flee',80,'enemyFlee')}
        else if(weapon.effects?.includes('SlowReload')&&!enemy.loaded)add('reload',los.cover?84:58,'enemyReload',{}, {tags:['resource','reload'],futureValue:20});
        else if(los.clear&&distance<=Number(weapon.range)*2)add('shoot',80+(distance>=enemy.preferredRange*.7?8:0)+(player.statuses.prone?10:0),'enemyRanged',{}, {tags:['attack','ranged'],expectedDamage:15});
      }
      const innateRanged=(enemy.attacks||[]).find(a=>Number(a.range||0)>4);if(innateRanged&&los.clear&&distance<=Number(innateRanged.range))add('shoot',78,'enemyRanged',{attack:innateRanged},{tags:['attack','ranged'],expectedDamage:14});

      const desired=enemy.preferredRange||2,meleeReach=meleeAttacks.length?Math.max(...meleeAttacks.map(a=>Number(a.range||2))):2,shouldReposition=(meleeAttacks.length&&distance>meleeReach)||(weapon&&weapon.range!=='melee'&&enemy.ammo>0&&(!los.clear||distance<desired*.5))||['surround','findLane','disengageRegenerate','denyRanged','deathWithdraw'].includes(plan?.id);
      if(shouldReposition){const mode=['disengageRegenerate','deathWithdraw'].includes(plan?.id)?'escape':meleeAttacks.length?'close':'normal',tile=Positioning.desiredTile(state,enemy,desired,{needLos:!!(weapon&&weapon.range!=='melee'),mode});if(tile)add('reposition',meleeAttacks.length?68+Math.min(20,distance):72,'enemyMove',{to:tile},{tags:['movement','setup'],futureValue:14})}
      if(!actions.length){const tile=Positioning.desiredTile(state,enemy,desired,{mode:meleeAttacks.length?'close':'normal'});if(tile)add('reposition',60,'enemyMove',{to:tile},{tags:['movement']});else if(enemy.sta<enemy.maxSta)add('recover',40,'enemyRecover')}
      return actions;
    }
  });

  const Utility = Object.freeze({
    score(state,enemy,action){
      let score=action.base??action.score??0;const breakdown=[{label:'base tactical',value:Math.round(score)}],profile=AIProfileService.profile(enemy),cog=AIProfileService.cognition(enemy),personality=AIProfileService.personality(enemy),tier=AIProfileService.cognitionTier(enemy),doctrines=AIProfileService.doctrines(enemy),distance=(enemy?.pos&&state.player?.pos)?GridService.distance(enemy.pos,state.player.pos):99,hp=AITacticalState.woundedRatio(enemy),playerHp=state.player.hp/Math.max(1,state.player.maxHp),add=(label,value)=>{if(!value)return;score+=value;breakdown.push({label,value:Math.round(value)})};
      add('plan',Planning.bonus(enemy,action));
      add('profile',Number(profile.weights?.[action.name]||0));
      for(const doctrine of doctrines){for(const tag of action.tags||[])add(`${doctrine.name}: ${tag}`,Number(doctrine.weights?.[tag]||0));add(`${doctrine.name}: action`,Number(doctrine.weights?.[action.name]||0))}
      if(action.tags?.includes('attack')&&playerHp<.35)add('wounded target',6+tier*2);
      if(action.tags?.includes('control')&&(state.player.statuses.prone||state.player.statuses.stunned||state.player.statuses.grappled))add('control already established',-10);
      if(action.tags?.includes('ranged')&&enemy?.pos&&GridService.tile(state,enemy.pos.x,enemy.pos.y)?.coverSp)add('firing from cover',6+cog.coordination*6);
      if(action.tags?.includes('movement')){const dest=action.payload?.to;if(dest)add('destination safety',-AITacticalState.zoneRisk(state,enemy,dest)*cog.hazardAwareness)}
      if(action.resourceCost){const reserve=enemy.sta/Math.max(1,enemy.maxSta),costPressure=action.resourceCost/Math.max(1,enemy.maxSta);add('resource cost',-(costPressure*40)*(1+(1-reserve))*((1-personality.riskTolerance)+.6));}
      if(action.name==='recover')add('low stamina',enemy.sta<enemy.maxSta*.25?26:enemy.sta<enemy.maxSta*.5?10:-12);
      if(action.name==='reposition'&&distance<=2&&profile.tags.includes('giant'))add('giant prefers contact',-12);
      if(action.name==='throwRock'&&distance>6)add('harass while closing',10);if(action.name==='mountedCharge')add('mounted momentum',12+AIProfileService.cognitionTier(enemy)*2);
      if(action.name==='cast'&&enemy.mage&&distance<3)add('caster under melee pressure',action.tags?.includes('escape')?24:action.tags?.includes('control')?8:-12);
      if(action.name==='breath'){add('breath geometry',distance>=5&&distance<=10?12:-8);if(KnowledgeService.knows(enemy,'playerRanged',state.player.id))add('deny ranged posture',4*tier)}
      if(action.tags?.includes('flight'))add('uses vertical mobility',8+tier*2);
      if(enemy.regen>0&&tier>=4&&hp<.5&&!enemy.statuses?.moonDust){if(action.name==='reposition')add('regeneration window',18+tier*2);if(action.name==='attack')add('avoid bad trade while regenerating',-8)}
      if(enemy.morale?.state==='panicked'){if(['flee','surrender','reposition'].includes(action.name))add('panic',12*(personality.selfPreservation||.5));if(action.name==='attack')add('panic attack penalty',-8*(personality.selfPreservation||.5))}
      if(enemy.morale?.state==='broken'&&['flee','surrender'].includes(action.name))add('broken morale',24);
      // Tactical judgement a thinking opponent would make. Gated on cognition tier inside
      // `tacticalInsight`, so a drowner still charges blindly and a mastermind reads the fight.
      for(const insight of tacticalInsight(action,insightContext(state,enemy,state.player,{
        tier,distance,health:hp,targetHealth:playerHp,
        allies:state.enemies.filter(x=>x.id!==enemy.id&&!x.dead&&!x.fled&&isHostile(x)).length
      })))add(insight.label,insight.value);
      const context=Pipeline.emit('ai:score',{state,enemy,action,score,breakdown});score=context.score;return{score,breakdown:context.breakdown||breakdown};
    },
    rank(state,enemy,actions){return actions.map(action=>{const result=this.score(state,enemy,action);return{...action,score:result.score,breakdown:result.breakdown}}).sort((a,b)=>b.score-a.score)}
  });

  const Controller = Object.freeze({
    decide(state,enemy){
      if(!isHostile(enemy))return null;
      if(enemy.statuses.stunned)return{name:'recoverStun',score:100,actionName:'enemyShakeStun',payload:{actorId:enemy.id},scores:[{name:'recoverStun',score:100,breakdown:[{label:'stunned',value:100}]}],plan:enemy.ai.plan};
      if(enemy.statuses.prone)return{name:'stand',score:100,actionName:'enemyStand',payload:{actorId:enemy.id},scores:[{name:'stand',score:100,breakdown:[{label:'prone',value:100}]}],plan:enemy.ai.plan};
      const candidates=LegalActions.build(state,enemy),rejected=[],legal=[];for(const action of candidates){const verdict=ActionDispatcher.validate(action.actionName,{...action.payload},state);if(verdict.ok)legal.push(action);else rejected.push({name:action.name,reason:verdict.reason||'illegal'})}
      const ranked=Utility.rank(state,enemy,legal),best=ranked[0];if(!best)return null;
      return{...best,scores:ranked.slice(0,7).map(a=>({name:a.name,score:Math.round(a.score),breakdown:a.breakdown?.slice(0,8)||[]})),rejected:rejected.slice(0,8),plan:best.plan||enemy.ai?.plan||null,profile:AIProfileService.profile(enemy).name,cognition:AIProfileService.cognition(enemy).name,tier:AIProfileService.cognitionTier(enemy)};
    }
  });

  Pipeline.on('action:beforeRun',context=>{
    const decision=context.payload?.aiDecision;if(!decision)return;const enemy=findActor(context.state,context.actorId);if(!enemy)return;enemy.ai.scores=decision.scores||[];enemy.ai.rejections=decision.rejected||[];if(decision.plan){if(enemy.ai.plan?.id!==decision.plan.id)enemy.ai.planSince=context.state.round;enemy.ai.plan=decision.plan}else enemy.ai.plan=null;enemy.ai.debugProfile=decision.profile||AIProfileService.profile(enemy).name;enemy.ai.debugCognition=`${decision.cognition||AIProfileService.cognition(enemy).name} · tier ${decision.tier??AIProfileService.cognitionTier(enemy)}`;
    if(decision.name==='recoverStun'||decision.name==='stand')return;const barkKind=decision.name==='surrender'?'surrender':decision.name==='flee'?'retreat':'attack',bark=DialogueService.line(context.state,enemy,barkKind);pushFeed(context.state,{title:`${enemy.name} — intent`,story:`${aiIntent(enemy,decision.name)}${enemy.ai.plan?.label?` Plan: ${enemy.ai.plan.label}.`:''}${bark?(enemy.exceptional==='dragon'?` Telepathy: “${bark}”`:` “${bark}”`):''}`,math:context.state.ui.aiDebug?enemy.ai.scores.slice(0,4).map(entry=>`${entry.name} ${entry.score}`).join(' · '):''});
  },50);

  return Object.freeze({Memory,Positioning,Planning,LegalActions,Utility,Controller});
})();

function markAi(enemy, action, meaningful) {
  AI.Memory.note(enemy, action, meaningful);
}

function aiIntent(enemy, action) {
  return {
    attack: `${enemy.name} commits to a viable close attack.`,
    mountedCharge: `${enemy.name} lowers the weapon and commits horse and rider to a straight charge lane.`,
    shoot: `${enemy.name} has a firing line and means to use it.`,
    reload: `${enemy.name} is trying to get the ranged weapon back into play.`,
    switch: `${enemy.name} is out of ammunition and reaches for a sidearm.`,
    cast: `${enemy.name} is shaping a spell around the current opening.`,
    breath: `${enemy.name} draws back and gathers a full breath attack.`,
    burrow: `${enemy.name} drops beneath the ground to attack from below.`,
    flight: `${enemy.name} uses flight to change the geometry instead of accepting a poor ground exchange.`,
    throwRock: `${enemy.name} uses a simple thrown object to harass the target before committing.`,
    reposition: `${enemy.name} is moving toward a useful range, angle, or firing line.`,
    recover: `${enemy.name} is too spent to force a good exchange and is recovering.`,
    surrender: `${enemy.name}'s nerve has broken; the weapon is starting to lower.`,
    flee: `${enemy.name} breaks and runs for a reachable map edge. Until that edge is reached, the retreat can still be intercepted.`
  }[action] || `${enemy.name} acts.`;
}
// ---------- Action result narration ----------
const flavor={head:[`{A}'s strike snaps {T}'s head aside; vision and balance are immediately under pressure.`,`{A} lands high across {T}'s face and skull. Blood and ringing ears make the location unmistakable.`,`The blow catches {T} at the head; even without a critical wound, the next second becomes dangerous.`],torso:[`{A} drives into {T}'s torso, folding force into ribs, breath, and core.`,`The attack lands through {T}'s chest-and-abdomen line; breath shortens around the impact.`,`{A}'s hit bites into {T}'s torso and the whole body has to absorb it.`],rightArm:[`The strike tears into {T}'s right arm; grip and guard on that side become the immediate problem.`,`{T}'s right arm takes the blow directly, threatening leverage and weapon control.`,`Pain runs from {T}'s right arm into hand and shoulder as the attack lands.`],leftArm:[`The strike tears into {T}'s left arm; grip and guard on that side become the immediate problem.`,`{T}'s left arm takes the blow directly, threatening leverage and weapon control.`,`Pain runs from {T}'s left arm into hand and shoulder as the attack lands.`],rightLeg:[`The hit catches {T}'s right leg; weight-bearing and hard changes of direction now run through the injury.`,`The attack lands into {T}'s right leg and immediately threatens stable footing.`,`{T}'s right leg takes the force; the next planted step has to carry the hurt.`],leftLeg:[`The hit catches {T}'s left leg; weight-bearing and hard changes of direction now run through the injury.`,`The attack lands into {T}'s left leg and immediately threatens stable footing.`,`{T}'s left leg takes the force; the next planted step has to carry the hurt.`],rightLimb:[`The attack tears into {T}'s right limb and compromises how that side can bear force.`,`{T}'s right limb catches the strike cleanly.`,`The right side takes the hit and {T}'s movement changes around it.`],leftLimb:[`The attack tears into {T}'s left limb and compromises how that side can bear force.`,`{T}'s left limb catches the strike cleanly.`,`The left side takes the hit and {T}'s movement changes around it.`],special:[`The attack catches {T}'s unusual anatomy and damages something human fighters do not have to protect.`,`{A} lands on {T}'s tail, wing, or specialized body structure.`,`The strike finds {T}'s nonhuman anatomy and interferes with the way the creature moves or fights.`]};
function hitFlavor(a,t,w,damage){return NarrativeService.attackHit(a,t,w,damage)}
function missFlavor(a,t,w){return NarrativeService.attackMiss(a,t,w)}
function recordAttackOutcome(d,out){if(isPlayerControlled(out.actor))d.battleMemory.playerTactics.push({round:d.round,type:out.weapon.range==='melee'?'melee':'ranged',weapon:out.weapon.name});for(const r of out.results){if(!r.hit){pushFeed(d,{kind:'miss',title:`${out.actor.name} misses`,story:r.story||r.reason||`${out.actor.name}'s attack misses ${out.target.name}.`,math:r.roll?`${r.roll.text}; defense ${r.defense.roll.text}`:r.reason});requestPresentationEffect('miss',.15);continue}const x=r.damage,critical=r.critical;if(x.blocked){pushFeed(d,{kind:'miss',title:`${x.blockedBy||'Defense'} holds`,story:r.story,math:`${r.roll.text}; defense ${r.defense.roll.text}; ${x.reason||'damage negated'}`});continue}pushFeed(d,{kind:critical?'critical':'hit',title:critical?`${critical.tier.toUpperCase()} CRITICAL — ${x.location.name}`:`${x.dealt} damage — ${x.location.name}`,story:r.story+(x.injury?` Critical wound: ${x.injury.name}. ${x.injury.fresh}.`:''),math:`${r.roll.text}; defense ${r.defense.roll.text}; raw ${x.raw}; armor ${x.armor}${x.coverSp?`; cover ${x.coverSp}`:''}; ×${x.location.mult}; dealt ${x.dealt}.`});if(x.dealt>0)out.target.recentHit=x.location.id}}
function findActor(s,id){return ActorAccess.find(s,id)}
function offerSurrender(d,e){d.ui.pendingSurrender=e.id;pushFeed(d,{title:`${e.name} tries to surrender`,story:`${e.name} breaks off the attack and makes it unmistakably clear that the fight is being yielded.`,math:'Combat pauses for the player decision.'})}
// ============================================================================
// COMBAT FLOW — the only owner of setup -> player -> enemy -> interruption -> end.
// ============================================================================

const CombatFlow = (() => {
  let generation = 0;
  let enemyPhaseScheduled = false;
  let enemyPhaseRunning = false;
  const ENEMY_ACTION_PACE_MS = 80;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function invalidateScheduledWork() {
    generation++;
    enemyPhaseScheduled = false;
    enemyPhaseRunning = false;
  }

  function start({ encounter = null, lineup = null, situation }) {
    invalidateScheduledWork();
    Store.update(draft => {
      const preservedSetup=Core.clone(draft.setup||defaultState().setup);
      Object.assign(draft, defaultState());
      draft.setup=preservedSetup;

      draft.phase = 'combat';
      draft.round = 1;
      draft.player = createPlayer();
      draft.enemies = lineup?.length ? EncounterFactory.build(lineup) : EncounterFactory.make(encounter || 'bandits');
      draft.selectedEnemyId = draft.enemies[0]?.id || null;
      draft.map = { tiles: createTiles(), visibilityPenalty: 0, zones: [] };

      Pipeline.emit('situation:apply', { state: draft, kind: situation });
      const zones = SituationService.zones();
      DeploymentService.placeOne(draft, draft.player, zones.player);
      DeploymentService.placeGroup(draft, draft.enemies, zones.enemy);

      Pipeline.emit('combat:beforeStart', { state: draft });
      Pipeline.emit('turn:begin', { state: draft, side: 'player' });
      pushFeed(draft, {
        title: 'Battle begins',
        story: `${draft.player.name} faces ${draft.enemies.length} opponent${draft.enemies.length === 1 ? '' : 's'} in ${situation.replace(/([A-Z])/g, ' $1').toLowerCase()}.`,
        math: 'Standard action economy.'
      });
    }, { checkpoint: true, label: 'start battle' });
  }

  function stop() {
    invalidateScheduledWork();
    Store.update(draft => {
      draft.phase = 'setup';
      draft.turn.side = 'none';
      draft.ui.pendingSurrender = null;
      draft.ui.pendingVictory = false;
      draft.ui.pendingDefeat = false;
      draft.ui.pendingLoot = false;
      pushFeed(draft, {
        title: 'Battle stopped',
        story: 'The active combat loop is stopped. No AI remains scheduled.',
        math: ''
      });
    }, { checkpoint: true, label: 'stop battle' });
  }

  function reset() {
    invalidateScheduledWork();
    Store.reset();
  }

  function scheduleEnemyPhase() {
    if (enemyPhaseScheduled || enemyPhaseRunning) return;
    const token = generation;
    enemyPhaseScheduled = true;
    queueMicrotask(() => {
      enemyPhaseScheduled = false;
      if (token !== generation) return;
      void runEnemyPhase(token);
    });
  }

  async function runEnemyPhase(token = generation) {
    if (enemyPhaseRunning) return;
    enemyPhaseRunning = true;
    try {
      let state = Store.read();
      if (token !== generation || state.phase !== 'combat' || state.turn.side !== 'enemy') return;

      let cursor = state.turn.enemyCursor || 0;
      while (cursor < state.enemies.length) {
        state = Store.read();
        if (token !== generation || state.phase !== 'combat' || state.player.dead || state.ui.pendingSurrender) break;

        const enemyId = state.enemies[cursor]?.id;
        cursor++;
        Store.update(draft => { draft.turn.enemyCursor = cursor; }, { silent: true });

        let currentState = Store.read();
        let current = findActor(currentState, enemyId);
        if(current?.death?.active&&!current.dead){
          Store.update(draft=>{const c=findActor(draft,enemyId);if(c?.death?.active&&!c.dead){const save=DeathStateService.save(draft,c,'Start of turn');if(save?.ok&&!c.dead)DeathStateTacticsService.prepare(draft,c,{force:true})}});
          currentState=Store.read();current=findActor(currentState,enemyId);
        }
        if(current&&PuppetService.isControlled(current)){
          Store.update(draft=>{const c=findActor(draft,enemyId);if(c&&!PuppetService.resist(draft,c)&&PuppetService.isControlled(c))PuppetService.act(draft,c)});
        } else if (current && isHostile(current)) {
          const decision = AI.Controller.decide(currentState, current);
          if (decision) ActionDispatcher.execute(decision.actionName, { ...decision.payload, aiDecision: { name: decision.name, scores: decision.scores, rejected: decision.rejected, plan: decision.plan, profile: decision.profile, cognition: decision.cognition, tier: decision.tier } });
        }

        Store.update(draft => { Pipeline.emit('combat:checkEnd', { state: draft }); }, { silent: true });
        Store.notify();
        if (Store.read().ui.pendingSurrender || Store.read().phase !== 'combat') break;

        // Give the presentation adapter one visible beat per acting enemy. This
        // also yields the browser thread between expensive AI/pathfinding bursts.
        await delay(ENEMY_ACTION_PACE_MS);
        if (token !== generation) return;
      }

      state = Store.read();
      if (token !== generation || state.phase !== 'combat' || state.ui.pendingSurrender) return;
      if (cursor >= state.enemies.length) {
        Store.update(draft => {
          draft.round++;
          draft.turn.enemyCursor = 0;
          Pipeline.emit('turn:begin', { state: draft, side: 'player' });
          draft.battleMemory.roundMeaningful = false;
        });
      }
    } finally {
      enemyPhaseRunning = false;
    }
  }

  Pipeline.on('surrender:resolved', context => {
    if (context.resumeEnemy) scheduleEnemyPhase();
  }, 0);

  Pipeline.on('action:after', context => {
    const state = Store.read();
    const spentEverything = isPlayerControlled(findActor(state, context.actorId))
      && state.phase === 'combat'
      && state.turn.side === 'player'
      && state.turn.action <= 0
      && (state.turn.extraAttackUsed || state.player.sta < 1)
      && state.turn.movement <= 0;

    if (spentEverything) queueMicrotask(() => ActionDispatcher.execute('endTurn', { actorId: state.player.id, automatic: true }));
  }, -100);

  return Object.freeze({ start, stop, reset, scheduleEnemyPhase, runEnemyPhase, invalidateScheduledWork });
})();

export { AI, AIProfileService, AITacticalState, ActionDispatcher, ActionGateway, ActorAccess, ActorComposer, ActorStateService, AnatomyService, AttackService, BattlefieldObjectService, BrawlRules, CharacterRegistryService, CombatFlow, ConditionService, Core, CreatureHistoryService, CriticalService, DamageService, DeathStateService, DeathStateTacticsService, DefeatService, DefenseService, DialogueService, Dice, DiceService, DirtyTileService, DragonHoardService, EncounterCatalog, EncounterFactory, EncounterRegionService, EquipmentStateService, EscapeService, EventPipeline, ExceptionalIdentityService, GrammarService, GridService, HarvestService, Heroes, HitLocations, KnowledgeService, LifeHistoryService, LootService, MoraleService, MountedCombatService, NarrativeService, ObjectiveService, Pipeline, PronounSets, PuppetService, Random, ReactionAssessmentService, ReactionService, Registry,   Rules, SeededRng, SituationService, Store, TargetingService, TeamService, TesterService, TravelHistoryService, VariantService, ZoneService, ZustandHistoryStore, actorMoveBudget, aiIntent, applyWeaponEffects, attackBase, baseActor, clone, createPlayer, createTiles, deepFreeze, defaultState, effectiveSkill, ensureUniqueNames, findActor, findApproach, findClosestReachable, findFiringTile, flavor, hitFlavor, human, invariant, isActiveOnMap, isHostile, isOccupied, mageSchoolLabel, mageSpellsFor, mageSpellsForSchool, maintainActiveSigns, markAi, missFlavor, nextId, offerSurrender, parseEffects, parseResistance, pick, pickWeighted, pushFeed, recordAttackOutcome,      requestPresentationEffect, resolveBomb, resolveMagicTraps, slug, spendActionResource, validCombat, validateActionResource, validateState };
