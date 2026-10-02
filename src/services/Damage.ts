import { Pipeline } from '../core/kernel';
import { isPlayerControlled } from '../entities/Actor';
import type { ConditionSystem } from './Conditions';
import type { CriticalService } from './CriticalWounds';
import type { PipelineContext } from '../core/EventPipeline';
import type { HitLocation, IActor, ICriticalWound, IState, WeaponProfile } from '../entities/types';

/**
 * Mutable context passed through `damage:before`. Listeners may cancel the hit outright, adjust the
 * raw amount, or contribute cover — which is how Quen and Active Shield stop damage without this
 * module knowing they exist.
 */
export interface DamageBeforeContext extends PipelineContext {
  state: IState;
  attacker: IActor;
  target: IActor;
  raw: number;
  type: string;
  location: HitLocation;
  weapon: WeaponProfile | null;
  critical: { tier: string; bonus: number } | null;
  ranged: boolean;
  source: string;
  coverSp: number;
  blockedBy?: string;
  injury?: ICriticalWound | null;
}

/**
 * The damage pipeline: one place where raw damage becomes lost Health.
 *
 * Order matters and is fixed:
 *
 * ```text
 * damage:before (cancellable)  -> cover  -> armour penetration -> resistance
 *   -> location multiplier -> critical bonus -> armour ablation -> Health
 *   -> Death State -> critical wound -> damage:after
 * ```
 *
 * `damage:before` is how effects that stop damage entirely work (Quen, Active Shield) without this
 * module knowing they exist. Armour Piercing halves effective SP and skips resistance; Improved
 * Armor Piercing does both harder. `ruleStatus: standard`.
 *
 * Dependencies are injected rather than imported so the pipeline itself carries no content: swap
 * the critical-wound tables and it still works. It deliberately does **not** know about AI — when a
 * dying actor survives a save, it emits `deathSave:passed` and lets the AI layer decide what that
 * means.
 */

/** One request into the damage pipeline. */
export interface DamageRequest {
  attacker: IActor;
  target: IActor;
  raw: number;
  type?: string;
  location: HitLocation;
  weapon?: WeaponProfile | null;
  critical?: { tier: string; bonus: number } | null;
  ranged?: boolean;
  source?: string;
}

export interface DamageDeps {
  conditions: Pick<ConditionSystem, 'enterDeath'>;
  deathState: { save(state: IState, target: IActor, reason?: string): { ok: boolean } | null };
  criticals: Pick<typeof CriticalService, 'inflict'>;
}

/** What a resolved hit did. Returned to narration and to the combat log. */
export interface DamageResult {
  dealt: number;
  raw: number;
  penetrated: number;
  armor: number;
  effectiveSp: number;
  coverSp: number;
  coverDamage: number;
  armorAbsorbed: number;
  location: Record<string, unknown>;
  critical: { tier: string; bonus: number } | null;
  remainingHp: number;
  hpBefore: number;
  hpAfter: number;
  maxHp: number;
  injury: ICriticalWound | null;
  contact: boolean;
  blocked?: boolean;
  blockedBy?: string;
  reason?: string;
}

export class DamageResolver {
  readonly #deps: DamageDeps;

