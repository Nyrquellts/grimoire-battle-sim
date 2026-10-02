import { RegistryHub, RegistrySchemas } from './RegistryHub';
import { registerMagicContent, signResolution } from './content/magic';
import { registerTerrainContent } from './content/terrain';
import { registerBattlefieldContent } from './content/battlefields';
import { abilitiesFor, registerCreatureAbilityContent, variantAbilitiesFor } from './content/creatureAbilities';
export { abilitiesFor, variantAbilitiesFor };
import { registerScenarioContent } from './content/scenarios';
import { registerCharacterCreationContent, WEAPON_TRAITS } from './content/characterCreation';
import { registerHeroPresetContent } from './content/heroPresets';
import type { ContentRecord } from '../entities/types';
import {
  RAW_POTIONS, RAW_DECOCTIONS, RAW_BOMBS, RAW_WEAPONS, RAW_CRITICALS,
  RAW_CORE_BESTIARY, EXTENDED_BESTIARY_RAW, ARCANE_BESTIARY_RAW, MAGE_SPELL_CATALOG
} from './raw/witcherData';
import { CORE_BESTIARY_STATS } from './raw/coreBestiaryStats';
import { SUPPLEMENT_BESTIARY_STATS } from './raw/supplementBestiaryStats';

/**
 * Witcher content registration.
 *
 * Everything here is *content*: weapons, bestiary rows, Signs, spells, alchemy, conditions,
 * critical wounds, terrain, voices, loot and harvest tables, anatomies, objectives, AI profiles,
 * archetypes, and battlefield presets. Rules live in `src/services`; this module only declares what
 * exists and hands it to the registry.
 *
 * This is the Witcher-specific layer. The generic tactical foundation must never import it — it
 * queries whatever content the host game registered.
 *
 * Registration runs once at import time, as it did when this lived inside the simulation bridge.
 */

