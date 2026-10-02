import { Dice } from '../core/kernel';
import { clone } from '../core/utils';
import { pushFeed } from './CombatLog';
import { ActorStateService } from './ActorState';
import { ActorAccess } from './Teams';
import { Registry } from '../data/witcherContent';
import type { ContentRecord, IActor, IState } from '../entities/types';

/**
 * Loot, harvesting, and dragon hoards.
 *
 * Two separate ideas that are easy to conflate: **carried** loot is what an actor owns and takes
 * with it if it escapes, while **harvest** is what can be cut from a corpse. An actor that flees
 * keeps its possessions; one that dies leaves both behind. That distinction is why loot eligibility
 * is checked against actor state rather than just "is it dead".
 *
 * Content-driven: harvest tables, tools, and loot pools all come from the registry, so a new
 * creature's drops are a data row.
 *
 * Still imports the Witcher registry directly rather than taking it as a dependency — these are
 * content services, and the generic foundation does not use them.
 */

/** One rolled loot or harvest line. */
export interface LootLine { name: string; count: number }

/** One piece of recoverable gear. */
export interface LootItem { name: string; condition?: string; kind?: string; sp?: number }

/** Loot from several actors merged into one pile, as the after-battle screen shows it. */
export interface CombinedLoot {
  currency: { crowns: number };
  equipment: LootItem[];
  ammunition: LootLine[];
  personal: string[];
  harvest: LootLine[];
  valuables: string[];
  documents: string[];
  hoards: ContentRecord[];
  carcasses: ContentRecord[];
}

/** Everything recoverable from one actor, split by how it is recovered. */
export interface LootBundle {
  currency: { crowns: number; kind: string };
  equipment: LootItem[];
  ammunition: LootLine[];
  personal: string[];
  harvest: LootLine[];
  valuables: string[];
  documents: string[];
  hoard: ContentRecord | null;
}

const pick = <T>(list: readonly T[]): T => list[Dice.d(list.length) - 1]!;

/** Human-readable region label. Injected because encounter composition is still in the bridge. */
let regionLabel: (region: string) => string = region => String(region);

/** Wires the region labeller. Called once, from the composition root. */
export function setRegionLabeller(labeller: (region: string) => string): void {
  regionLabel = labeller;
}