  constructor(deps: DamageDeps) { this.#deps = deps; }

  /** Armour SP protecting one hit location, falling back to torso then to flat armour. */
  armorSlot(target: IActor, loc: HitLocation): number {if(target.armorByLocation)return target.armorByLocation[loc.id]??target.armorByLocation.torso??0;return target.armor||0}
  /** Stopping power the body has on its own. It adds to worn armour and is never ablated. */
  naturalSp(target: IActor): number {return Math.max(0,Number(target.naturalSp)||0)}
  /** Writes armour SP back after ablation. */
  setArmorSlot(target: IActor, loc: HitLocation, value: number): void {if(target.armorByLocation){const id=target.armorByLocation[loc.id]!=null?loc.id:'torso';target.armorByLocation[id]=Math.max(0,value)}else target.armor=Math.max(0,value)}
  /**
   * The damage pipeline. Emits `damage:before` (cancellable, e.g. Quen) and `damage:after`.
   */
  resolve(state: IState, {attacker,target,raw,type='S',location,weapon=null,critical=null,ranged=false,source='attack'}: DamageRequest): DamageResult {
    const hpBefore=target.hp,armorBefore=this.armorSlot(target,location)+this.naturalSp(target);
    const ctx=Pipeline.emit<DamageBeforeContext>('damage:before',{state,attacker,target,raw,type,location,weapon,critical,ranged,source,coverSp:0});
    if(ctx.cancelled)return{dealt:0,blocked:true,contact:false,blockedBy:ctx.blockedBy||'Defense',reason:ctx.reason,raw:Number(ctx.raw||0),penetrated:0,armor:armorBefore,effectiveSp:armorBefore,coverSp:ctx.coverSp||0,coverDamage:0,location,critical:null,remainingHp:target.hp,hpBefore,hpAfter:target.hp,maxHp:target.maxHp,injury:null,armorAbsorbed:0};
    let amount=ctx.raw,coverSp=ctx.coverSp||0,coverDamage=0;
    if(coverSp>0){coverDamage=Math.min(amount,coverSp);amount=Math.max(0,amount-coverSp)}
    const worn=this.armorSlot(target,location),sp=worn+this.naturalSp(target),blackDragon=target.exceptional==='dragon'&&target.variantKey==='black';
    let effectiveSp=sp,ignoreDR=false;const effects=(weapon?.effects as string[]|undefined)??[];
    // Both piercing levels subtract only half the armour's current value; only the
    // improved level additionally ignores Damage Resistance.
    if(!blackDragon&&effects.includes('ImprovedArmorPiercing')){effectiveSp=Math.floor(sp/2);ignoreDR=true}
    else if(!blackDragon&&effects.includes('ArmorPiercing'))effectiveSp=Math.floor(sp/2);
    const penetrated=Math.max(0,amount-effectiveSp);let afterResistance=penetrated;
    if(!ignoreDR&&(target.resistances||[]).includes(type))afterResistance=Math.floor(afterResistance/2);
    const dealt=Math.floor(afterResistance*location.mult)+(critical?.bonus||0);
    if(dealt>0&&worn>0){let ablate=effects.includes('Ablating')?2:1;if(blackDragon)ablate=Math.max(1,Math.floor(ablate/2));this.setArmorSlot(target,location,worn-ablate)}
    const wasInDeathState=!!target.death?.active&&!target.dead;
    target.hp-=dealt;
    if(target.hp<=0){
      const entered=this.#deps.conditions.enterDeath(target);
      // The death state belongs to every combatant, not only the human-controlled actor.
      // Resolve the immediate save for whoever was driven below zero; survivors remain in the fight
      // with effectiveSkill() already applying the one-third Death State reduction.
      if(dealt>0){const save=this.#deps.deathState.save(state,target,entered?'Entering Death State':wasInDeathState?'Injured in Death State':'Death State');if(save?.ok&&!isPlayerControlled(target)&&!target.dead)Pipeline.emit('deathSave:passed',{state,target,save})}
    }
    if(critical&&dealt>0&&!target.dead){const injury=this.#deps.criticals.inflict(target,critical.tier,location);ctx.injury=injury}
    const armorAbsorbed=Math.max(0,Math.min(amount,effectiveSp));
    const out: DamageResult={dealt,raw:Number(ctx.raw||0),penetrated,armor:sp,effectiveSp,coverSp,coverDamage,armorAbsorbed,location,critical,remainingHp:target.hp,hpBefore,hpAfter:target.hp,maxHp:target.maxHp,injury:ctx.injury??null,contact:true};Pipeline.emit('damage:after',{...ctx,result:out});return out
  }
}
