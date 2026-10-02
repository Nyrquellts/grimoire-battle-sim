import { Dice, Pipeline } from '../core/kernel';
import { usesSkillBasedCombat } from '../entities/Actor';
import { GridService } from './GridService';
import { CombatRules } from './CombatRules';
import { effectiveSkill } from './Skills';
import type { DamageResolver, DamageResult } from './Damage';
import type { DefenseResolver } from './Defense';
import type { ActorAccess } from './Teams';
import type { IActor, IState, WeaponProfile } from '../entities/types';

/**
 * Attack resolution: turning an intent to attack into hits, misses, and damage.
 *
 * One implementation serves every attacker. Whether the roll comes from a skill or a stat-block,
 * whether the weapon is carried or innate, and whether the attacker is player- or AI-controlled are
 * all answered by data, never by who the actor is.
 *
 * Per strike: pick the location, check range and line of sight, assemble modifiers, roll, let the
 * target defend, roll damage, hand off to the damage pipeline. A fast strike makes two attacks; a
 * strong strike doubles raw damage at -3 to hit. `ruleStatus: standard`.
 *
 * Targeting and narration are injected because both still live in the legacy bridge. Neither
 * decides an outcome — narration only describes one.
 */

/** One attack action. `enemyAttack` supplies an innate attack profile instead of a carried weapon. */
export interface AttackRequest {
  actorId: string;
  targetId?: string | null;
  weaponId?: string;
  mode?: 'normal' | 'fast' | 'strong' | string;
  /** A hit location id, or `'random'` to roll for it. */
  called?: string;
  enemyAttack?: WeaponProfile | null;
  extraPenalty?: number;
  chargeBonusDice?: number;
}

/** One strike's outcome. A fast attack produces two of these. */
export interface StrikeResult {
  hit: boolean;
  reason?: string;
  roll?: { total: number; text: string };
  defense?: { roll: { total: number; text: string }; success: boolean; type: string };
  damage?: DamageResult;
  location?: Record<string, unknown>;
  critical?: { tier: string; bonus: number } | null;
  story?: string;
}

export interface AttackOutcome {
  actor: IActor;
  target: IActor;
  weapon: WeaponProfile;
  mode: string;
  results: StrikeResult[];
}

export interface AttackDeps {
  actors: Pick<typeof ActorAccess, 'find'>;
  weapons: (id: string) => WeaponProfile | undefined;
  defense: DefenseResolver;
  damage: DamageResolver;
  targeting: {
    legal(state: IState, actor: IActor, target: IActor | null, options: Record<string, unknown>): boolean;
    nearest(state: IState, actor: IActor, options: Record<string, unknown>): IActor | null;
  };
  narrate: {
    hit(actor: IActor, target: IActor, weapon: unknown, damage: DamageResult): string;
    miss(actor: IActor, target: IActor, weapon: unknown): string;
  };
  applyWeaponEffects(state: IState, actor: IActor, target: IActor, weapon: WeaponProfile, damage: DamageResult): void;
  /**
   * How the ground an attacker is standing on changes a ranged shot.
   *
   * Fighting in water quarters bow and crossbow range and halves their damage. Range is checked
   * before the `attack:modifier` event fires, so this cannot be a
   * pipeline listener; it is injected instead, and defaults to "no effect" when absent.
   */
  rangedTerrain?(state: IState, actor: IActor): { rangeDivisor: number; damageHalved: boolean };
}

/**
 * Attack base for one weapon.
 *
 * Character sheets resolve from skills; stat-blocks carry a flat `attack`. Which skill a weapon
 * uses is weapon data (`combatSkill`), so any actor with the right skills can wield any weapon.
 */
export function attackBase(actor: IActor, weaponId: string, w: WeaponProfile): number {if(!usesSkillBasedCombat(actor))return actor.attack||w.attack||10;if(['punch','kick'].includes(weaponId))return effectiveSkill(actor,'Brawling');return effectiveSkill(actor,w?.combatSkill||'Swordsmanship')+(w.wa||0)}

export class AttackResolver {
  readonly #deps: AttackDeps;

