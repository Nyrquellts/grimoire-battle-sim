import { Dice } from '../core/kernel';
import type { HitLocation } from '../entities/types';

/**
 * Core combat rules that are pure tables and formulas: where a blow lands, how badly, and when a
 * hit becomes a critical wound.
 *
 * Hit location tables. Humanoid: head 1 (-6, x3), torso 2-4 (-1, x1),
 * arms and legs x1/2. Non-humanoid anatomies use the monster table, which replaces arms and legs
 * with limbs and a special location for tails and wings. `ruleStatus: standard`.
 *
 * These are Witcher values, but the *shape* is generic: a location has an attack penalty and a
 * damage multiplier, and the damage pipeline needs nothing else.
 */

export const HitLocations: Record<string, HitLocation[]> = {
  human:[{roll:[1,1],id:'head',name:'Head',penalty:-6,mult:3},{roll:[2,4],id:'torso',name:'Torso',penalty:-1,mult:1},{roll:[5,5],id:'rightArm',name:'Right Arm',penalty:-3,mult:.5},{roll:[6,6],id:'leftArm',name:'Left Arm',penalty:-3,mult:.5},{roll:[7,8],id:'rightLeg',name:'Right Leg',penalty:-2,mult:.5},{roll:[9,10],id:'leftLeg',name:'Left Leg',penalty:-2,mult:.5}],
  monster:[{roll:[1,1],id:'head',name:'Head',penalty:-6,mult:3},{roll:[2,4],id:'torso',name:'Torso',penalty:-1,mult:1},{roll:[5,7],id:'rightLimb',name:'Right Limb',penalty:-3,mult:.5},{roll:[8,9],id:'leftLimb',name:'Left Limb',penalty:-3,mult:.5},{roll:[10,10],id:'special',name:'Tail / Wing / Special',penalty:-2,mult:.5}]
};
export const CombatRules = {
  /** Melee damage bonus from BODY. `ruleStatus: standard`. */
  bodyDamage(body: number): number {if(body<=2)return-4;if(body<=4)return-2;if(body<=6)return 0;if(body<=8)return 2;if(body<=10)return 4;if(body<=12)return 6;return 8},
  /**
   * Where a thrown or knocked-away object ends up when it misses.
   *
   * The object travels 1d6 metres away in a random direction, whether it is a fumbled or
   * disarmed weapon or a bomb that fails its Athletics check and lands off target.
   *
   * The direction is a d10 read as ten headings around the compass, and the distance is measured
   * along that heading — so a diagonal scatter travels 1d6 metres like any other, rather than 1d6
   * on each axis. The caller keeps the result on the map.
   */
  scatter(origin: { x: number; y: number }, metres: number | null = null): { x: number; y: number } {
    const distance = metres ?? Dice.rollNotation('1d6').total;
    const heading = (Dice.d(10) - 1) * (Math.PI / 5);
    return {
      x: Math.round(origin.x + Math.cos(heading) * distance),
      y: Math.round(origin.y + Math.sin(heading) * distance)
    };
  },

  /**
   * Resolves a hit location, rolled on a d10 or named for a called shot.
   * Called shots accept human names against monster anatomies and vice versa.
   */
  location(model = 'human', called = 'random'): HitLocation {const table=HitLocations[model]||HitLocations.monster!;if(called!=='random'){const row=table.find(x=>x.id===called)||table.find(x=>called==='leftArm'&&x.id==='leftLimb')||table.find(x=>called==='rightArm'&&x.id==='rightLimb')||table.find(x=>called==='leftLeg'&&x.id==='leftLimb')||table.find(x=>called==='rightLeg'&&x.id==='rightLimb');if(!row)throw new Error(`Unknown hit location ${called}`);return{...row,rolled:null}}const r=Dice.d(10),row=table.find(x=>r>=x.roll![0]!&&r<=x.roll![1]!)!;return{...row,rolled:r}},
  /**
   * Critical tier from how far the attack beat the defense.
   * 7+ simple, 10+ complex, 13+ difficult, 15+ deadly. `ruleStatus: standard`.
   */
  criticalFromMargin(margin: number): { tier: string; bonus: number } | null {if(margin>=15)return{tier:'deadly',bonus:10};if(margin>=13)return{tier:'difficult',bonus:8};if(margin>=10)return{tier:'complex',bonus:5};if(margin>=7)return{tier:'simple',bonus:3};return null},
  /** How far a melee weapon reaches, in metres. */
  meleeRange(weapon: { reach?: unknown }): number { return Number(weapon.reach || 2); },
};