export const DragonHoardService = Object.freeze({
  themesFromHistory(e: IActor){const text=(e.history??[]).join(' ').toLowerCase(),themes: string[]=[];if(/dwar|gnom|craft/.test(text))themes.push('dwarven and gnomish craftwork');if(/sorcer|mage|relic|power/.test(text))themes.push('magical curios, sealed components, and old research');if(/hunter|slayer|weapon|armor/.test(text))themes.push('arms and armor taken from failed hunters');if(/settlement|king|noble|regalia/.test(text))themes.push('coins, jewelry, regalia, and civic treasures from vanished rulers');if(/thiev|lost part of a hoard/.test(text))themes.push('carefully inventoried valuables gathered after an old theft');if(!themes.length)themes.push(String(e.identity?.hordeType||'coins, gemstones, and old worked treasure'));return[...new Set(themes)]},
  build(e: IActor){const value: number=Number(e.identity?.hordeValue)||({Young:5000,'Young Adult':10000,Adult:15000,Elder:25000}[e.ageBand as string]||5000),themes: string[]=this.themesFromHistory(e),coinShare=.20+(Dice.d(20)/100),coins=Math.floor(Number(value)*coinShare),remainder=Number(value)-coins,provenance=themes.map((theme,i)=>({name:theme,value:i===themes.length-1?remainder-Math.floor(remainder/themes.length)*(themes.length-1):Math.floor(remainder/themes.length)}));return{value,theme:themes.join('; '),themes,provenance,lair:e.identity?.lairRegion||e.encounterRegion||'unknown lair',ageBand:e.ageBand,historyHooks:(e.history||[]).filter((x: string)=>/event|hoard|lair|relic|hunter|dwar|thiev|settlement/i.test(x)).slice(-5),coins}}
});
export const LootService = Object.freeze({
  /** Rolls a loot quantity: a number, dice notation, or `"2d6/2"` for a fraction of a roll. */
  quantity(notation: unknown): number {
    if(Number.isFinite(Number(notation)))return Math.max(0,Number(notation));
    const text=String(notation).trim(),fraction=text.match(/^(.+?)\/(\d+)$/);
    if(fraction){const base=Dice.rollNotation(fraction[1]!).total;return Math.max(1,Math.ceil(base/Number(fraction[2]!)))}
    return Math.max(0,Dice.rollNotation(text).total)
  },
  /** Registry key for a creature's harvest table, derived from its content id or name. */
  harvestKey(e: IActor): string {return e.creatureKey||String(e.baseName||e.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'')},
  rollHarvest(table: ContentRecord | null | undefined){return(table?.parts||[]).filter((part: ContentRecord)=>(part.channel||'harvest')==='harvest').map((part: ContentRecord)=>({name:part.name,count:this.quantity(part.quantity)}))},
  rollPool(table: ContentRecord | null | undefined, channel: string){return(table?.parts||[]).filter((part: ContentRecord)=>(part.channel||'harvest')===channel).map((part: ContentRecord)=>({name:part.name,count:this.quantity(part.quantity)})).filter((x: LootLine)=>x.count>0)},
  condition(e: IActor){const ratio=Math.max(0,Math.min(1,e.hp/Math.max(1,e.maxHp)));return ratio>.65?'serviceable':ratio>.25?'damaged':'badly damaged'},
  personal(e: IActor){const id: ContentRecord=e.identity||{};const items: string[]=[];if(e.family==='Human'){items.push(...((e.carriedBag as string[]|undefined)||[]));if(!(e.carriedBag as string[]|undefined)?.length)items.push('satchel','waterskin','trail rations','flint and steel',pick(['10 m rope','bedroll','small lantern']));if(id.familyStatus)items.push(`token from a ${String(id.familyStatus).toLowerCase()}`);if((e.history||[]).some((x: string)=>/lover|romance/i.test(x)))items.push('old personal keepsake');if(e.mage)items.push(pick(['ink-stained notes','spell component pouch','wax-sealed correspondence','focus crystal']))}return[...new Set(items)]},
  wealthTier(e: IActor){if(e.archetype==='lord')return 4;if(e.archetype==='bandit'&&e.role==='boss')return 3;if(['knight','mage'].includes(e.archetype as string))return 3;if(['cavalry','inquisitor'].includes(e.archetype as string))return 2;if(['soldier','witchhunter','templeguard','scoiatael'].includes(e.archetype as string))return 1;return 0},
  purse(e: IActor){const tier=this.wealthTier(e),notation=['2d10','3d10+10','4d10+20','5d10+40','6d10+100'][tier]||'2d10';return Dice.rollNotation(notation).total+(e.ai?.experience==='veteran'?Dice.d(30):e.ai?.experience==='master'?Dice.d(60):0)},
  recoverableCarried(e: IActor){if(!e?.loot||e.fled)return false;const life=ActorStateService.life(e);return life==='dead'||life==='unconscious'||!!e.statuses?.captured},
  generate(e: IActor){
    const loot: LootBundle={currency:{crowns:0,kind:String(e.encounterRegion||e.identity?.region||'mixed')},equipment:[],ammunition:[],personal:[],harvest:[],valuables:[],documents:[],hoard:null};
    if(e.family==='Human'){
      loot.currency.crowns=this.purse(e);
      const condition=this.condition(e),weapon=e.weaponId&&Registry.weapons.get(e.weaponId),sidearm=e.sidearmId&&Registry.weapons.get(e.sidearmId);
      if(weapon)loot.equipment.push({name:String(weapon.name),condition:String(e.equipmentState?.weapon?.condition||'serviceable'),kind:'weapon'});if(sidearm)loot.equipment.push({name:String(sidearm.name),condition:String(e.equipmentState?.sidearm?.condition||'serviceable'),kind:'sidearm'});
      if((e.armor||0)>0)loot.equipment.push({name:`${regionLabel(String(e.encounterRegion||e.identity?.region||'regional'))} armor`,condition:String((e.appearance as ContentRecord|undefined)?.armorCondition||condition),kind:'armor',sp:e.armor});
      const carried=typeof e.ammo==='number'?e.ammo:0;if(carried>0)loot.ammunition.push({name:e.weaponId==='crossbow'?'crossbow bolts':'arrows',count:carried});
      loot.personal.push(...this.personal(e));
      if(e.archetype==='bandit'&&e.role==='boss'){
        loot.personal.push('gang strongbox key',pick(['marked deck and loaded dice','fine stolen gloves','silver-chased drinking cup','expensive belt taken from a traveler']));
        loot.valuables.push(pick(['a pouch of stolen jewelry','a bundle of fence-ready valuables','several rings and brooches wrapped in cloth','a merchant purse kept apart from the gang’s daily coin']));
        loot.documents.push(pick(['gang ledger naming debts and shares','note identifying a local fence','rough list of travelers worth robbing','ransom note and names of useful contacts']));
      }
      if(e.mage)loot.documents.push(pick(['annotated spell notes','a coded letter','an alchemical shopping list','a half-finished magical calculation']));if(['WitchHunter','EternalFire'].includes(e.faction as string))loot.documents.push(pick(['arrest warrant','interrogation notes','sealed order from an Eternal Fire office','list of suspected mages or nonhumans']));if(e.archetype==='lord')loot.documents.push(pick(['sealed household letter','estate account','letter of introduction','hunting invitation']));if(e.mount)loot.personal.push(`${e.mount.name} tack and saddle equipment`);return loot
    }
    const table=Registry.harvestTables.get(this.harvestKey(e));
    // Ordinary monsters do not magically carry coins and do not receive fabricated
    // "monster parts". Only listed carried/valuable loot is pre-rolled here;
    // body components are rolled when the carcass is actually harvested.
    if(table){
      const carried=this.rollPool(table,'personal'),valuables=this.rollPool(table,'valuables');
      loot.personal.push(...carried.map((x: LootLine)=>x.count===1?x.name:`${x.count} × ${x.name}`));
      loot.valuables.push(...valuables.map((x: LootLine)=>x.count===1?x.name:`${x.count} × ${x.name}`));
    }
    if(e.exceptional==='dragon'){
      loot.hoard=DragonHoardService.build(e);loot.currency.crowns=loot.hoard.coins;for(const row of loot.hoard.provenance)loot.valuables.push(`${row.name} worth roughly ${row.value} crowns`);if(loot.hoard.historyHooks.length)loot.documents.push(`Hoard provenance reflects: ${loot.hoard.historyHooks.join(' / ')}`);return loot
    }
    if(e.exceptional==='higherVampire'){
      loot.currency.crowns=Dice.d(100)*10;loot.personal.push('fine clothing',`${e.identity?.tribe||'vampire'}-tribe personal token`);loot.documents.push('old correspondence tied to a mortal identity');return loot
    }
    return loot
  },
  combine(rows: ContentRecord[]){const bundle: CombinedLoot={currency:{crowns:0},equipment:[],ammunition:[],personal:[],harvest:[],valuables:[],documents:[],hoards:[],carcasses:[]};for(const loot of rows){bundle.currency.crowns+=loot.currency?.crowns||0;for(const key of ['equipment','ammunition','personal','harvest','valuables','documents'] as const)(bundle[key] as unknown[]).push(...((loot[key] as unknown[]|undefined)??[]));if(loot.hoard)bundle.hoards.push(loot.hoard)}return bundle}
});