/** Stable id from a display name. */
export function slug(s: unknown): string {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Parses the free-text `effect` column of imported bestiary attacks into effect tags. */
export function parseEffects(text: unknown): string[] {
  const t=String(text||'');const a=[];if(/bleed/i.test(t)){const n=Number(t.match(/bleed(?:ing)?\s*\(?([0-9]+)/i)?.[1]||50);a.push(`Bleeding${n}`)}if(/armor piercing/i.test(t))a.push(/improved/i.test(t)?'ImprovedArmorPiercing':'ArmorPiercing');if(/long reach/i.test(t))a.push('LongReach');if(/crushing force/i.test(t))a.push('CrushingForce');if(/stun/i.test(t))a.push('Stun');if(/poison/i.test(t))a.push('Poison');if(/fire/i.test(t))a.push('Fire');if(/disease/i.test(t))a.push('Disease');if(/drain blood/i.test(t))a.push('DrainBlood');return a
}

/** The single content registry instance every rule queries. */
export const Registry = new RegistryHub(RegistrySchemas);









/**
 * Overlays a supplement stat block onto a profile.
 *
 * A supplement block carries defense bases and per-attack values outright, so where one exists it
 * replaces the engine's approximations wholesale. Fields the block does not carry — family, AI
 * profile, loot — are left untouched.
 */
const withBlock=(id: string,r: ContentRecord): ContentRecord=>{
  const block=SUPPLEMENT_BESTIARY_STATS[id];
  if(!block)return r;
  return{...r,
    stats:{...(r.stats||{}),...block.stats},
    hp:block.hp,maxHp:block.hp,armor:block.armor,regen:block.regen||r.regen||0,
    sta:block.sta??r.sta,maxSta:block.sta??r.maxSta,rec:block.rec??r.rec,
    run:block.run??r.run,leap:block.leap??r.leap,enc:block.enc??r.enc,
    dodge:block.dodgeDefense??r.dodge,reposition:block.repositionDefense??r.reposition,
    block:block.blockDefense??r.block,
    resistances:block.resistances?.length?block.resistances:r.resistances,
    immunities:block.immunities?.length?block.immunities.map(x=>String(x).toLowerCase()):r.immunities,
    skills:{...(r.skills||{}),...(block.skills||{})},
    attacks:block.attacks.length?block.attacks.map(a=>({name:a.name,attack:a.attack,type:a.type,damage:a.damage,rel:a.rel,range:a.range,effect:a.effect,rof:a.rof})):r.attacks
  };
};

// ---------- Data: registries are declarative LEGO pieces ----------
const registerCoreContent=()=>{
  for(const [id,w] of Object.entries(RAW_WEAPONS))Registry.add('weapons',id,{...w,...(WEAPON_TRAITS[id]??{}),skill:w.range==='melee'?'Melee':'Ranged'});
  Registry.add('weapons','manticoreSteel',{name:'Curved Manticore steel sword',short:'Steel sword',combatSkill:'Swordsmanship',type:'S',wa:1,damage:'5d6+6',rel:15,hands:1,range:'melee',reach:2,effects:['ArmorPiercing','Meteorite','Balanced']});
  Registry.add('weapons','manticoreSilver',{name:'Curved Manticore silver sword',short:'Silver sword',combatSkill:'Swordsmanship',type:'S',wa:1,damage:'2d6+6',silverDamage:'3d6',rel:10,hands:1,range:'melee',reach:2,effects:['Balanced','Silver']});
  Registry.add('weapons','sipar',{name:'Manticore Sipar',short:'Sipar',combatSkill:'Melee (Shield)',type:'B',wa:0,damage:'1d6+6',silverDamage:'3d6',rel:20,hands:1,range:'melee',reach:2,effects:['Shield','Meteorite','Silver']});
  Registry.add('weapons','zerrikanianCrossbow',{name:'Zerrikanian hand crossbow',short:'Hand crossbow',combatSkill:'Crossbow',type:'P',wa:1,damage:'2d6+2',rel:5,hands:1,range:50,effects:['SlowReload']});

  const normalizeRaw=(id: string,r: ContentRecord)=>({name:r.name,family:r.family,hp:r.hp,maxHp:r.hp,armor:r.armor||0,regen:r.regen||0,stats:r.stats||{},defenses:{dodge:r.dodge??r.defense??10,reposition:r.reposition??r.dodge??10,block:r.block??r.defense??10,magic:r.magicDefense??10},attacks:(r.attacks||[]).map((a: ContentRecord)=>({name:a.name,attack:a.attack??10,type:a.type||'B',damage:a.damage||'1d6',reliability:a.rel,range:a.range||2,effects:parseEffects(a.effect||''),rof:a.rof||1})),abilities:r.abilities||[],sta:r.sta,maxSta:r.sta,rec:r.rec,run:r.run,leap:r.leap,enc:r.enc,skills:r.skills,genderRule:['Construct','Elementa'].includes(r.family)?'none':'biological'});
  for(const [id,r] of Object.entries(RAW_CORE_BESTIARY) as Array<[string, ContentRecord]>){
    // The stat block's numbers win. `witcherData.ts` keeps what a block does not carry — family,
    // AI profile, loot, silver vulnerability — and `coreBestiaryStats.ts` supplies everything it
    // does. Where a creature has no stat block yet, the existing profile stands.
    const block=CORE_BESTIARY_STATS[id];
    const merged: ContentRecord=block?{...r,
      stats:{...(r.stats||{}),...block.stats},
      hp:block.hp,maxHp:block.hp,armor:block.armor,
      sta:block.sta??undefined,maxSta:block.sta??undefined,rec:block.rec,vigor:block.vigor,
      run:block.run,leap:block.leap,enc:block.enc,bounty:block.bounty,
      skills:{...(r.skills||{}),...block.skills},
      dodgeDefense:block.dodgeDefense,repositionDefense:block.dodgeDefense,
      blockDefense:block.blockDefense,magicDefense:block.magicDefense,
      attacks:block.attacks.map(a=>({name:a.name,attack:a.attack,type:a.type,damage:a.damage,range:a.range,effect:a.effect,rof:a.rof}))
    }:r;
    const attacks=merged.attacks?.length?merged.attacks:[{name:merged.damageType==='P'?'Bite':'Attack',attack:merged.attack||10,type:merged.damageType||'B',damage:merged.damage||'2d6',range:2,effects:[],rof:1}];
    Registry.add('bestiary',id,{...merged,maxHp:merged.maxHp||merged.hp,defenses:{dodge:merged.dodgeDefense??merged.defense??10,reposition:merged.repositionDefense??merged.defense??10,block:merged.blockDefense??merged.defense??10,magic:merged.magicDefense??10},attacks:attacks.map((a: ContentRecord)=>({...a,effects:parseEffects(a.effect||'')})),genderRule:merged.family==='Human'?'human':(['Construct','Elementa'].includes(merged.family)?'none':'biological')})
  }
  for(const [id,r] of Object.entries(EXTENDED_BESTIARY_RAW)){const clean=id.replace('_ext','');if(Registry.bestiary.has(clean))continue;Registry.add('bestiary',clean,normalizeRaw(clean,withBlock(clean,r as ContentRecord)))}
  for(const [id,r] of Object.entries(ARCANE_BESTIARY_RAW)){if(Registry.bestiary.has(id))continue;Registry.add('bestiary',id,normalizeRaw(id,withBlock(id,r as ContentRecord)))}
  Registry.add('bestiary','truedragon',{id:'truedragon',name:'True Dragon',family:'Draconid',hp:150,maxHp:150,sta:80,maxSta:80,rec:16,armor:25,regen:0,stats:{INT:7,REF:14,DEX:13,BODY:20,SPD:10,EMP:8,CRA:5,WILL:10,STUN:10},defenses:{dodge:24,reposition:22,block:23,magic:20},attacks:[{name:'Bite',attack:23,damage:'10d6',type:'P',effects:['CrushingForce','LongReach','ArmorPiercing','Ablating'],rof:1,range:4},{name:'Claw Slash',attack:23,damage:'8d6',type:'S',effects:['CrushingForce','LongReach','Bleeding75','KnockDown50','Ablating'],rof:3,range:4},{name:'Wing Buffet',attack:23,damage:'5d6+3',type:'B',effects:['CrushingForce','LongReach','KnockDown75','Stun-2'],rof:2,range:4}],abilities:['Pounce 6m','Flight 30m','Fire Breath 10m cone; 7d6 all locations','Telepathy'],silver:true,steelResistant:true,immunities:['bleeding','prone','ordinaryFire'],vulnerabilities:['Draconid Oil'],genderRule:'biological',exceptional:'dragon'});
  Registry.add('bestiary','highervampire',{id:'highervampire',name:'Higher Vampire',family:'Vampire',hp:100,maxHp:100,sta:60,maxSta:60,rec:12,armor:8,regen:20,stats:{INT:10,REF:15,DEX:16,BODY:12,SPD:12,EMP:8,CRA:7,WILL:8,STUN:10},defenses:{dodge:25,reposition:26,block:24,magic:20},attacks:[{name:'Bite',attack:24,damage:'6d6',type:'P',effects:['Bleeding100','ImprovedArmorPiercing','DrainBlood'],rof:1,range:2},{name:'Claw Slash',attack:24,damage:'5d6+3',type:'S',effects:['Bleeding75','Balanced'],rof:4,range:2}],abilities:['Superior Invisibility','Immortal regeneration 20 HP/round','Mutable Form','Magical Influence'],silver:true,silverImmune:true,steelResistant:true,immunities:['ordinaryFire'],vulnerabilities:['Vampire Oil','Black Blood','Magical fire'],genderRule:'biological',exceptional:'higherVampire'});

  const signs=[
    ['aard',{name:'Aard',family:'Aard',element:'Air',alternate:false,cost:'Variable',maxCost:7,range:2,shape:'cone',duration:'Immediate',defense:['Dodge','Magical Shield'],description:'Staggers; 10% knockdown chance per STA invested.'}],
    ['igni',{name:'Igni',family:'Igni',element:'Fire',alternate:false,cost:'Variable',maxCost:7,range:2,shape:'cone',duration:'Immediate',defense:['Dodge','Block','Magical Shield'],description:'1d6 damage per STA; 50% chance to ignite.'}],
    ['quen',{name:'Quen',family:'Quen',element:'Earth',alternate:false,cost:'Variable',maxCost:7,range:0,shape:'self',duration:'Until exhausted',defense:[],description:'Blocks one failed attack per STA spent.'}],
    ['yrden',{name:'Yrden',family:'Yrden',element:'Mixed',alternate:false,cost:'Variable',maxCost:7,range:3,shape:'radius',duration:'5 rounds',defense:[],description:'SPD and REF penalty equal to STA; incorporeal creatures become corporeal.'}],
    ['axii',{name:'Axii',family:'Axii',element:'Water',alternate:false,cost:'Variable',maxCost:7,range:8,shape:'target',duration:'Until shaken off',defense:['Resist Magic','Magical Shield'],description:'Stuns; Stun save starts at -1 and worsens by 1 per 2 extra STA.'}],
    ['aardSweep',{name:'Aard Sweep',family:'Aard',element:'Air',alternate:true,cost:'Variable',maxCost:7,range:4,shape:'radius',duration:'Immediate',defense:['Dodge','Magical Shield'],description:'10% knockdown/stagger chance per STA to everything in a 4m sphere.'}],
    ['fireStream',{name:'Fire Stream',family:'Igni',element:'Fire',alternate:true,cost:'Variable',maxCost:7,range:3,shape:'target',duration:'Active',upkeep:'half',defense:['Dodge','Block','Magical Shield'],description:'1d6/STA and 75% fire; upkeep is half initial STA each round.'}],
    ['activeShield',{name:'Active Shield',family:'Quen',element:'Earth',alternate:true,cost:'Variable',maxCost:7,range:0,shape:'self',duration:'Active',upkeep:'half',defense:[],description:'10 HP per STA. When dropped, adjacent targets are pushed 2m and take 1d6 torso.'}],
    ['magicTrap',{name:'Magic Trap',family:'Yrden',element:'Mixed',alternate:true,cost:'Variable',maxCost:7,range:3,shape:'radius',duration:'1 round per STA',defense:['Dodge','Block','Magical Shield'],description:'One-round preparation; attacks nearest target each round for 3d6.'}],
    ['puppet',{name:'Puppet',family:'Axii',element:'Water',alternate:true,cost:'Variable',maxCost:7,range:8,shape:'target',duration:'STA rounds / until resisted',defense:['Resist Magic','Magical Shield'],description:'Controls a target; it may Resist Magic against casting each round.'}]
  ] as Array<[string, Record<string, unknown>]>; for(const [id,d] of signs)Registry.add('signs',id,{...d,...signResolution(id)});
  for(const [name,d] of Object.entries(MAGE_SPELL_CATALOG))Registry.add('spells',slug(name),{name,...d});


  for(const [name,d] of Object.entries(RAW_POTIONS))Registry.add('alchemy',slug(name),{name,kind:'potion',...d});
  for(const [name,d] of Object.entries(RAW_DECOCTIONS))Registry.add('alchemy',slug(name),{name,kind:'decoction',...d});
  for(const [name,d] of Object.entries(RAW_BOMBS))Registry.add('alchemy',slug(name),{name,kind:'bomb',...d});
  const oils=['Beast Oil','Cursed Oil','Draconid Oil','Elementa Oil','Hanged Man’s Venom','Hybrid Oil','Insectoid Oil','Necrophage Oil','Ogroid Oil','Relict Oil','Specter Oil','Vampire Oil'];for(const name of oils)Registry.add('alchemy',slug(name),{name,kind:'oil',bonus:5,duration:30});

  const cond=[
    ['bleeding',{name:'Bleeding',tick:{hp:-2},description:'Lose 2 HP at round end until stopped.'}],['burning',{name:'Burning',tick:{hp:-5},description:'Fire continues to harm the target until extinguished.'}],['poisoned',{name:'Poisoned',tick:{hp:-3},description:'Poison deals ongoing damage until resisted or treated.'}],['frozen',{name:'Frozen',description:'Movement and defense are restricted; first hard strike may gain bonus damage.'}],['stunned',{name:'Stunned',description:'Action lost until Stun save succeeds.'}],['staggered',{name:'Staggered',description:'Off balance; combat rolls suffer a penalty until the effect clears.'}],['prone',{name:'Prone',description:'On the ground; must stand before normal movement.'}],['grappled',{name:'Grappled',description:'Movement locked; physical actions restricted.'}],['pinned',{name:'Pinned',description:'Immobilized by an established grapple.'}],['diseased',{name:'Diseased',description:'Disease effects follow the source creature or disease profile.'}],['blinded',{name:'Blinded',description:'Sight-based actions suffer severe penalties.'}],['suffocating',{name:'Suffocating',tick:{hp:-3},description:'Cannot breathe; loses HP each round.'}],['internalAcid',{name:'Torn stomach acid',tick:{hp:-4},description:'Torn stomach causes 4 HP internal damage each round.'}],['dimeritium',{name:'Dimeritium suppression',description:'Magic is suppressed while exposed.'}],['surrendered',{name:'Surrendered',description:'Removed from hostile initiative unless a betrayal/escape event explicitly changes state.'}]
  ] as Array<[string, Record<string, unknown>]>;for(const [id,d] of cond)Registry.add('conditions',id,{...d});
  for(const [tier,rows] of Object.entries(RAW_CRITICALS))for(const row of rows)Registry.add('criticalWounds',`${tier}:${slug(row.name)}`,{tier,...row});
  // Terrain now lives in ./content/terrain.ts, with cover values cited to the block.
};
registerCoreContent();
registerTerrainContent(Registry);
registerBattlefieldContent(Registry);
registerCreatureAbilityContent(Registry);
registerMagicContent(Registry);
registerScenarioContent(Registry);
registerCharacterCreationContent(Registry);
registerHeroPresetContent(Registry);

// ---------- Narrative, loot, and exceptional-creature content ----------
function registerNarrativeData(){
  const voices={
    Bandit:{name:'Bandit / outlaw',lines:{attack:['Get around him!','Cut the legs!','Keep him busy—then take the purse!','Do not give the bastard room!','Archer, find a lane!','Crowd him before he starts signing!'],pain:['Ploughing hell!','He cut me!','That went deep!','Damn you!','I am still up!','Blood—too much blood.'],critical:['My arm!','I cannot stand on it!','Something broke!','Get him off me!'],allyDeath:['He killed one of ours!','Do not stare—move!','Bastard!'],surrender:['Enough! I yield!','All right! Take the weapon!','Quarter! I am done!'],retreat:['Run!','Break off!','Leave the loot—move!'],victory:['Take the swords first.','Check his belt for coin.','If he is breathing, bind him.']}},
    Temeria:{name:'Temerian',lines:{attack:['Keep on him!','For the lilies!','Do not give him room!','Close, damn you!','Make him work for every step.','Watch the silver blade.'],pain:['Ploughing hell.','That cut is deep.','Still here.','Keep the line.','I can fight.','He got through the mail.'],critical:['Medic—if we live through this!','My arm—damn it!','I cannot put weight on it!'],allyDeath:['He is down!','Do not stare—fight!','You bastard.'],surrender:['Enough! I yield!','Quarter! I am finished!','Weapons down. I am done.'],retreat:['Back! Back to cover!','Break off!','Run before he cuts us apart!'],victory:['Search him. Witcher gear is worth coin.','Bind him if he still breathes.','Check the medallion and the saddlebags.']}},
    Redania:{name:'Redanian',lines:{attack:['Press him!','For Redania!','Do not let the mutant breathe!','Advance!','Hold the road!','Keep the formation.'],pain:['Damnation.','Still standing.','Blood through the padding.','Stay on him.'],critical:['I need a chirurgeon!','The limb is gone bad!','I cannot see straight!'],allyDeath:['One down!','He killed him—move!','Do not break!'],surrender:['I yield!','Quarter, witcher!','Enough. I drop my weapon.'],retreat:['Fall back!','To the barricade!','Withdraw!'],victory:['Take the swords for the armory.','Check his papers.','The authorities will pay for this one.']}},
    Kaedwen:{name:'Kaedweni',lines:{attack:['Drive him back!','For Kaedwen!','Hard in, now!','Pin him against the ground!','Do not chase his feints.'],pain:['I have had worse.','Damn blade.','Keep fighting.','That one bit.'],critical:['Leg is broken!','My hand will not close!','I am bleeding out!'],allyDeath:['Leave him—fight!','He is dead.','Hold, damn you!'],surrender:['Enough. I yield.','Quarter.','I am finished.'],retreat:['Back to the rocks!','Break contact!','Move!'],victory:['Strip the useful steel.','If he breathes, bind him.','Check for potions before touching anything.']}},
    Aedirn:{name:'Aedirnian',lines:{attack:['On him!','For Aedirn!','Keep him away from the flank!','Now—while he is turned!','Drive him off!'],pain:['Damn.','He opened me up.','Still moving.','Keep your feet.'],critical:['I cannot use it!','Too much blood!','My ribs—'],allyDeath:['He is gone!','Do not let it be for nothing!','Fight!'],surrender:['I yield!','Enough!','Quarter!'],retreat:['Fall back!','To cover!','Get clear!'],victory:['Take his blades.','See if the horse is nearby.','Do not drink anything from his belt.']}},
    Nilfgaard:{name:'Nilfgaardian',lines:{attack:['Maintain the line.','For the Emperor.','Close on him.','Advance by pairs.','Do not crowd the witcher.','Keep the arbalist clear.'],pain:['Damn you.','Still standing.','Keep formation.','Armor failed there.','I can continue.'],critical:['Chirurgeon!','The limb is useless!','I am losing blood!'],allyDeath:['Soldier down. Maintain formation.','Do not break ranks.','Step over him and close.'],surrender:['Enough. I yield.','I am done. Quarter.','I submit.'],retreat:['Orderly withdrawal!','Back to the line!','Disengage!'],victory:['Secure the witcher and his equipment.','Inventory every blade and potion.','If he lives, command will decide his fate.']}},
    Skellige:{name:'Skelliger',lines:{attack:['Come on, then!','For the clan!','Drive him into the dirt!','Do not let him dance away!','A hard blow now!'],pain:['Hah—good cut.','Still got blood left.','That stings.','Not dead yet.'],critical:['My leg is ruined!','Arm will not answer!','I am bleeding like a gutted seal!'],allyDeath:['He died fighting!','You will answer for that!','Hold fast!'],surrender:['Enough. I yield.','I am beaten.','No shame in knowing when it is done.'],retreat:['Back, lads!','To the boats!','Break off!'],victory:['Take the steel and leave the potions.','See if the witcher wakes.','That medallion will fetch a tale and a price.']}},
    Toussaint:{name:'Toussaintois',lines:{attack:['At him!','For the duchy!','Mind his blade!','Keep your guard, man!','Now—press the advantage!'],pain:['Sangreal—!','That was no love tap.','I remain on my feet.','Damnably sharp.'],critical:['A physician!','My leg is shattered!','I cannot hold the sword!'],allyDeath:['He has fallen!','Stand firm!','Do not disgrace him by breaking!'],surrender:['I yield, witcher.','Quarter, if you please.','Enough. I concede.'],retreat:['Withdraw!','Back to the road!','Disengage!'],victory:['His arms are fine work.','See that he is searched carefully.','If he lives, bind him before he wakes.']}},
    Zerrikania:{name:'Zerrikanian',lines:{attack:['Hold the pass!','Keep the shield high!','Circle—do not meet the charge straight!','For the caravan!','Make the monster come through us!'],pain:['Still standing.','The desert has done worse.','Keep moving.','That cut found me.'],critical:['Bind it if I fall!','The limb is broken!','I am losing too much blood!'],allyDeath:['Guard the living!','Do not waste their death!','Hold the road!'],surrender:['Enough. I yield.','The fight is finished.','I lower my weapon.'],retreat:['Back to the pass!','Break away!','Move!'],victory:['Check the packs before the heat takes them.','Take the useful steel.','See if the witcher still breathes.']}},
    Kovir:{name:'Koviri',lines:{attack:['Keep the line!','Do not give him the lane!','Hold him there!','Now—while his feet are set!'],pain:['Damnably sharp.','I can continue.','That found the gap.','Keep moving.'],critical:['Get a surgeon!','My arm is ruined!','I cannot stand on it!'],allyDeath:['One down—hold!','Do not break!','He is gone. Fight!'],surrender:['Enough. I yield.','Quarter.','I am finished.'],retreat:['Withdraw!','Back to cover!','Disengage!'],victory:['Take inventory before anything disappears.','His gear is worth more intact.','Bind him if he wakes.']}},
    Scoiatael:{name:'Scoia’tael',lines:{attack:['Aen Seidhe!','Dh’oine—move!','From the trees!','Take his legs!','Keep the bow line open!','Do not bunch together!'],pain:['Still breathing.','Keep the line.','Do not give him room.','A scratch. Keep moving.','He is quick.'],critical:['My leg—cover me!','I cannot draw!','Too much blood.'],allyDeath:['Remember them. Fight.','One more name for the dead.','Do not let the dh’oine take another.'],surrender:['Enough. I lower my blade.','No more. I yield.','Take the weapon. The fight is done.'],retreat:['Into the trees!','Break and vanish!','Leave no trail!'],victory:['Take only what the commando needs.','His silver will buy food and arrows.','If he lives, bind his hands before he wakes.']}},
    Troll:{name:'Troll',lines:{attack:['Troll smash.','You stop now.','Troll hit witcher.','No poke troll!','Come here, little sword-man.'],pain:['Ow!','Bad cut.','Troll hurt.','Sharp!','No like silver.'],critical:['Leg bad!','Arm no work!','Too much red!'],allyDeath:['Friend no move.','You kill troll-friend.','Bad. Very bad.'],surrender:['No more. Troll stop.','Troll yield.','No hit. Troll done.'],retreat:['Troll go now!','No more fight!','Run!'],victory:['Sword-man quiet now.','Troll win.','No more poking.']}},
    HigherVampire:{name:'Higher Vampire',lines:{attack:['You have mistaken persistence for safety.','Enough games.','Try to keep up.','You are making this needlessly ugly.','I have had longer conversations than your entire life.'],pain:['Interesting.','That was inconvenient.','You drew blood.','A respectable attempt.','I will remember that cut.'],critical:['That would have killed something mortal.','An ugly wound. It will close.','You have bought yourself a few seconds.'],allyDeath:['Wasteful.','You have complicated matters.','That debt will be remembered.'],surrender:['Enough. We can stop this.','I concede the field—for now.','There is no profit in continuing this exchange.'],retreat:['Another time.','You have earned a reprieve.','I have no reason to die here today.'],victory:['You were more interesting alive.','Do not mistake survival for mercy.','Perhaps I will keep you for a while.']}},
    Dragon:{name:'True Dragon',lines:{attack:['Little hunter, your courage exceeds your judgment.','You stand in my ground and call it bravery.','I have watched kingdoms die younger than you.','Leave, or be made part of this mountain.','Your silver is a poor argument.'],pain:['You have marked me.','A bold wound.','That was better than I expected.','You will pay for that scale.'],critical:['You have done what armies failed to do.','Enough. I will remember this injury.','You have crossed from nuisance into threat.'],allyDeath:['You destroy what is mine.','That life was under my protection.','You have purchased my full attention.'],surrender:['Go. Take your life and leave my sight.','This quarrel has become tiresome.','Withdraw, and I will not pursue.'],retreat:['I yield the ground, not the claim.','Live with the knowledge that I chose to leave.','Another day, little hunter.'],victory:['Your kind always thinks the last step belongs to them.','Your weapons will rust before I forget this.','This is what your preparation purchased.']}},
    SapientMonster:{name:'Sapient Monster',lines:{attack:['You should have turned away.','You trespass knowingly.','Then defend yourself.'],pain:['Enough.','That was unwise.','You have drawn blood.'],critical:['You will pay for that.','I have endured worse.','Do not mistake pain for defeat.'],allyDeath:['This has gone too far.','You have made an enemy.'],surrender:['Enough. We can still speak.','Stop. There is no profit in this.'],retreat:['This ground is yours—for now.','I have no reason to die here.'],victory:['You were warned.','Leave this place forgotten.']}},
    Beast:{name:'Beast',lines:{attack:[],pain:[],critical:[],allyDeath:[],surrender:[],retreat:[],victory:[]}},
    generic:{name:'Generic',lines:{attack:['Now!','Move!','Take the opening!','Close!','Keep pressure!'],pain:['Damn.','Still here.','Keep moving.','That hurt.'],critical:['I am badly hit!','Something is broken!','Too much blood!'],allyDeath:['They are down!','Keep fighting!','Do not freeze!'],surrender:['I yield!','Enough!','Quarter!'],retreat:['Back!','Get clear!','Run!'],victory:['Search the body.','Check the weapons.','Make sure it is over.']}}
  };
  for(const [id,data] of Object.entries(voices))Registry.add('voiceSets',id,data);

  const breaths={
    green:{name:'Scalding Steam',damage:'7d6',cooldown:5,shape:'10 m cone',type:'E',condition:null,allLocations:true,armorAblation:2,description:'A green dragon vents a rolling blast of scalding steam. Its venom remains in the bite, not the breath.'},
    red:{name:'Catastrophic Fire',damage:'10d6',cooldown:5,shape:'10 m cone',type:'E',condition:'burning',allLocations:true,armorAblation:'halfDamage',description:'Red-dragon fire is hot enough to ruin masonry and ablates armor with terrifying speed.'},
    black:{name:'Burning Acid Jet',damage:'7d6',cooldown:5,shape:'10 m jet',type:'E',condition:null,allLocations:true,armorAblation:4,description:'A black dragon sprays burning acid described in the Journal; this engine models it as severe armor-eating breath.'},
    brown:{name:'Mountain Fire',damage:'7d6',cooldown:5,shape:'10 m cone',type:'E',condition:'burning',allLocations:true,armorAblation:2,description:'Brown dragons retain the baseline magical fire breath; their real subspecies advantage is burrowing and earth-shaking mobility.'},
    white:{name:'Winter Breath',damage:'7d6',cooldown:5,shape:'10 m cone',type:'E',condition:'frozen',allLocations:true,armorAblation:2,description:'A white dragon exhales a freezing gale that locks failed defenders in thick ice.'}
  };
  for(const [id,data] of Object.entries(breaths))Registry.add('dragonBreaths',id,data);

  Registry.add('lootTables','humanoid',{name:'Humanoid equipment & possessions',kind:'humanoid'});
  Registry.add('lootTables','monster',{name:'Monster harvest',kind:'monster'});
  Registry.add('lootTables','dragon',{name:'True dragon remains & horde',kind:'exceptional'});
  Registry.add('lootTables','higherVampire',{name:'Higher vampire remains & possessions',kind:'exceptional'});

  const defeatProfiles={
    bandit:{name:'Bandit defeat',outcomes:['capture','robLeave','execute','ransom']},
    soldier:{name:'Soldier defeat',outcomes:['capture','imprison','execute','leaveForDead']},
    scoiatael:{name:'Scoia’tael defeat',outcomes:['capture','stripDisarm','execute','leaveForDead']},
    mage:{name:'Mage defeat',outcomes:['captureStudy','interrogate','execute','leaveForDead']},
    vampire:{name:'Higher-vampire defeat',outcomes:['captureStudy','feed','leaveForDead','finish']},
    dragon:{name:'Dragon defeat',outcomes:['breathKill','biteKill','crushKill','leaveForDead']},
    beast:{name:'Animal defeat',outcomes:['maul','feed','dragOff']},
    monster:{name:'Monster defeat',outcomes:['tearApart','feed','crushKill']},
    construct:{name:'Construct defeat',outcomes:['crushKill','destroy']}
  };
  for(const [id,data] of Object.entries(defeatProfiles))Registry.add('defeatProfiles',id,data);
  // `applies` is what standing in the zone does to an actor each round. Keeping it here rather
  // than branching on zone id inside ZoneService is what lets the zone system stay content-free.
  // `status` sets a raw status counter; `condition` goes through the condition framework.
  // `threat` is what the AI should fear about standing here. Like `applies`, it lives on the zone
  // so no rule has to branch on a zone id — and `threatens`/`susceptibleTo` are read off the
  // actor's own data, so no rule has to branch on what kind of creature it is either.
  const zones={
    yrden:{name:'Yrden circle',cssClass:'zone-yrden',glyph:'YR',description:'3 m magical circle. Movement/REF penalties are resolved by the Sign rules.',applies:[],threat:{risk:22,threatens:['incorporeal'],susceptibleTo:['Yrden']}},
    magicTrap:{name:'Magic Trap',cssClass:'zone-trap',glyph:'TR',description:'Prepared Yrden alternate form. Attacks the nearest target each round.',applies:[],threat:{risk:22,threatens:['incorporeal'],susceptibleTo:['Yrden']}},
    flame:{name:'Active flames',cssClass:'zone-fire',glyph:'FL',description:'Lingering fire hazard. Entering or remaining in it can keep Burning active.',applies:[{condition:'burning'}],threat:{risk:28,negatedBy:'ordinaryFire'}},
    poisonCloud:{name:'Poison cloud',cssClass:'zone-poison',glyph:'PS',description:'Persistent Devil’s Puffball cloud.',applies:[{condition:'poisoned',duration:2}],threat:{risk:18,negatedBy:'poisoned'}},
    dimeritiumCloud:{name:'Dimeritium cloud',cssClass:'zone-dimeritium',glyph:'DM',description:'Persistent dimeritium suppression area.',applies:[{condition:'dimeritium',duration:1}],threat:{risk:24,threatens:['magic'],susceptibleTo:['Dimeritium']}},
    moonDust:{name:'Moon Dust cloud',cssClass:'zone-moondust',glyph:'MD',description:'Persistent Moon Dust area.',applies:[{status:'moonDust',duration:1}]},
    dreamCloud:{name:'Dragon’s Dream cloud',cssClass:'zone-dream',glyph:'DD',description:'Flammable gas cloud awaiting ignition.',applies:[{status:'flammableGas',duration:1}],ignitable:true}
  };for(const [id,data] of Object.entries(zones))Registry.add('zones',id,data);
}
registerNarrativeData();

function registerHarvestData(){
  Registry.add('tools','silverHuntingKnife',{name:'Silver hunting knife',harvestBonus:2,tags:['silver','field-dressing','monster-harvest']});
  // Monster loot is defined per creature. No generic "monster parts" fallback.
  // Channel meanings: harvest = taken from remains; personal = carried/worn/site items;
  // valuables = runes, glyphs, eggs, gems, or other notable recoverables.
  const H='harvest',P='personal',V='valuables';
  const tables={
    drowner:{name:'Drowner',parts:[['Drowner Brain','1',H],['Drowner Tongue','1',H],['Essence of Water','1d6/2',H]]},
    ghoul:{name:'Ghoul',parts:[['Ghoul Claws','2',H],['Ghoul Marrow','1d6/2',H],['Venom Extract','1d6/2',H]]},
    gravehag:{name:'Grave Hag',parts:[['Grave Hag Ear','2',H],['Hag Teeth','1d6/2',H],['Venom Extract','1d6',H],['Random Rune','1',V],['Strange Possessions','1d6',P]]},
    wraith:{name:'Wraith',parts:[['Wraith Essence','1d6/2',H],['Specter Dust','1d6/2',H],['Infused Dust','1d6/2',H]]},
    noonwraith:{name:'Noonwraith',parts:[['Wraith Essence','1d6',H],['Specter Dust','1d6',H],['Infused Dust','1d6',H],['Light Essence','1d6/2',H]]},
    werewolf:{name:'Werewolf',parts:[['Werewolf Pelt','1',H],['Werewolf Saliva','1d6',H],['Random Items','1d6',P]]},
    siren:{name:'Siren',parts:[['Siren Vocal Chords','1',H],['Essence of Water','1d6',H],['Mundane Items','1d6/3',P]]},
    griffin:{name:'Griffin',parts:[['Griffin Feathers','1d10',H],['Infused Dust','1d6/2',H],['Griffin Egg','1d6/2',V]]},
    endrega:{name:'Endrega',parts:[['Venom Extract','1d6/2',H],['Endrega Saliva','1d6/2',H],['Chitin Scale','1d6/2',H]]},
    arachas:{name:'Arachas',parts:[['Arachas Eyes','1d6/2',H],['Arachas Chitin','1d6',H],['Venom Extract','1d6',H],['Arachas Venom','1d6',H]]},
    golem:{name:'Golem',parts:[['Golem Heart','1',H],['Random Rune','1',V],['Infused Dust','1d6',H]]},
    fiend:{name:'Fiend',parts:[['Fiend Eyes','3',H],['Fifth Essence','1d10',H],['Fiend Dung','1d6',P]]},
    nekker:{name:'Nekker',parts:[['Nekker Teeth','1d6/2',H],['Nekker Claws','2',H],['Nekker Heart','1',H]]},
    rocktroll:{name:'Rock Troll',parts:[['Troll Skin','1d6',H],['Troll Liver','1',H],['Stone','2d10',P],['Mundane Items','1d6',P]]},
    wyvern:{name:'Wyvern',parts:[['Draconid Scales','1d10',H],['Venom Extract','1d10',H],['Wyvern Egg','1d6/2',V],['Wyvern Eyes','1d6/2',H]]},
    katakan:{name:'Katakan',parts:[['Random Rune','1',V],['Vampire Fangs','1d6/2',H],['Vampire Saliva','1d6',H],['Mundane Items','1d6',P]]},

    bullvore:{name:'Bullvore',parts:[['Bullvore Brain','1',H],['Bullvore Blood','2d6',H],['Bullvore Eyes','1d6/3',H],['Linen','1d6',P],['Twine','2d6',P]]},
    foglet:{name:'Foglet',parts:[['Foglet Teeth','1d6/2',H],['Infused Dust','1d6',H],['Phosphorus','2d6',H],['Foglet Essence','1d6',H]]},
    rotfiend:{name:'Rotfiend',parts:[['Rotfiend Blood','1d6/2',H],['Rotfiend Liver','1',H]]},
    barghest:{name:'Barghest',parts:[['Barghest Essence','1d6',H],['Infused Dust','1d6/2',H]]},
    hym:{name:'Hym',parts:[['Veles Runestone','1',V],['Specter Dust','1d6',H],['Essence of Wraith','2d6',H],['Crystalized Essence','1d6/2',H],['Emerald Dust','1d6/2',H]]},
    pesta:{name:'Pesta',parts:[['Specter Dust','1d6',H],['Crystallized Essence','1d6/2',H],['Glyph of Yrden','1',V],['Essence of Wraith','2d6',H]]},
    bear:{name:'Bear',parts:[['Bear Fat','1d6',H],['Bear Hide','1d6/2',H],['Raw Meat','3d6',H],['Beast Bones','2d6',H]]},
    boar:{name:'Boar',parts:[['Boar Tusks','1d6/3',H],['Boar Pelt','1d6/3',H],['Raw Meat','1d6',H]]},
    panther:{name:'Panther',parts:[['Panther Hide','1d6/3',H],['Beast Bones','1d6',H],['Raw Meat','1d6',H]]},
    archespore:{name:'Archespore',parts:[['Archespore Juice','1d6/2',H],['Archespore Tendrils','1d6',H]]},
    botchling:{name:'Botchling',parts:[['Botchling Ear','1d6/3',H],['Botchling Blood','1d6',H],['Botchling Brain','1',H],['Botchling Bones','1d6',H]]},
    vendigo:{name:'Vendigo',parts:[['Vendigo Fur','1d6',H],['Essence of Death','2d6',H],['Vendigo Heart','1',H],['Crystalized Essence','1d6/2',H]]},
    harpy:{name:'Harpy',parts:[['Harpy Feathers','1d6',H],['Harpy Talons','1d6/3',H]]},
    manticore:{name:'Manticore',parts:[['Manticore Wing Membranes','2d6',H],['Bohun Upas Poison','1d6',H],['Manticore Fangs','1d6/2',H],['Manticore Horn','1d6/3',H],['Manticore Stomach','1',H]]},
    succubus:{name:'Succubus / Incubus',parts:[['Succubus Horn','1d6/3',H],['Succubus Heart','1',H],['Infused Dust','2d6',H],['Mundane Items','1d6',P]]},
    barbegazi:{name:'Barbegazi',parts:[['Barbegazi Fur','1d6',H],['Chitin Scale','1d6',H]]},
    frightener:{name:'Frightener',parts:[['Frightener Eyes','1d6/2',H],['Frightener Claws','1d6/3',H],['Chitin Scale','3d6',H],['Infused Dust','1d6',H],['Fifth Essence','1d6',H]]},
    giantcentipede:{name:'Giant Centipede',parts:[['Giant Centipede Discharge','2d6',H],['Giant Centipede Mandibles','1d6/3',H]]},
    earthelemental:{name:'Earth Elemental',parts:[['Elemental Stone','1',H],['Meteorite','2d6',H],['Chemobog Runestone','1',V],['Gemstone','1d6/2',V]]},
    fireelemental:{name:'Fire Elemental',parts:[['Elemental Stone','1',H],['Essence of Fire','2d6',H],['Dahzbog Runestone','1',V],['Gemstone','1d6/2',V]]},
    iceelemental:{name:'Ice Elemental',parts:[['Elemental Stone','1',H],['Essence of Water','2d6',H],['Zoria Runestone','1',V],['Gemstone','1d6/2',V]]},
    godling:{name:'Godling',parts:[['Godling Eyes','1d6/3',H],['Mundane Items','1d6',P],['Strange Items','1d6',P]]},
    leshen:{name:'Leshen',parts:[['Leshen Resin','1d6',H],['Leshen Fiber','2d6',H],['Crystalized Essence','1d6/2',H],['Leshen Bone','2d6',H]]},
    shaelmaar:{name:'Shaelmaar',parts:[['Shaelmaar Dust','1d6',H],['Shaelmaar Hair','1d6',H],['Chitin Scale','2d6',H],['Stone','1d6',H]]},
    cyclops:{name:'Cyclops',parts:[['Cyclops’ Eye','1',H],['Cyclops’ Brain','1',H],['Cyclops’ Bones','3d6',H],['Crystalized Essence','1d6/2',H],['Cyclops’ Tongue','1',H]]},
    knocker:{name:'Knocker',parts:[['Knocker Hair','2d6',H],['Knocker Toes','1d6',H],['Knocker Teeth','1d6/2',H]]},
    troll:{name:'Troll',parts:[['Troll Tongue','1',H],['Troll Skin','1d6',H],['Troll Liver','1',H],['Twine','2d6',P],['Leather','1d6',P],['Mundane Items','1d6',P]]},
    cockatrice:{name:'Cockatrice',parts:[['Cockatrice Stomach','1',H],['Cockatrice Carapace','2d6',H],['Venom Extract','1d6',H],['Cockatrice Tail Feathers','1d6',H]]},
    phoenix:{name:'Phoenix',parts:[['Phoenix Feathers','1d6',H],['Phoenix Ash','2d6',H],['Essence of Fire','2d6',H],['Infused Dust','1d6',H],['Fifth Essence','1d6',H],['Phoenix Egg or Baby Phoenix','1',V]]},
    slyzard:{name:'Slyzard',parts:[['Slyzard Scales','2d6',H],['Venom Extract','2d6',H],['Slyzard Talons','1d6',H],['Slyzard Vocal Cords','1d6/2',H]]},
    bruxa:{name:'Bruxa',parts:[['Abomination Lymph','1d6/3',H],['Naezan Salts','1d6/2',H],['Bruxa Blood','1d6',H],['Vampire Teeth','1d6/2',H],['Essence of Death','2d6',H],['Mundane Items','1d6',P]]},
    garkain:{name:'Garkain',parts:[['Garkain Saliva','1d6',H],['Wing Membrane','1d6/3',H],['Abomination Lymph','1d6/3',H]]},
    plumard:{name:'Plumard',parts:[['Plumard Stomach','1',H],['Wing Membrane','1d6/3',H]]},
    truedragon:{name:'True Dragon',parts:[['Dragon Tears','2d10',H],['Dragon Teeth','4d10',H],['Dragon Blood','5d10',H],['Dragon Tail','2d10',H]]},
    highervampire:{name:'Higher Vampire',parts:[['Abomination Lymph','1d6/2',H],['Naezan Salts','1d10',H],['Higher Vampire Fangs','1d6/3',H],['Essence of Death','3d10',H]]},

    bes:{name:'Bes',parts:[['Ashes','2d10',H],['Beast Bones','1d10',H],['Bes Horns','1d6/3',H],['Infused Dust','2d10',H],['Specter Dust','1d6',H],['Essence of Wraith','2d6',H],['Dazhbog Runestone','1',V]]},
    casglydd:{name:'Casglydd',parts:[['Infused Dust','1d10',H],['Specter Dust','1d6',H],['Essence of Wraith','1d6',H],['Random Runestones','3',V],['Random Glyph','2',V]]},
    corpseamalgam:{name:'Corpse Amalgam',parts:[['Lunar Shards','1',H],['Fifth Essence','1d6',H],['Specter Dust','1d6',H],['Essence of Wraith','1d6',H]]},
    livingarmor:{name:'Living Armor',parts:[['Fifth Essence','1d6/3',H],['Infused Dust','1d6/3',H],['The Armor Animated','1',P],['Any Worn Weapons or Items','1',P]]},
    marilwyd:{name:'Mari Lwyd',parts:[['Beast Bones','1d10',H],['Mari Lwyd Skull','1',H],['Silk','1d10',P],['Infused Dust','1d10',H],['Specter Dust','1d6',H],['Essence of Wraith','2d6',H],['Zoria Runestone','1',V]]},
    penitent:{name:'Penitent',parts:[['Specter Dust','1d6',H],['Wraith Essence','1d6',H],['Infused Dust','1d6',H],['Random Rune','1',V]]}
  };
  for(const [id,row] of Object.entries(tables))Registry.add('harvestTables',id,{name:row.name,parts:row.parts.map(([name,quantity,channel=H])=>({name,quantity,channel}))});
}
registerHarvestData();

// ============================================================================
// FOUNDATION REGISTRIES — generic LEGO pieces used by current and future actors.
// These are intentionally small. Character and content ingestion can add data without
// changing combat resolvers.
// ============================================================================
function registerFoundationData(){
  const anatomies={
    humanoid:{name:'Humanoid',locations:{head:{label:'Head',group:'head'},torso:{label:'Torso',group:'torso'},leftArm:{label:'Left Arm',group:'arm',side:'left'},rightArm:{label:'Right Arm',group:'arm',side:'right'},leftLeg:{label:'Left Leg',group:'leg',side:'left'},rightLeg:{label:'Right Leg',group:'leg',side:'right'}}},
    quadruped:{name:'Quadruped',locations:{head:{label:'Head',group:'head'},torso:{label:'Torso',group:'torso'},leftLimb:{label:'Left Limbs',group:'leg',side:'left'},rightLimb:{label:'Right Limbs',group:'leg',side:'right'},special:{label:'Back / Special',group:'special'}}},
    wingedDraconid:{name:'Winged Draconid',locations:{head:{label:'Head',group:'head'},torso:{label:'Torso',group:'torso'},leftLimb:{label:'Left Leg / Wing Root',group:'limb',side:'left'},rightLimb:{label:'Right Leg / Wing Root',group:'limb',side:'right'},special:{label:'Wing / Tail',group:'special'}}},
    trueDragon:{name:'True Dragon',locations:{head:{label:'Head',group:'head'},torso:{label:'Torso',group:'torso'},leftLimb:{label:'Left Wing / Legs',group:'limb',side:'left'},rightLimb:{label:'Right Wing / Legs',group:'limb',side:'right'},special:{label:'Tail / Wing',group:'special'}}},
    insectoid:{name:'Insectoid',locations:{head:{label:'Head',group:'head'},torso:{label:'Carapace',group:'torso'},leftLimb:{label:'Left Limbs',group:'limb',side:'left'},rightLimb:{label:'Right Limbs',group:'limb',side:'right'},special:{label:'Abdomen / Special',group:'special'}}},
    spectral:{name:'Spectral',locations:{head:{label:'Head',group:'head'},torso:{label:'Manifestation',group:'torso'},leftLimb:{label:'Left Manifestation',group:'limb',side:'left'},rightLimb:{label:'Right Manifestation',group:'limb',side:'right'},special:{label:'Spectral Core',group:'special'}}},
    construct:{name:'Construct',locations:{head:{label:'Head / Sensor',group:'head'},torso:{label:'Main Body',group:'torso'},leftLimb:{label:'Left Assembly',group:'limb',side:'left'},rightLimb:{label:'Right Assembly',group:'limb',side:'right'},special:{label:'Joint / Core',group:'special'}}}
  };
  for(const [id,data] of Object.entries(anatomies))Registry.add('anatomies',id,data);

  const objectives={
    eliminate:{name:'Eliminate hostiles',kind:'combat',utility:{attack:18,pursue:10}},
    escape:{name:'Escape battlefield',kind:'escape',utility:{flee:35,reposition:12}},
    capture:{name:'Capture target',kind:'capture',utility:{subdue:28,kill:-18}},
    protect:{name:'Protect ally',kind:'protect',utility:{intercept:28,heal:22}},
    hold:{name:'Hold position',kind:'position',utility:{defend:18,reposition:-8}},
    reach:{name:'Reach location',kind:'position',utility:{reposition:30}},
    survive:{name:'Survive',kind:'survival',utility:{defend:14,recover:16,flee:10}},
    delay:{name:'Delay enemy',kind:'control',utility:{control:24,reposition:8}},
    recover:{name:'Recover person/object',kind:'objective',utility:{reposition:20,protect:12}}
  };
  for(const [id,data] of Object.entries(objectives))Registry.add('objectives',id,data);

  const doctrines={
    witcher:{name:'Witcher',weights:{attack:12,reposition:10,sign:8,item:6,exploitVulnerability:18,resourceConservation:10,adapt:14}},
    duelist:{name:'Duelist',weights:{attack:16,defend:8,focusSingle:12,finishOpening:8}},
    archer:{name:'Archer',weights:{ranged:22,cover:14,maintainRange:18,melee:-12,clearLos:14}},
    crossbowman:{name:'Crossbowman',weights:{ranged:22,reloadCover:20,maintainRange:14,clearLos:12}},
    mageController:{name:'Mage Controller',weights:{control:22,escapeMelee:20,resourceConservation:10,setup:14}},
    mageArtillery:{name:'Mage Artillery',weights:{damage:20,area:14,longRange:12,resourceConservation:6}},
    mageSupport:{name:'Mage Support',weights:{heal:28,protectAlly:18,control:12,resourceConservation:12}},
    beast:{name:'Beast',weights:{attack:16,territory:8,complexPlan:-15,finishOpening:6}},
    packHunter:{name:'Pack Hunter',weights:{isolate:18,flank:16,protectPack:5,packCohesion:16,finishOpening:8}},
    ambushPredator:{name:'Ambush Predator',weights:{flank:18,breakLos:12,finishOpening:12,retreatWhenHurt:8}},
    territorial:{name:'Territorial Monster',weights:{hold:16,pursueOutsideTerritory:-12,selfPreservation:8}},
    intelligentMonster:{name:'Intelligent Monster',weights:{adapt:18,cover:8,targetPriority:12,setup:10}},
    giantBrute:{name:'Giant Brute',weights:{attack:20,heavyAttack:14,throwRock:12,knockdown:10,cover:-6}},
    skirmisher:{name:'Skirmisher',weights:{ranged:16,cover:18,breakLos:14,flank:18,maintainRange:14,retreatLane:8}},
    vampirePredator:{name:'Vampire Predator',weights:{adapt:18,finishOpening:14,breakLos:18,regenerate:24,isolate:12}},
    dragonMastermind:{name:'Dragon Mastermind',weights:{breath:24,flight:20,setup:20,adapt:24,targetPriority:16,selfPreservation:14}},
    soldier:{name:'Military Soldier',weights:{formation:16,protectRanged:12,focusThreat:14,cover:10,clearLos:8}},
    officer:{name:'Officer',weights:{formation:22,protectRanged:16,focusThreat:18,retreatLane:12,coordination:18}}
  };
  for(const [id,data] of Object.entries(doctrines))Registry.add('combatDoctrines',id,data);

  const cognition={
    reactive:{name:'Reactive',tier:0,planningDepth:0,coordination:0,adaptation:.05,hazardAwareness:.15,targetAnalysis:.05},
    instinctive:{name:'Instinctive',tier:1,planningDepth:1,coordination:.15,adaptation:.16,hazardAwareness:.42,targetAnalysis:.18},
    primitive:{name:'Primitive tactical',tier:2,planningDepth:1,coordination:.45,adaptation:.30,hazardAwareness:.58,targetAnalysis:.34},
    trained:{name:'Trained',tier:3,planningDepth:2,coordination:.70,adaptation:.52,hazardAwareness:.72,targetAnalysis:.62},
    expert:{name:'Expert',tier:4,planningDepth:3,coordination:.82,adaptation:.76,hazardAwareness:.86,targetAnalysis:.82},
    mastermind:{name:'Mastermind',tier:5,planningDepth:4,coordination:.92,adaptation:.94,hazardAwareness:.96,targetAnalysis:.96}
  };
  for(const [id,data] of Object.entries(cognition))Registry.add('aiCognition',id,data);

  const aiProfiles={
    reactiveConstruct:{name:'Reactive construct',cognitionId:'reactive',doctrines:[],tags:['construct'],weights:{attack:12,reposition:2,recover:4}},
    instinctiveSwarm:{name:'Instinctive swarm',cognitionId:'instinctive',doctrines:['beast','packHunter'],tags:['swarm','pack'],weights:{attack:14,reposition:8,packCohesion:12}},
    packPredator:{name:'Pack predator',cognitionId:'instinctive',doctrines:['beast','packHunter'],tags:['beast','pack'],weights:{attack:16,reposition:10,flank:10}},
    ambushPredator:{name:'Ambush predator',cognitionId:'trained',doctrines:['ambushPredator','intelligentMonster'],tags:['predator','ambush'],weights:{attack:14,reposition:14,breakLos:12}},
    nekkerWarband:{name:'Nekker warband',cognitionId:'primitive',doctrines:['packHunter'],tags:['ogroid','pack','throwRock'],weights:{attack:14,reposition:14,flank:18,throwRock:10,packCohesion:18}},
    giantBrute:{name:'Giant brute',cognitionId:'primitive',doctrines:['giantBrute'],tags:['ogroid','giant','throwRock'],weights:{attack:20,reposition:8,throwRock:14,finishOpening:12}},
    outlaw:{name:'Experienced outlaw',cognitionId:'trained',doctrines:['duelist'],tags:['human','outlaw'],weights:{attack:12,reposition:10,cover:8,selfPreservation:8}},
    soldier:{name:'Trained soldier',cognitionId:'trained',doctrines:['soldier'],tags:['human','formation'],weights:{attack:12,reposition:12,cover:14,coordination:14}},
    skirmisher:{name:'Scoia’tael skirmisher',cognitionId:'trained',doctrines:['skirmisher'],tags:['human','skirmisher'],weights:{attack:12,reposition:18,cover:18,flank:14}},
    mageExpert:{name:'Expert mage',cognitionId:'expert',doctrines:['mageController','mageArtillery'],tags:['mage','caster'],weights:{cast:22,reposition:16,control:18,escapeMelee:22,resourceConservation:14}},
    witcherExpert:{name:'Expert witcher',cognitionId:'expert',doctrines:['witcher','duelist'],tags:['witcher','hunter','expert'],weights:{attack:16,reposition:16,adapt:20,resourceConservation:16,finishOpening:12}},
    vampireExpert:{name:'Intelligent vampire',cognitionId:'expert',doctrines:['vampirePredator','intelligentMonster'],tags:['vampire','predator'],weights:{attack:16,reposition:16,breakLos:14,finishOpening:16}},
    higherVampireMaster:{name:'Higher vampire mastermind',cognitionId:'mastermind',doctrines:['vampirePredator','intelligentMonster'],tags:['vampire','mastermind','regenerator'],weights:{attack:16,reposition:20,breakLos:24,regenerate:30,adapt:24,selfPreservation:18}},
    dragonMaster:{name:'True dragon mastermind',cognitionId:'mastermind',doctrines:['dragonMastermind','intelligentMonster'],tags:['dragon','mastermind','flying'],weights:{attack:16,reposition:18,breath:30,flight:26,setup:26,adapt:24,selfPreservation:18}},
    intelligentMonster:{name:'Intelligent monster',cognitionId:'trained',doctrines:['intelligentMonster'],tags:['monster'],weights:{attack:14,reposition:12,adapt:12}},
    instinctiveMonster:{name:'Instinctive monster',cognitionId:'instinctive',doctrines:['beast'],tags:['monster'],weights:{attack:16,reposition:8}}
  };
  for(const [id,data] of Object.entries(aiProfiles))Registry.add('aiProfiles',id,data);

  const personalities={
    disciplined:{name:'Disciplined',discipline:.88,painTolerance:.82,talkativeness:.18,riskTolerance:.45,selfPreservation:.62},
    cautious:{name:'Cautious',discipline:.68,painTolerance:.55,talkativeness:.20,riskTolerance:.25,selfPreservation:.82},
    aggressive:{name:'Aggressive',discipline:.55,painTolerance:.65,talkativeness:.34,riskTolerance:.78,selfPreservation:.35},
    predatory:{name:'Predatory',discipline:.72,painTolerance:.72,talkativeness:.08,riskTolerance:.60,selfPreservation:.58},
    stoic:{name:'Stoic',discipline:.94,painTolerance:.90,talkativeness:.08,riskTolerance:.48,selfPreservation:.58},
    nervous:{name:'Nervous',discipline:.28,painTolerance:.32,talkativeness:.42,riskTolerance:.28,selfPreservation:.82}
  };
  for(const [id,data] of Object.entries(personalities))Registry.add('personalityProfiles',id,data);

  const objects={
    cart:{name:'Cart',blocksMove:true,blocksLos:true,coverSp:15,destructible:true,flammable:true,climbable:false},
    lowWall:{name:'Low wall',blocksMove:true,blocksLos:false,coverSp:20,destructible:true,flammable:false,climbable:true},
    tree:{name:'Tree',blocksMove:true,blocksLos:true,coverSp:30,destructible:true,flammable:true,climbable:true},
    pillar:{name:'Stone pillar',blocksMove:true,blocksLos:true,coverSp:30,destructible:true,flammable:false,climbable:false},
    door:{name:'Door',blocksMove:true,blocksLos:true,coverSp:10,destructible:true,flammable:true,climbable:false},
    barrel:{name:'Barrel',blocksMove:false,blocksLos:false,coverSp:5,destructible:true,flammable:true,climbable:false},
    ladder:{name:'Ladder',blocksMove:false,blocksLos:false,coverSp:0,destructible:true,flammable:true,climbable:true}
  };
  for(const [id,data] of Object.entries(objects))Registry.add('battlefieldObjects',id,data);

  Registry.add('voiceProfiles','generic',{name:'Generic combat voice',painRestraint:.5,dialogueChance:.12});
  Registry.add('voiceProfiles','stoic',{name:'Restrained veteran voice',painRestraint:.9,dialogueChance:.08});
}
registerFoundationData();

// ============================================================================
// WORLD COMPOSER DATA — content variation is registered here, not hard-coded
// into combat. Regions, roles, equipment, mounts, histories and hoards are LEGO
// pieces consumed by ActorComposer / EncounterFactory.
// ============================================================================
function registerWorldComposerData(){
  const archetypes={
    bandit:{name:'Bandit / gang member',family:'Human',variants:['random','rabble','standard','veteran','cutpurse','bruiser','poacher','deserter','enforcer','boss']},
    soldier:{name:'Soldier',family:'Human',variants:['random','infantry','shield','spearman','halberdier','archer','arbalist','veteran']},
    knight:{name:'Knight',family:'Human',variants:['random','foot','shield','greatweapon','mounted','lancer']},
    cavalry:{name:'Cavalry',family:'Human',variants:['random','scout','horseman','lancer','heavy']},
    lord:{name:'Lord / noble',family:'Human',variants:['random','courtly','duelist','hunter','warVeteran','knightLord']},
    witchhunter:{name:'Witch Hunter',family:'Human',variants:['random','hunter','arbalist','swordsman','veteran','captain']},
    templeguard:{name:'Temple Guard',family:'Human',variants:['random','guard','shield','polearm','veteran']},
    inquisitor:{name:'Eternal Fire Inquisitor',family:'Human',variants:['random','interrogator','hunter','veteran']},
    mage:{name:'Mage',family:'Human',variants:['random','fire','ice','air','earth','illusion','support','battlemage','necromancer','master']},
    scoiatael:{name:'Scoia’tael',family:'Human',variants:['random','archer','sword','spear','veteran']}
  };
  for(const [id,data] of Object.entries(archetypes))Registry.add('actorArchetypes',id,data);

  const regional={
    Temeria:{blade:['armingSword','gleddyf'],heavy:['battleAxe','mace','poleAxe'],pole:['spear','poleAxe'],ranged:['crossbow','longBow']},
    Redania:{blade:['armingSword','gleddyf'],heavy:['mace','battleAxe','redHalberd'],pole:['spear','redHalberd','poleAxe'],ranged:['crossbow','longBow']},
    Kaedwen:{blade:['armingSword','torrwr'],heavy:['battleAxe','mace','highlandMauler'],pole:['spear','poleAxe'],ranged:['crossbow','warBow']},
    Aedirn:{blade:['armingSword','hunterFalchion'],heavy:['battleAxe','mace'],pole:['spear','poleAxe'],ranged:['crossbow','longBow']},
    Kovir:{blade:['armingSword','kord'],heavy:['mace','poleAxe'],pole:['spear','poleAxe'],ranged:['crossbow','longBow']},
    Nilfgaard:{blade:['esboda','vicovarian','armingSword'],heavy:['mace','battleAxe'],pole:['spear','poleAxe'],ranged:['crossbow','warBow']},
    Skellige:{blade:['krigsverd','armingSword'],heavy:['berserkerAxe','battleAxe','highlandMauler'],pole:['spear','poleAxe'],ranged:['warBow','longBow']},
    Toussaint:{blade:['ducalSword','viroledanBlade','armingSword','kord'],heavy:['flamberge','peasantsMaul','horsemanHammer','mace'],pole:['warLance','partisan','spear','poleAxe'],ranged:['huntsmansCrossbow','crossbow','longBow']},
    Zerrikania:{blade:['jambiya','armingSword'],heavy:['battleAxe','mace'],pole:['spear'],ranged:['warBow','longBow']}
  };
  Registry.add('loadoutPools','regionalHumanoid',{name:'Regional humanoid arms',roles:regional});
  Registry.add('loadoutPools','mageCombat',{name:'Mage combat styles',roles:{
    focus:['staff','hookedStaff','crystalStaff'],sword:['armingSword','kord','vicovarian'],greatblade:['flamberge','torrwr','vicovarian'],spear:['spear','hookedStaff'],shield:['armingSword','mace'],ranged:['crossbow','longBow']
  }});

  Registry.add('mountProfiles','horse',{name:'Horse',hp:40,controlMod:2,athletics:15,stats:{INT:1,REF:4,DEX:5,BODY:12,SPD:12,EMP:4,CRA:1,WILL:4,STUN:8},sta:40,rec:8,attack:10,damage:'2d6+2'});
  Registry.add('mountProfiles','warhorse',{name:'War Horse',hp:50,controlMod:-2,athletics:12,stats:{INT:1,REF:6,DEX:6,BODY:14,SPD:11,EMP:3,CRA:1,WILL:6,STUN:10},sta:50,rec:10,attack:14,damage:'4d6+2'});

  if(!Registry.bestiary.has('dog'))Registry.add('bestiary','dog',withBlock('dog',{name:'Dog',family:'Beast',hp:20,maxHp:20,sta:20,maxSta:20,rec:4,armor:0,stats:{INT:1,REF:3,DEX:5,BODY:3,SPD:5,EMP:4,CRA:1,WILL:5,STUN:4},defenses:{dodge:11,reposition:8,block:8,magic:8},attacks:[{name:'Bite',attack:10,type:'P',damage:'2d6',range:2,effects:[],rof:1}],abilities:['Scent Tracking','Feral'],genderRule:'biological'}));
  if(!Registry.bestiary.has('horse'))Registry.add('bestiary','horse',withBlock('horse',{name:'Horse',family:'Beast',hp:40,maxHp:40,sta:40,maxSta:40,rec:8,armor:0,stats:{INT:1,REF:4,DEX:5,BODY:12,SPD:12,EMP:4,CRA:1,WILL:4,STUN:8},defenses:{dodge:13,reposition:11,block:10,magic:8},attacks:[{name:'Hooves',attack:10,type:'B',damage:'2d6+2',range:2,effects:[],rof:1}],abilities:['Feral'],genderRule:'biological'}));
  if(!Registry.bestiary.has('warhorse'))Registry.add('bestiary','warhorse',withBlock('warhorse',{name:'War Horse',family:'Beast',hp:50,maxHp:50,sta:50,maxSta:50,rec:10,armor:0,stats:{INT:1,REF:6,DEX:6,BODY:14,SPD:11,EMP:3,CRA:1,WILL:6,STUN:10},defenses:{dodge:12,reposition:12,block:12,magic:10},attacks:[{name:'Hooves',attack:14,type:'B',damage:'4d6+2',range:2,effects:[],rof:1}],abilities:['Feral'],genderRule:'biological'}));

  // Battlefields now live in ./content/battlefields.ts, as buildable recipes.

  Registry.add('hoardTables','dragon',{name:'True Dragon hoard provenance',themes:['coin','arms','regalia','books','craftwork','relics','tradeGoods','gems']});
  Registry.add('lifepathPacks','specter',{name:'Specter mortal-history pack',family:'Specter'});
  Registry.add('lifepathPacks','cursed',{name:'Cursed-one origin pack',family:'Cursed'});

  // Source-backed core weapons that make regional soldiers, mages and knights less repetitive.
  const extraWeapons={
    staff:{name:'Staff',type:'B',wa:0,damage:'1d6+2',rel:10,hands:2,range:'melee',reach:2,effects:['LongReach','Focus1']},
    hookedStaff:{name:'Hooked staff',type:'B',wa:0,damage:'2d6',rel:10,hands:2,range:'melee',reach:2,effects:['LongReach','Focus1','Grappling']},
    ironStaff:{name:'Iron staff',type:'B',wa:0,damage:'3d6',rel:15,hands:2,range:'melee',reach:2,effects:['LongReach','Focus2']},
    crystalStaff:{name:'Crystal staff',type:'B',wa:0,damage:'2d6+2',rel:5,hands:2,range:'melee',reach:2,effects:['LongReach','Focus3','GreaterFocus']},
    poleAxe:{name:'Pole axe',type:'S',wa:0,damage:'4d6+2',rel:10,hands:2,range:'melee',reach:2,effects:['LongReach']},
    redHalberd:{name:'Red halberd',type:'S',wa:0,damage:'6d6+3',rel:10,hands:2,range:'melee',reach:2,effects:['LongReach']},
    highlandMauler:{name:'Highland mauler',type:'B',wa:0,damage:'6d6+2',rel:20,hands:2,range:'melee',reach:2,effects:['Meteorite']},
    bluntedLance:{name:'Blunted Lance',type:'B',wa:0,damage:'2d6',rel:5,hands:1,range:'melee',reach:2,effects:['LongReach','Charging','NonLethal']},
    ducalSword:{name:'Ducal Sword',type:'S/P',wa:0,damage:'5d6',rel:10,hands:1,range:'melee',reach:2,effects:['ArmorPiercing']},
    flamberge:{name:'Flamberge',type:'S/P',wa:-1,damage:'6d6',rel:15,hands:2,range:'melee',reach:2,effects:['LongReach','Ablating']},
    horsemanHammer:{name:"Horseman’s Hammer",type:'B/P',wa:0,damage:'2d6',rel:10,hands:1,range:'melee',reach:2,effects:['Charging']},
    partisan:{name:'Partisan',type:'S/P/B',wa:1,damage:'4d6+2',rel:10,hands:2,range:'melee',reach:2,effects:['LongReach','Bleeding25']},
    peasantsMaul:{name:"Peasant’s Maul",type:'B',wa:0,damage:'5d6',rel:5,hands:2,range:'melee',reach:2,effects:['Ablating']},
    viroledanBlade:{name:'Viroledan Blade',type:'S/P',wa:1,damage:'4d6+4',rel:10,hands:2,range:'melee',reach:2,effects:['Balanced','Bleeding30','Poison30']},
    warLance:{name:'War Lance',type:'P',wa:0,damage:'2d6',rel:10,hands:1,range:'melee',reach:2,effects:['LongReach','Charging']},
    huntsmansCrossbow:{name:"Huntsman’s Crossbow",type:'P',wa:2,damage:'5d6',rel:10,hands:2,range:150,effects:['SlowReload']}
  };
  for(const [id,w] of Object.entries(extraWeapons))if(!Registry.weapons.has(id))Registry.add('weapons',id,{...w,...(WEAPON_TRAITS[id]??{})});

  const voiceAdd={
    WitchHunter:{name:'Witch Hunter',lines:{attack:['Take the mutant alive if you can!','Crossbows ready!','Do not let the sorcery start!','Close the lane!'],pain:['Hnh—keep on him.','The bastard found a gap.','Still standing.'],critical:['Get a surgeon!','My leg is done!','The arm will not answer!'],surrender:['Enough. I yield.','Quarter!'],retreat:['Back to the line!','Withdraw!'],victory:['Bind the suspect. Search every pouch.','Bag the potions separately.']}},
    EternalFire:{name:'Eternal Fire',lines:{attack:['Hold him for judgment!','Keep the line!','Do not let the witchcraft through!','Temple Guard—forward!'],pain:['Damnation.','I can continue.','Keep formation.'],critical:['Physician!','I cannot stand!'],surrender:['I yield.','Enough.'],retreat:['Back to the temple!','Withdraw!'],victory:['Secure the prisoner.','Search for forbidden charms and writings.']}},
    Knight:{name:'Knight',lines:{attack:['With me!','Keep your guard!','Drive him back!','Now—press him!'],pain:['A hard cut.','Still fighting.','That found the mail.'],critical:['My leg—!','The arm is broken!'],surrender:['I yield.','I concede the field.'],retreat:['Withdraw in order!'],victory:['Disarm him before anything else.']}},
    Noble:{name:'Noble',lines:{attack:['At him!','Do not let him close!','Guards—now!'],pain:['Damn you.','That was expensive armor.'],critical:['A physician!','Get him away from me!'],surrender:['Enough. I yield.'],retreat:['Get me clear!'],victory:['Search him. Carefully.']}},
    Gang:{name:'Urban gang',lines:{attack:['Box him in!','Watch the alley!','Cut him off!','Do not let him reach the street!'],pain:['Shit—!','That cut deep.','Still here.'],critical:['My arm!','I cannot stand!'],surrender:['All right! Enough!'],retreat:['Scatter!','Lose him in the streets!'],victory:['Take the purse and anything worth fencing.']}}
  };
  for(const [id,data] of Object.entries(voiceAdd))if(!Registry.voiceSets.has(id))Registry.add('voiceSets',id,data);
}
registerWorldComposerData();