  constructor(deps: AttackDeps) { this.#deps = deps; }

  /**
   * Range band modifier. Beyond twice the listed range the shot is impossible; inside 1.5 m it
   * is point blank. `ruleStatus: standard`.
   */
  rangeModifier(distance: number, listed: number): { ok: boolean; mod: number; label: string } {
    if(!Number.isFinite(listed)||listed<=0)return{ok:true,mod:0,label:'melee'};
    if(distance>listed*2)return{ok:false,mod:-99,label:'beyond maximum range'};
    if(distance<=1.5)return{ok:true,mod:5,label:'point blank'};
    if(distance<=listed*.25)return{ok:true,mod:0,label:'close'};
    if(distance<=listed*.5)return{ok:true,mod:-2,label:'medium'};
    if(distance<=listed)return{ok:true,mod:-4,label:'long'};
    return{ok:true,mod:-6,label:'extreme'}
  }
  /** Resolves one attack action into per-strike results. */
  attack(state: IState, {actorId,targetId,weaponId,mode='normal',called='random',enemyAttack=null,extraPenalty=0,chargeBonusDice=0}: AttackRequest): AttackOutcome {
    const actor=this.#deps.actors.find(state,actorId);
    let target=this.#deps.actors.find(state,targetId);
    if(actor&&!this.#deps.targeting.legal(state,actor,target,{attackable:true,hostile:true}))target=this.#deps.targeting.nearest(state,actor,{attackable:true,hostile:true});
    if(!actor||!target)throw new Error('Actor or legal target missing');
    const weaponKey=weaponId??actor.selectedWeapon??'';
    const weapon=enemyAttack||this.#deps.weapons(weaponKey);if(!weapon)throw new Error(`Weapon ${weaponKey||'(none)'} missing`);
    const model=target.family==='Human'?'human':'monster',ranged=weapon.range!=='melee'&&Number(weapon.range)>2;
    const strikes=mode==='fast'&&!ranged?2:1,results: StrikeResult[]=[];
    for(let i=0;i<strikes;i++){
      const loc=CombatRules.location(model,called),distance=GridService.distance(actor.pos,target.pos);
      const groundProfile=ranged?(this.#deps.rangedTerrain?.(state,actor)??{rangeDivisor:1,damageHalved:false}):{rangeDivisor:1,damageHalved:false};
      const reach=Number(enemyAttack?.range||weapon.reach||(weapon.range==='melee'?2:weapon.range))/groundProfile.rangeDivisor;
      if(ranged){const band=this.rangeModifier(distance,Number(reach));if(!band.ok){results.push({hit:false,reason:`Out of range (${distance.toFixed(1)}m; maximum ${(reach*2).toFixed(0)}m).`});continue}const los=GridService.los(state,actor.pos,target.pos);if(!los.clear){results.push({hit:false,reason:'Line of sight is blocked.'});continue}}
      else if(distance>reach){results.push({hit:false,reason:`Out of range (${distance.toFixed(1)}m > ${reach}m).`});continue}
      let base=enemyAttack?.attack??attackBase(actor,weaponKey,weapon),pen=loc.penalty+(mode==='strong'?-3:0)+extraPenalty+(Number(actor.pendingFeint)||0);
      if(ranged)pen+=this.rangeModifier(distance,Number(reach)).mod;
      if(ranged)pen+=Math.min(3,Number(actor.aim)||0);
      if(!ranged&&target.statuses.activeDodge)pen-=2;
      const mctx=Pipeline.emit('attack:modifier',{state,actor,target,weapon,ranged,distance,mod:pen});pen=mctx.mod;
      actor.pendingFeint=0;
      const roll=Dice.check(base+pen,{label:`${actor.name} attack`}),def=this.#deps.defense.resolve(state,target,roll,{weapon,actor,ranged}),hit=roll.total>def.roll.total;
      if(!hit){results.push({hit:false,roll,defense:def,location:loc,story:this.#deps.narrate.miss(actor,target,weapon)});continue}
      const dmg=Dice.rollNotation(weapon.damage||'1d6');let raw=dmg.total;
      // Silver (x): weapons carrying a silver payload add it against silver-vulnerable creatures.
      if(weapon.silverDamage&&target.silver)raw+=Dice.rollNotation(weapon.silverDamage).total;
      if(mode==='strong')raw*=2;if(chargeBonusDice>0)raw+=Dice.rollNotation(`${Math.max(0,Math.floor(chargeBonusDice))}d6`).total;
      // Bows and crossbows fired from deep water do half damage.
      if(groundProfile.damageHalved)raw=Math.floor(raw/2);
      const margin=roll.total-def.roll.total,critical=CombatRules.criticalFromMargin(margin),damage=this.#deps.damage.resolve(state,{attacker:actor,target,raw,type:weapon.type||'B',location:loc,weapon,critical,ranged,source:weapon.name});
      this.#deps.applyWeaponEffects(state,actor,target,weapon,damage);
      const story=damage.blocked?`${damage.blockedBy||'A magical defense'} catches the attack before it can wound ${target.name}.`:this.#deps.narrate.hit(actor,target,weapon,damage);
      results.push({hit:true,roll,defense:def,damage,location:loc,critical,story})
    }
    if(ranged&&actor.aim)actor.aim=0;
    return{actor,target,weapon,mode,results}
  }
}