export const HarvestService = Object.freeze({
  tableFor(enemy: IActor){return Registry.harvestTables.get(LootService.harvestKey(enemy))||null},
  toolFor(actor: IActor){for(const id of (actor.tools as string[]|undefined)??[]){const tool=Registry.tools.get(id);if(tool)return tool}return null},
  hasHarvest(enemy: IActor){const table=this.tableFor(enemy);return!!table&&((table.parts as ContentRecord[]|undefined)??[]).some((p: ContentRecord)=>(p.channel||'harvest')==='harvest')},
  /** Harvests a corpse, moving the recovered parts into the log. */
  carve(state: IState, enemyId: string) {
    const enemy=ActorAccess.find(state,enemyId)!,actor=state.player,table=this.tableFor(enemy),tool=this.toolFor(actor);
    if(!table||!this.hasHarvest(enemy))throw new Error('This creature has no harvest pool.');
    const recovered=LootService.rollPool(table,'harvest');
    enemy.harvested=true;enemy.harvestResult={tool:tool?.name||'field knife',recovered:clone(recovered)};
    state.aftermath??={};state.aftermath.loot??=LootService.combine([]);for(const item of recovered){const found=(state.aftermath.loot as CombinedLoot).harvest.find((x: LootLine)=>x.name===item.name);if(found)found.count+=item.count;else (state.aftermath.loot as CombinedLoot).harvest.push(item)}
    pushFeed(state,{title:`Harvest ${enemy.name}`,story:`Using ${tool?.name||'a field knife'}, ${actor.name} recovers ${recovered.map((x: LootLine)=>`${x.count}× ${x.name}`).join(', ')||'nothing usable'} from its loot pool.`,math:`${table.source} · ordinary listed loot uses the source quantities; no invented generic-part roll.`});
    return enemy.harvestResult
  }
});
