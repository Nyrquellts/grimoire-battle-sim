import { Dice, Pipeline } from '../core/kernel';
import { RAW_CRITICALS } from '../data/raw/witcherData';
import type { HitLocation, IActor, ICriticalWound } from '../entities/types';

/** One row of a critical-wound tier table. */
interface CriticalRow { min: number; name: string; fresh: string; stabilized: string; treated: string; fatal?: boolean }

/**
 * Witcher critical wounds: which wound a critical inflicts, what it does, and how it heals.
 *
 * Wounds are rolled on 2d6 against the tier's table and applied in two parts — the recorded injury
 * (name, tier, location, healing time) and its immediate mechanical consequences (bleeding, a
 * disabled limb, a pending death save). Skill penalties from a wound are applied at read time by
 * `effectiveSkill`, not stored, so treating a wound takes effect immediately.
 *
 * `ruleStatus: standard`. This is Witcher-specific content-rules;
 * the generic damage pipeline reaches it only through the injected `criticals` dependency.
 */
export const CriticalService = {
  healingDays(body: number, tier: string): number {const table: { days: Record<number, number[]>; tiers: string[] }={days:{3:[5,9,12,15],4:[4,8,11,14],5:[3,7,10,13],6:[2,6,9,12],7:[1,5,8,11],8:[1,4,7,10],9:[1,3,6,9],10:[1,2,5,8],11:[1,1,4,7],12:[1,1,3,6],13:[1,1,2,5]},tiers:['simple','complex','difficult','deadly']};const b=Math.max(3,Math.min(13,body));return table.days[b]![table.tiers.indexOf(tier)]!},
  treatment(tier: string) {const table: Record<string, { turns: number; dc: number; spellUses: number; spellDc: number }>={simple:{turns:2,dc:12,spellUses:4,spellDc:14},complex:{turns:4,dc:14,spellUses:6,spellDc:16},difficult:{turns:6,dc:16,spellUses:8,spellDc:18},deadly:{turns:8,dc:18,spellUses:10,spellDc:20}};return table[tier]!},
  inflict(target: IActor, tier: string, location: HitLocation): ICriticalWound {target.criticals??=[];const rows=(RAW_CRITICALS as Record<string, CriticalRow[]>)[tier]!,roll=Dice.d(6)+Dice.d(6),w=rows.slice().sort((a: CriticalRow,b: CriticalRow)=>b.min-a.min).find((x: CriticalRow)=>roll>=x.min)||rows[rows.length-1]!,inj={id:`cw-${target.id}-${target.criticals!.length+1}`,tier,name:w.name,location:location.id,state:'fresh',fresh:w.fresh,stabilized:w.stabilized,treated:w.treated,fatal:!!w.fatal,roll,days:this.healingDays(target.stats?.BODY||5,tier)};target.criticals!.push(inj);if(w.fatal){target.hp=-999;target.dead=true}this.applyMechanical(target,inj);Pipeline.emit('critical:inflicted',{target,injury:inj});return inj},
  applyMechanical(t: IActor, inj: ICriticalWound): void {t.disabledLocations??={};const n=inj.name.toLowerCase();if(/bleed/.test(inj.fresh)||['ruptured spleen','skull fracture','compound arm fracture','compound leg fracture','damaged eye','heart damage','dismembered arm','dismembered leg'].some(x=>n.includes(x)))t.statuses.bleeding=true;if(n.includes('torn stomach'))t.statuses.internalAcid=true;if(n.includes('sucking chest'))t.statuses.suffocating=true;if(n.includes('septic shock'))t.statuses.poisoned=true;if(n.includes('arm')&&(n.includes('compound')||n.includes('dismembered')))t.disabledLocations![inj.location]=true;if(n.includes('leg')&&n.includes('dismembered'))t.disabledLocations![inj.location]=true;if(n.includes('heart damage'))t.deathSavePending=true},
  stabilize(t: IActor, skillBase = 12) {const wound=(t.criticals??[]).filter(x=>x.state==='fresh'&&!x.fatal).sort((a,b)=>['simple','complex','difficult','deadly'].indexOf(b.tier)-['simple','complex','difficult','deadly'].indexOf(a.tier))[0];if(!wound)return{ok:false,reason:'No untreated critical wound.'};const spec=this.treatment(wound.tier)!,r=Dice.check(skillBase,{label:'First Aid'});if(r.total>=spec.dc){wound.state='stabilized';return{ok:true,roll:r,wound}}return{ok:false,roll:r,reason:`Failed DC ${spec.dc}.`,wound}}
};
