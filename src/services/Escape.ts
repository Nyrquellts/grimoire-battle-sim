import { GridService, isOccupied } from './GridService';
import { pushFeed } from './CombatLog';
import { ensureRetreat, isRouting } from './ActorState';
import type { IActor, IPosition, IRetreatState, IState } from '../entities/types';

/**
 * Retreat and escape: how an actor that has decided to leave actually gets off the map.
 *
 * Breaking off is not instant. A routing actor picks the cheapest edge that leads away from its
 * pursuer, runs as far as its movement allows, and only escapes on reaching the boundary. Until
 * then it is still present, still hostile, and still catchable — which is what makes a rout a
 * tactical situation rather than a despawn.
 *
 * An actor that escapes takes its loot with it. One that is cut down first does not.
 */

export interface EscapePlan {
  exit: IPosition;
  path: IPosition[];
  cost: number;
  /** Distance from the exit to the pursuer; further is preferred. */
  playerDistance: number;
}

export interface EscapeStep {
  ok: boolean;
  escaped: boolean;
  moved: number;
  reason?: string;
  exit?: IPosition;
}

export interface EscapeDeps {
  /** Movement available this round, after terrain and zone effects. */
  moveBudget(state: IState, actor: IActor): number;
  /** An optional parting line; narration only, never affects the outcome. */
  retreatLine(state: IState, actor: IActor): string | null;
}

export class EscapeSystem {
  readonly #deps: EscapeDeps;

  constructor(deps: EscapeDeps) { this.#deps = deps; }

  /** The actor's retreat record, created on first use. */
  ensure(actor: IActor): IRetreatState { return ensureRetreat(actor); }
  /** Running for an edge but not yet gone. */
  isRouting(actor: IActor | null | undefined): boolean { return isRouting(actor); }
  /** Whether a position is on the battlefield boundary — the only place an escape completes. */
  isEdge(pos: IPosition | null | undefined): boolean {return !!pos&&(pos.x===0||pos.y===0||pos.x===GridService.W-1||pos.y===GridService.H-1)}
  /** Boundary tiles this actor could actually stand on. */
  edgeTiles(state: IState, actor: IActor): IPosition[] {
    const tiles: IPosition[]=[];
    for(let x=0;x<GridService.W;x++){tiles.push({x,y:0},{x,y:GridService.H-1})}
    for(let y=1;y<GridService.H-1;y++){tiles.push({x:0,y},{x:GridService.W-1,y})}
    return tiles.filter(pos=>{const tile=GridService.tile(state,pos.x,pos.y);return tile&&!tile.blocksMove&&(!isOccupied(state,pos.x,pos.y,actor.id)||(actor.pos.x===pos.x&&actor.pos.y===pos.y))});
  }
  /**
   * Cheapest route to an edge, preferring exits away from the pursuer.
   * Ties break on coordinates so a cornered actor does not dither between equal routes.
   */
  plan(state: IState, actor: IActor | null | undefined): EscapePlan | null {
    if(!actor||actor.dead||actor.fled||actor.removed)return null;
    if(this.isEdge(actor.pos))return{exit:{...actor.pos},path:[{...actor.pos}],cost:0,playerDistance:GridService.distance(actor.pos,state.player.pos)};
    const candidates: EscapePlan[]=[];
    for(const exit of this.edgeTiles(state,actor)){
      const path=GridService.path(state,actor.pos,exit,actor.id);if(path.length<2)continue;
      const cost=GridService.pathCost(state,path),playerDistance=GridService.distance(exit,state.player.pos);
      candidates.push({exit,path,cost,playerDistance});
    }
    candidates.sort((a,b)=>a.cost-b.cost||b.playerDistance-a.playerDistance||a.exit.y-b.exit.y||a.exit.x-b.exit.x);
    return candidates[0]||null;
  }
  /** Marks the actor as routing, once. */
  begin(state: IState, actor: IActor): IRetreatState {const retreat=this.ensure(actor);if(retreat.state!=='routing'){retreat.state='routing';retreat.startedRound=state.round;retreat.blocked=0;retreat.lastRoute=[];retreat.exit=null}return retreat}
  /** Completes an escape: the actor leaves the map, taking whatever it carried. */
  escape(state: IState, actor: IActor, { moved = 0 }: { moved?: number } = {}): EscapeStep {
    const retreat=this.ensure(actor),line=this.#deps.retreatLine(state,actor);
    retreat.state='escaped';retreat.escapedRound=state.round;retreat.lastPos={...actor.pos};actor.fled=true;
    if(state.selectedEnemyId===actor.id)state.selectedEnemyId=null;
    pushFeed(state,{kind:'move',title:`${actor.name} escapes`,story:`${actor.name} reaches the edge of the battlefield and gets away.${line?` ${actor.exceptional==='dragon'?'Telepathy: ':''}“${line}”`:''} Anything still carried leaves with ${actor.gender==='Female'?'her':actor.gender==='Male'?'him':'it'}.`,math:`Escaped after ${Number(moved||0).toFixed(1)} m this turn · this actor's unrecovered loot is lost.`});
    return{ok:true,escaped:true,moved};
  }
  /**
   * One round of running. Reaching an edge escapes; running out of movement leaves the actor on
   * the map and still catchable, which is what makes routing a real tactical state.
   */
  step(state: IState, actor: IActor, planned: EscapePlan | null = null): EscapeStep {
    const retreat=this.begin(state,actor);
    if(this.isEdge(actor.pos))return this.escape(state,actor,{moved:0});
    const plan=planned||this.plan(state,actor);
    if(!plan){retreat.state='cornered';retreat.blocked=(retreat.blocked||0)+1;return{ok:false,escaped:false,moved:0,reason:'No viable route reaches a battlefield edge.'}}
    retreat.exit={...plan.exit};retreat.lastRoute=plan.path.map(p=>({...p}));
    const budget=this.#deps.moveBudget(state,actor);let used=0,last={...actor.pos};
    for(let i=1;i<plan.path.length;i++){
      const from=plan.path[i-1]!,to=plan.path[i]!;
      const stepCost=GridService.pathCost(state,[from,to]);if(used+stepCost>budget)break;
      used+=stepCost;last={...to};
    }
    actor.pos=last;
    if(this.isEdge(actor.pos))return this.escape(state,actor,{moved:used});
    pushFeed(state,{kind:'move',title:`${actor.name} is routing`,story:`${actor.name} breaks away and runs for the battlefield edge. The retreat is not complete; the actor is still on the map and can be chased down.`,math:`Moved ${used.toFixed(1)} m · escape point ${retreat.exit.x},${retreat.exit.y} · loot remains recoverable only if the actor is stopped before escape.`});
    return{ok:true,escaped:false,moved:used,exit:{...retreat.exit}};
  }
}
