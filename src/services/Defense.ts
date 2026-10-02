import { Dice, Pipeline } from '../core/kernel';
import { isPlayerControlled } from '../entities/Actor';
import { effectiveSkill } from './Skills';
import type { ConditionSystem } from './Conditions';
import type { IActor, IState } from '../entities/types';

/**
 * Defense resolution: what the target does about an incoming attack.
 *
 * A stunned or frozen target cannot react and is hit against a static DC 10. Everyone else dodges.
 * The first defense in a round is free; each additional one costs 1 Stamina, and a target with no
 * Stamina left falls back to the static DC rather than being unable to defend at all.
 *
 * Repeated-defense cost is tracked in `state.turn` and therefore currently applies to the
 * human-controlled actor only. That shared pool is what Phase 13 replaces with per-actor turn
 * resources; the rule itself does not change.
 */

export interface DefenseChoice {
  type: 'dodge' | 'static' | string;
  base: number;
  cost: number;
  useReaction?: boolean;
}

export interface DefenseOutcome {
  roll: { total: number; text: string };
  success: boolean;
  type: string;
}

export class DefenseResolver {
  readonly #conditions: Pick<ConditionSystem, 'has'>;

  constructor(conditions: Pick<ConditionSystem, 'has'>) { this.#conditions = conditions; }

  /** Which defense the target will use, and what it costs them. */
  choose(state: IState, target: IActor, attack: unknown): DefenseChoice {
    if(this.#conditions.has(target,'stunned')||this.#conditions.has(target,'frozen'))return{type:'static',base:10,cost:0};
    const base: number=target.defenses?.dodge??target.defense??10;
    if(isPlayerControlled(target)){
      const used=state.turn.defensesUsed||0,freeByActiveDodge=!!target.statuses.activeDodge,cost=freeByActiveDodge?0:(used===0?0:1);
      return{type:'dodge',base:effectiveSkill(target,'Dodge / Escape'),cost}
    }
    return{type:'dodge',base,cost:0}
  }
  /** Rolls the chosen defense and reports whether it beat the attack. */
  resolve(state: IState, target: IActor, attackRoll: { total: number }, attack: unknown): DefenseOutcome {
    const d=this.choose(state,target,attack);
    if(d.cost&&target.sta<d.cost)return{roll:{total:10,text:'DC 10 — no STA for another defense'},success:attackRoll.total<10,type:'static'};
    if(d.cost)target.sta-=d.cost;
    if(isPlayerControlled(target)){state.turn.defensesUsed=(state.turn.defensesUsed||0)+1;if(d.useReaction)state.turn.reaction=0}
    // Mirrors `attack:modifier`: lets terrain and other non-invasive rules adjust the defense
    // without this resolver knowing what they are.
    const ctx=Pipeline.emit('defense:modifier',{state,target,attack,defense:d,mod:0});
    const base=d.base+(Number(ctx.mod)||0);
    const r=d.type==='static'?{total:10,text:'DC 10'}:Dice.check(base,{label:d.type});
    return{roll:r,success:r.total>=attackRoll.total,type:d.type}
  }
}
