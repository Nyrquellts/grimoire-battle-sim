import type { IActor } from '../entities/types';

/**
 * Effective skill value after everything currently working against an actor.
 *
 * Three sources of penalty, applied in order:
 *
 * 1. transient conditions (staggered, blinded);
 * 2. untreated critical wounds, which bite harder while fresh than once stabilised;
 * 3. the Death State, which reduces everything to a third.
 *
 * Critical-wound penalties are matched by wound name because that is how the wound tables are
 * written. Moving those modifiers into the wound definitions themselves is the natural follow-up
 * once critical wounds become typed content.
 */
export function effectiveSkill(actor: IActor, name: string): number {
  let v: number=actor.skills?.[name]??actor.defense??10;
  if(actor.statuses.staggered)v-=2;
  if(actor.statuses.blinded&&['Swordsmanship','Crossbow','Dodge / Escape','Athletics'].includes(name))v-=3;
  for(const cw of actor.criticals??[]){
    if(cw.state==='treated')continue;
    const n=cw.name.toLowerCase();
    if((n.includes('fractured leg')||n.includes('compound leg'))&&['Dodge / Escape','Athletics'].includes(name))v-=cw.state==='fresh'?3:2;
    if(n.includes('concussion')&&['Swordsmanship','Crossbow','Dodge / Escape'].includes(name))v-=cw.state==='fresh'?2:1;
    if(n.includes('torn stomach'))v-=cw.state==='fresh'?2:1;
    if(n.includes('damaged eye')&&['Crossbow','Awareness'].includes(name))v-=cw.state==='fresh'?4:2;
    if(n.includes('fractured arm')&&['Swordsmanship','Crossbow','Brawling'].includes(name))v-=cw.state==='fresh'?3:2;
    if(n.includes('sprained arm')&&['Swordsmanship','Crossbow','Brawling'].includes(name))v-=cw.state==='fresh'?2:1;
  }
  if(actor.death?.active)v=Math.max(1,Math.floor(v/3));
  return Math.max(0,v)
}
