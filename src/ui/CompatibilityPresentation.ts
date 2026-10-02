// @ts-nocheck
import * as Kernel from '../services/SimulationRuntime';
import { PresentationShell } from './Shell';
import { renderRegistryViews } from './panels/RegistryPanel';
import { paintTile } from './panels/BattlefieldView';
import { parseCommand } from './CommandParser';
import { DomBindings } from './DomBindings';
import { AppController as ActionController } from './AppController';
import { WebRenderer } from '../adapters/WebRenderer';
import { runSelfCheck, runSelfChecks, selfCheckCount, type SelfCheck } from '../testing/SelfChecks';
import { RegistrySchemas } from '../data/RegistryHub';
import { handleSignChoice, renderSignPalette, selectedAugments } from './panels/SignPanel';
import { attackRequest, handleAttackChoice, renderAttackPalette } from './panels/AttackPanel';
const { AI, AIProfileService, ActionDispatcher, ActorStateService, AnatomyService, CharacterRegistryService, CombatFlow, ConditionService, Core, CriticalService, DamageService, DeathStateTacticsService, DefeatService, DialogueService, Dice, DirtyTileService, DragonHoardService, EncounterCatalog, EncounterFactory, EncounterRegionService, EquipmentStateService, EscapeService, EventPipeline, GrammarService, GridService, HarvestService, Heroes, KnowledgeService, LootService, MoraleService, Pipeline, PronounSets, ReactionAssessmentService, ReactionService, Registry, Rules, SituationService, Store, TesterService, ZoneService, baseActor, clone, createPlayer, defaultState, findActor, human, invariant, isActiveOnMap, isHostile, isOccupied, pick, requestPresentationEffect, resolveMagicTraps, validCombat, validateActionResource } = Kernel;
const RulesController = new ActionController(ActionDispatcher);
/** The actor this UI drives. Presentation must not assume which character that is. */
const playerId = () => Store.read().player.id;
let RendererAdapter: WebRenderer | null = null;

// ============================================================================
// PRESENTATION — reads Store state; gameplay changes go through actions/flow.
// ============================================================================

// Browser-only effects live below the presentation boundary. They never consume
// simulation RNG, so enabling/disabling audio cannot change combat outcomes.

const Dom = DomBindings;

const ToastView = Object.freeze({
  show(text, kind = '') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = text;
    Dom.id('toastLayer').appendChild(node);
    setTimeout(() => node.remove(), 3400);
  }
});

Pipeline.on('action:blocked', context => ToastView.show(context.reason, 'bad'), -1000);
Pipeline.on('action:error', context => ToastView.show(`${context.actionName} failed and was rolled back: ${context.error.message}`, 'bad'), -1000);

const HudView = Object.freeze({
  renderVitals(state) {
    const player = state.player;
    const rows = [
      ['hp', 'Health', player.hp, player.maxHp],
      ['sta', 'Stamina', player.sta, player.maxSta],
      ['tox', 'Toxicity', player.toxicity, player.maxToxicity],
      ['quen', 'Quen', player.activeShield ? `${player.activeShield.hp} HP` : player.quenBlocks, player.activeShield ? player.activeShield.maxHp : Math.max(1, player.quenBlocks || 1)]
    ];

    Dom.id('topVitals').innerHTML = rows.map(([className, name, value, max]) => `
      <div class="vital ${className}">
        <div class="vital-head"><span>${name}</span><b>${value} / ${max}</b></div>
        <div class="meter"><i style="width:${Math.max(0, Math.min(100, Number(value) / Number(max) * 100 || 0))}%"></i></div>
      </div>`).join('');
  },

  renderResources(state) {
    const values = [
      ['Movement', `${state.turn.movement.toFixed?.(1) ?? state.turn.movement} m`],
      ['Action', state.turn.action ? 'Ready' : !state.turn.extraAttackUsed && state.player.sta >= 1 ? 'Extra attack available' : 'Spent'],
      ['Extra attack', state.turn.extraAttackUsed ? 'Used' : state.player.sta>=1 ? '1 STA · -3' : 'No STA'],
      ['Defenses', `${state.turn.defensesUsed} used`]
    ];
    Dom.id('resourceStrip').innerHTML = values.map(([label, value]) => `<div class="resource"><small>${label}</small><b>${value}</b></div>`).join('');
  },

  renderHeader(state) {
    document.body.classList.toggle('combat-live', state.phase === 'combat');
    document.body.classList.toggle('combat-ended', state.phase === 'ended');
    Dom.id('engineStatus').textContent = state.phase === 'combat' ? 'Combat' : state.phase === 'ended' ? (state.winner === 'player' ? 'Victory' : 'Defeat') : 'Setup';
    Dom.id('battleTitle').textContent = state.phase === 'combat'
      ? `${Registry.battlefieldPresets.get(state.situation)?.name || 'Battlefield'} · ${state.ui.pendingSurrender ? 'Surrender decision' : state.turn.side === 'player' ? 'Your turn' : 'Enemy turn'}`
      : state.phase === 'ended' ? 'Battle Ended' : 'Map Setup';
    Dom.id('roundPill').textContent = state.round ? `Round ${state.round}` : 'Round —';
    Dom.one('[data-action="audio"]').textContent = Shell.audioEnabled ? 'SFX On' : 'SFX Off';
    Dom.one('[data-action="debug"]').textContent = state.ui.aiDebug ? 'AI Debug On' : 'AI Debug Off';
  },

  syncControls(state) {
    const playerTurn = state.phase === 'combat' && state.turn.side === 'player' && !state.ui.pendingSurrender;
    const end = Dom.one('[data-action="endTurn"]');
    const recover = Dom.one('[data-action="recover"]');
    const command = Dom.id('commandInput');
    if (end) end.disabled = !playerTurn;
    if (recover) recover.disabled = !playerTurn;
    if (command) command.disabled = state.phase === 'combat' && !playerTurn;
  }
});
const DirtyTileTracker = new DirtyTileService();


const TacticalMapView = (() => {
  let nodes=[];
  const zoneClasses=Object.freeze([...Registry.zones.values()].map(zone=>zone.cssClass));
  const terrainRows=new Map([...Registry.terrain.entries()].map(([id,row])=>[id,row]));

  function initGrid(container=Dom.id('battleGrid')){
    container.replaceChildren();nodes=[];DirtyTileTracker.reset();
    // The grid is configurable, so its shape is published to CSS rather than duplicated there.
    container.style.setProperty('--grid-w',String(GridService.W));
    container.style.setProperty('--grid-h',String(GridService.H));
    const fragment=document.createDocumentFragment();
    for(let index=0;index<GridService.SIZE;index++){
      const {x,y}=GridService.pos(index),button=document.createElement('button');
      button.className='tile h0';button.dataset.tileIndex=String(index);button.type='button';
      const height=document.createElement('span');height.className='height-mark';height.hidden=true;
      const zone=document.createElement('span');zone.className='zone-glyph';zone.hidden=true;
      const stack=document.createElement('span');stack.className='zone-stack';stack.hidden=true;
      const token=document.createElement('span');token.className='token';token.hidden=true;
      const ground=document.createElement('span');ground.className='terrain-glyph';ground.hidden=true;
      button.append(height,ground,zone,stack,token);button._tileRefs={height,ground,zone,stack,token,x,y};
      nodes.push(button);fragment.appendChild(button);
    }
    container.appendChild(fragment);
  }

  function render(state){
    const grid=Dom.id('battleGrid');if(nodes.length!==GridService.SIZE||nodes[0]?.parentNode!==grid)initGrid(grid);
    const dirty=DirtyTileTracker.collect(state);if(!dirty.size)return;
    const reachable=state.phase==='combat'&&state.turn.side==='player'?GridService.reachable(state,state.player,state.turn.movement):null;
    const routeIndices=new Set((state.ui.route||[]).map(point=>GridService.index(point.x,point.y)));
    const actorAt=new Map();
    if(isActiveOnMap(state.player))actorAt.set(GridService.index(state.player.pos.x,state.player.pos.y),state.player);
    for(const enemy of state.enemies)if(isActiveOnMap(enemy))actorAt.set(GridService.index(enemy.pos.x,enemy.pos.y),enemy);

    // Only dirty indices touch DOM; every persistent node stays mounted.
    for(const index of dirty){
      const tileEl=nodes[index],tile=state.map.tiles[index],{x,y}=tileEl._tileRefs;
      paintTile(tileEl,{
        state,tile,index,
        terrain:terrainRows,zoneClasses,zoneMeta:ZoneService.tileMeta(state,x,y),
        actor:actorAt.get(index),
        reachable:!!reachable?.has(index),
        onRoute:routeIndices.has(index),
        version:DirtyTileTracker.version(index),
        isRouting:(actor)=>EscapeService.isRouting(actor)
      });
    }
  }
  return Object.freeze({initGrid,render,nodeCount:()=>nodes.length,dirtyVersion:index=>DirtyTileTracker.version(index)});
})();

const RosterView = (() => {
  let container=null;
  const cards=new Map();
  function init(node=Dom.id('enemyRoster')){container=node;container.replaceChildren();cards.clear()}
  function createCard(enemy){
    const card=document.createElement('button');card.type='button';card.className='enemy-card';card.dataset.enemy=enemy.id;
    const name=document.createElement('h4'),meta=document.createElement('small'),bar=document.createElement('div'),fill=document.createElement('i'),vitals=document.createElement('small'),debug=document.createElement('div');
    bar.className='bar';bar.appendChild(fill);debug.className='debug-list';debug.hidden=true;card.append(name,meta,bar,vitals,debug);card._refs={name,meta,fill,vitals,debug};return card;
  }
  function debugText(enemy){
    const lines=[`${enemy.ai.debugProfile||AIProfileService.profile(enemy).name} · ${enemy.ai.debugCognition||AIProfileService.cognition(enemy).name}`];
    if(enemy.ai.plan?.label)lines.push(`Plan: ${enemy.ai.plan.label}`);
    for(const entry of enemy.ai.scores||[]){lines.push(`${entry.name}: ${entry.score}`);if(entry.breakdown?.length)lines.push(`  ${entry.breakdown.map(row=>`${row.label} ${row.value>=0?'+':''}${row.value}`).join(' · ')}`)}
    for(const entry of enemy.ai.rejections||[])lines.push(`${entry.name} rejected — ${entry.reason}`);
    return lines.join('\n');
  }
  function render(state){
    if(!container||container!==Dom.id('enemyRoster'))init();
    const liveIds=new Set(state.enemies.map(enemy=>enemy.id));
    for(const [id,node] of cards)if(!liveIds.has(id)){node.remove();cards.delete(id)}
    const hostiles=state.enemies.filter(isHostile),routing=hostiles.filter(enemy=>EscapeService.isRouting(enemy)).length;
    Dom.id('hostileCount').textContent=`${hostiles.length} hostile${routing?` · ${routing} routing`:''}`;
    for(const enemy of state.enemies){
      let card=cards.get(enemy.id);if(!card){card=createCard(enemy);cards.set(enemy.id,card)}
      const {name,meta,fill,vitals,debug}=card._refs;card.dataset.enemy=enemy.id;
      card.classList.toggle('selected',state.selectedEnemyId===enemy.id);card.classList.toggle('dead',!!enemy.dead);
      name.textContent=enemy.name;
      meta.textContent=`${enemy.family} · ${enemy.gender}${enemy.age?` · age ${enemy.age}`:enemy.ageBand?` · ${enemy.ageBand}`:''} · ${enemy.death?.active?`DEATH STATE${enemy.death?.tactics?.choice?` · ${enemy.death.tactics.choice.toUpperCase()}`:''}`:enemy.morale.state}`;
      fill.style.width=`${Math.max(0,enemy.hp/enemy.maxHp*100)}%`;
      vitals.textContent=`${Math.max(0,enemy.hp)}/${enemy.maxHp} HP · ${Math.max(0,enemy.sta)}/${enemy.maxSta} STA${enemy.statuses.surrendered?' · surrendered':''}${EscapeService.isRouting(enemy)?' · ROUTING':''}${enemy.fled?' · escaped':''}`;
      const showDebug=!!(state.ui.aiDebug&&(enemy.ai?.scores?.length||enemy.ai?.rejections?.length));debug.hidden=!showDebug;if(showDebug)debug.textContent=debugText(enemy);
      container.appendChild(card);
    }
  }
  return Object.freeze({init,render,nodeCount:()=>cards.size});
})();

const TargetView = Object.freeze({
  render(state) {
    const enemy = findActor(state, state.selectedEnemyId);
    const name = Dom.id('targetName');
    const box = Dom.id('targetDossier');

    if (!enemy) {
      name.textContent = 'No target';
      box.innerHTML = '<div class="muted">Click an enemy token or roster entry.</div>';
      return;
    }

    name.textContent = enemy.name;
    const distance = GridService.distance(state.player.pos, enemy.pos);
    const los = GridService.los(state, state.player.pos, enemy.pos);
    const details = [
      ['Gender', enemy.gender], ['Age', enemy.age ?? enemy.ageBand ?? '—'], ['HP', `${Math.max(0, enemy.hp)}/${enemy.maxHp}`],
      ['STA', `${Math.max(0, enemy.sta)}/${enemy.maxSta}`], ['Armor', enemy.armorByLocation ? 'locational' : `${enemy.armor} SP`],
      ['Region', EncounterRegionService.label(enemy.encounterRegion||enemy.identity?.region||'random')], ...(enemy.identity?.region&&enemy.encounterRegion&&enemy.identity.region!==EncounterRegionService.nameRegion(enemy.encounterRegion)?[['Origin',enemy.identity.region]]:[]),
      ['Range', `${distance.toFixed(1)} m`], ['LOS', los.clear ? 'Clear' : 'Blocked'], ['Morale', enemy.morale.state], ...(enemy.death?.active?[['Life','DEATH STATE — still targetable'],['Response',enemy.death?.tactics?.choice?enemy.death.tactics.choice.toUpperCase():'not chosen yet']]:[]), ...(enemy.statuses?.unconscious?[['Life','UNCONSCIOUS — vulnerable']]:[]), ...(EscapeService.isRouting(enemy)?[['Intent','ROUTING — chaseable'],['Escape edge',enemy.retreat?.exit?`${enemy.retreat.exit.x},${enemy.retreat.exit.y}`:'seeking route']]:[]), ...(enemy.breath?[['Breath', `${enemy.breath.name}${enemy.breath.cooldownRemaining?` · ${enemy.breath.cooldownRemaining}r`:''}`]]:[]), ...(enemy.identity?.tribe?[['Tribe',enemy.identity.tribe]]:[])
    ];

    box.innerHTML = `
      <div class="details-grid">${details.map(([label, value]) => `<div class="mini"><small>${label}</small><b>${esc(value)}</b></div>`).join('')}</div>
      <div class="body-grid" style="margin-top:8px">${bodyParts(enemy).map(part => bodyPartHtml(enemy, part)).join('')}</div>
      ${state.ui.showLife ? `<div class="life-box"><b>Life profile${enemy.variant ? ` · ${esc(enemy.variant)}` : ''}${enemy.variance ? ` · ${esc(enemy.variance)}` : ''}</b>${enemy.identity?.trueName?`<p><b>True name:</b> ${esc(enemy.identity.trueName)} · <b>Tribe:</b> ${esc(enemy.identity.tribe)}</p>`:''}${enemy.identity?.lairRegion?`<p><b>Lair:</b> ${esc(enemy.identity.lairRegion)} · <b>Breath:</b> ${esc(enemy.breath?.name||'Dragon fire')}</p>`:''}<p>${enemy.history.map(esc).join(' ')}</p>${enemy.identity?.specialAbility ? `<p><b>Special ability:</b> ${esc(enemy.identity.specialAbility)}</p>` : ''}</div>` : ''}`;
  }
});

const FeedView = Object.freeze({
  render(state) {
    Dom.id('combatFeed').innerHTML = state.feed.length
      ? state.feed.map(entry => `<article class="feed-entry ${entry.kind || ''}"><div class="meta">Round ${entry.round} · ${esc(entry.title || 'Event')}</div><p>${esc(entry.story || '')}</p>${entry.math ? `<div class="math">${esc(entry.math)}</div>` : ''}</article>`).join('')
      : '<div class="muted">No actions resolved yet.</div>';

    Dom.id('playerBody').innerHTML = bodyParts(state.player).map(part => bodyPartHtml(state.player, part)).join('');
    Dom.id('playerCondition').textContent = Object.keys(state.player.statuses).filter(key => state.player.statuses[key]).join(', ') || 'Clear';
  }
});

const ReactionView=Object.freeze({
  render(state){
    const box=Dom.id('reactionBox'),r=state.ui.reaction;if(!box)return;
    if(!r||state.round-r.round>1){box.hidden=true;box.innerHTML='';return}
    box.hidden=false;box.className=`reaction-box severity-${r.severity||'minor'} ${r.kind==='critical'?'critical':''}`;
    box.innerHTML=`<div class="reaction-name">${esc(r.name)}${r.location?` · ${esc(r.location)}`:''}</div><div class="reaction-text">${esc(r.text)}</div><div class="reaction-meta">${esc(r.context||'combat reaction')}</div>`
  }
});

const ModalView = Object.freeze({
  sync(state){const layer=Dom.id('modalLayer'),current=layer.firstElementChild?.dataset?.modalKind||'';if(state.ui.pendingSurrender){const key=`surrender:${state.ui.pendingSurrender}`;if(current!==key)this.surrender(state.ui.pendingSurrender);return}if(state.ui.pendingDefeat){if(current!=='defeat')this.defeat(state);return}if(state.ui.pendingTester){if(current!=='tester')this.tester();return}if(state.ui.pendingLoot){this.loot(state);return}if(state.ui.pendingVictory){if(current!=='victory')this.victory();return}if(current)layer.innerHTML=''},
  surrender(id){const state=Store.read(),enemy=findActor(state,id);if(!enemy||state.ui.pendingSurrender!==id)return;Dom.id('modalLayer').innerHTML=`<div class="modal-backdrop" data-modal-kind="surrender:${id}"><div class="modal"><div class="eyebrow">Surrender · combat paused</div><h2>${esc(enemy.name)} is yielding</h2><p>${esc(enemy.name)} has stopped pressing the attack and is waiting for ${esc(state.player.name)}’s decision.</p><div class="button-row"><button class="btn good" data-action="acceptSurrender" data-target="${id}">Accept surrender</button><button class="btn danger" data-action="refuseSurrender" data-target="${id}">Refuse surrender</button></div></div></div>`},
  victory(){const state=Store.read(),escaped=state.enemies.filter(enemy=>enemy.fled).length,dead=state.enemies.filter(enemy=>enemy.dead).length,surrendered=state.enemies.filter(enemy=>enemy.statuses.surrendered).length;Dom.id('modalLayer').innerHTML=`<div class="modal-backdrop" data-modal-kind="victory"><div class="modal"><div class="eyebrow">Victory</div><h2>The battlefield is ${esc(state.player.name)}’s</h2><p>No hostile opponent remains able or willing to continue. ${dead} dead · ${surrendered} surrendered · ${escaped} escaped.</p>${escaped?`<div class="outcome-card"><strong>${escaped} opponent${escaped===1?'':'s'} got away</strong>Anything they still carried left the map with them. Kill or stop a routing enemy before the edge if you want that actor's loot.</div>`:''}<div class="button-row"><button class="btn primary" data-action="collectLoot">Search battlefield</button><button class="btn" data-action="closeModal">Leave it</button></div></div></div>`},
  defeat(state){const d=state.aftermath.defeat||DefeatService.build(state);requestPresentationEffect('defeat',1);Dom.id('modalLayer').innerHTML=`<div class="modal-backdrop" data-modal-kind="defeat"><div class="modal defeat"><div class="eyebrow">Game over · ${esc(d.profile)} · ${esc(d.outcome)}</div><div class="game-over-shout">${esc(d.headline||'YOU DIED')}</div><div class="death-cause">${esc(d.causeLine||d.lastBlow)}</div><div class="outcome-card"><strong>${esc(d.victor)} wins</strong>${esc(d.story)}</div><div class="death-detail-grid"><div class="death-detail"><small>Last resolved harm</small><b>${esc(d.lastBlow)}</b></div><div class="death-detail"><small>Body state</small><b>${esc(d.condition)}</b></div></div><p>${esc(d.visual)}</p><div class="button-row"><button class="btn danger" data-action="reset">New battle</button><button class="btn good" data-action="testerFullRestore">Full restore & inspect</button><button class="btn" data-action="closeModal">Look at the field</button></div></div></div>`},
  tester(){Dom.id('modalLayer').innerHTML=`<div class="modal-backdrop" data-modal-kind="tester"><div class="modal"><div class="eyebrow">Bug tester utilities</div><h2>Restore without rebuilding the encounter</h2><div class="tester-grid"><button class="tester-action" data-action="testerHeal"><b>Full heal</b><small>HP, STA, toxicity, conditions, critical wounds, and death state.</small></button><button class="tester-action" data-action="testerRepair"><b>Repair armor</b><small>Restore every configured armor location to maximum SP.</small></button><button class="tester-action" data-action="testerRestock"><b>Restock supplies</b><small>Bolts, loaded crossbow, bombs, potions, decoctions, and oils.</small></button><button class="tester-action" data-action="testerFullRestore"><b>Full restore</b><small>Heal + repair + restock + clear lingering map zones.</small></button></div><div class="tester-note">These are simulator/debug controls, not combat actions. They do not spend Action, STA, or movement.</div><div class="button-row" style="margin-top:10px"><button class="btn" data-action="closeTester">Close</button></div></div></div>`},
  loot(state){
    const b=state.aftermath.loot||{currency:{crowns:0},equipment:[],ammunition:[],personal:[],harvest:[],valuables:[],documents:[],hoards:[],carcasses:[]};
    const list=(rows,format=x=>typeof x==='string'?x:x.name)=>rows.length?`<ul class="loot-list">${rows.map(x=>`<li>${esc(format(x))}</li>`).join('')}</ul>`:'<div class="muted">None</div>';
    const carcasses=(b.carcasses||[]).map(id=>findActor(state,id)).filter(Boolean),tool=HarvestService.toolFor(state.player);
    const carve=carcasses.length?`<div class="loot-block" style="grid-column:1/-1"><h3>Source-backed monster harvest</h3><div class="compact-choice-grid">${carcasses.map(e=>{const table=HarvestService.tableFor(e),count=(table?.parts||[]).filter(p=>(p.channel||'harvest')==='harvest').length;return`<button class="choice" data-action="harvestMonster" data-target="${e.id}"><b>${esc(e.name)}</b><small>${esc(EncounterRegionService.label(e.encounterRegion||'random'))} · ${count} listed component type${count===1?'':'s'} · ${esc(tool?.name||'field knife')}</small></button>`}).join('')}</div><small class="muted">Only loot actually listed for that creature in the source material appears here. Listed quantity dice are rolled when harvested; creatures without a source loot pool do not invent generic parts.</small></div>`:'';
    Dom.id('modalLayer').innerHTML=`<div class="modal-backdrop" data-modal-kind="loot"><div class="modal loot"><div class="eyebrow">Aftermath · recovered loot</div><h2>What the fight left behind</h2><div class="loot-total">${b.currency.crowns||0} crowns</div><div class="loot-columns"><div class="loot-block"><h3>Equipment</h3>${list(b.equipment,x=>`${x.name} — ${x.condition}${x.sp?` · SP ${x.sp}`:''}`)}</div><div class="loot-block"><h3>Ammunition</h3>${list(b.ammunition,x=>`${x.count} × ${x.name}`)}</div><div class="loot-block"><h3>Harvested monster components</h3>${list(b.harvest,x=>`${x.count} × ${x.name}`)}</div><div class="loot-block"><h3>Valuables / hoards</h3>${list([...(b.valuables||[]),...(b.hoards||[]).map(h=>`${h.theme} · approx. ${h.value} crowns · ${h.lair}`)])}</div><div class="loot-block"><h3>Personal effects</h3>${list(b.personal)}</div><div class="loot-block"><h3>Documents & clues</h3>${list(b.documents)}</div>${carve}</div><div class="button-row"><button class="btn primary" data-action="closeModal">Done</button></div></div></div>`
  },
  close(){Dom.id('modalLayer').innerHTML='';Store.update(d=>{d.ui.pendingVictory=false;d.ui.pendingDefeat=false;d.ui.pendingLoot=false;d.ui.pendingSurrender=null;d.ui.pendingTester=false})}
});
const ActionPaletteView = Object.freeze({
  render(s){
    const box=Dom.id('actionPalette'),t=findActor(s,s.selectedEnemyId),canAct=s.phase==='combat'&&s.turn.side==='player'&&!s.ui.pendingSurrender,ui=s.ui;
    const lock=!canAct?`<div class="turn-lock ${s.ui.pendingSurrender?'surrender':'enemy'}">${s.ui.pendingSurrender?'Surrender decision pending.':s.phase==='combat'?'Enemy turn — combat controls are paused.':'Start a battle to use combat actions.'}</div>`:'';
    if(ui.palette==='attack'){
      box.innerHTML=renderAttackPalette(s,{esc,weapons:Registry.weapons,alchemy:Registry.alchemy.values(),lock,target:t,canAct});
      return;
    }
    if(ui.palette==='signs'){
      box.innerHTML=renderSignPalette(s,{esc,lock,signs:Registry.signs.values(),focusItems:Registry.focusItems.values(),augments:Registry.signAugments});return;
    }
    if(ui.palette==='alchemy'){
      const pots=[...Registry.alchemy.values()].filter(x=>x.kind==='potion'||x.kind==='decoction');
      box.innerHTML=`${lock}<h3>Potions & decoctions</h3><div class="compact-choice-grid">${pots.map(x=>`<button class="choice" data-choice="potion" data-value="${x.id}" title="${esc(x.desc)}"><b>${x.name}</b><small>${x.tox} tox · ${s.player.inventory[x.kind==='potion'?'potions':'decoctions'][x.id]||0} left</small></button>`).join('')}</div>`;return;
    }
    if(ui.palette==='tools'){box.innerHTML=`${lock}<h3>Fight tools</h3><div class="compact-choice-grid">${[['aim','Aim'],['activeDodge','Active dodge'],['stand','Stand'],['stabilize','Stabilize'],['feint','Feint'],['charge','Charge'],['trip','Trip'],['disarm','Disarm'],['shieldAttack','Shield attack']].map(([v,l])=>`<button class="choice" data-choice="tool" data-value="${v}"><b>${l}</b></button>`).join('')}</div>`;return}
    if(ui.palette==='social'){box.innerHTML=`${lock}<h3>Fear, morale & surrender</h3>${t?`<div class="muted">${esc(t.name)} · ${t.morale.state} · pressure ${t.morale.pressure} · Courage ${t.morale.courage}</div><div class="button-row" style="margin-top:6px"><button class="btn" data-choice="social" data-value="intimidate">Intimidate</button><button class="btn" data-choice="social" data-value="demand">Demand surrender</button></div>`:'<div class="muted">Select an opponent.</div>'}`;return}
    if(ui.palette==='move')box.innerHTML=`${lock}<h3>Movement</h3><div class="muted">Click a green node. A* follows the legal route and stops at the movement limit.</div>`;
  }
});
const EncounterBuilderView = Object.freeze({
  render(state){
    const setup=state.setup||defaultState().setup,category=EncounterCatalog.category(setup.category),foes=EncounterCatalog.foes(category.id);
    const validFoe=foes.includes(setup.foe)?setup.foe:foes[0],variants=EncounterCatalog.variants(validFoe),validVariant=variants.some(([id])=>id===setup.variant)?setup.variant:variants[0]?.[0]||'source';
    const regions=EncounterRegionService.options(validFoe),validRegion=regions.some(r=>r.id===setup.region)?setup.region:'random';
    const subtypes=EncounterCatalog.subtypes(validFoe),validSubtype=subtypes.some(([id])=>id===setup.subtype)?setup.subtype:'random',experiences=EncounterCatalog.experienceOptions(validFoe),validExperience=experiences.some(([id])=>id===setup.experience)?setup.experience:experiences[0]?.[0]||'source',loadouts=EncounterCatalog.loadouts(validFoe),validLoadout=loadouts.some(([id])=>id===setup.loadout)?setup.loadout:loadouts[0]?.[0]||'source';
    const categorySelect=Dom.id('enemyCategory'),foeSelect=Dom.id('enemyFoe'),regionSelect=Dom.id('enemyRegion'),subtypeSelect=Dom.id('enemySubtype'),variantSelect=Dom.id('enemyVariant'),experienceSelect=Dom.id('enemyExperience'),loadoutSelect=Dom.id('enemyLoadout'),qty=Dom.id('enemyQuantity'),subtypeField=Dom.id('subtypeField'),experienceField=Dom.id('experienceField'),loadoutField=Dom.id('loadoutField');
    const summary=Dom.id('encounterSummary');if(summary){const line=(setup.lineup||[]).length?setup.lineup.map(row=>`${EncounterCatalog.name(row.foe)} ×${row.quantity||1}`).join(' + '):`${EncounterCatalog.name(validFoe)} ×${setup.quantity||1}`;summary.textContent=state.phase==='combat'?`${line} · ${EncounterRegionService.label(validRegion)} · Standard rules`:'';}
    categorySelect.innerHTML=EncounterCatalog.categories.filter(c=>EncounterCatalog.foes(c.id).length).map(c=>`<option value="${c.id}">${esc(c.label)}</option>`).join('');categorySelect.value=category.id;
    foeSelect.innerHTML=foes.map(id=>`<option value="${id}">${esc(EncounterCatalog.name(id))}</option>`).join('');foeSelect.value=validFoe;
    regionSelect.innerHTML=regions.map(r=>`<option value="${r.id}">${esc(r.label)}</option>`).join('');regionSelect.value=validRegion;
    subtypeSelect.innerHTML=subtypes.map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');subtypeSelect.value=validSubtype;
    subtypeField.hidden=validFoe!=='truedragon';
    variantSelect.innerHTML=variants.map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');variantSelect.value=validVariant;experienceSelect.innerHTML=experiences.map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');experienceSelect.value=validExperience;loadoutSelect.innerHTML=loadouts.map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');loadoutSelect.value=validLoadout;experienceField.hidden=!EncounterCatalog.allowsExperience(validFoe);loadoutField.hidden=!EncounterCatalog.allowsLoadout(validFoe);qty.value=String(setup.quantity||1);
    Dom.id('situation').value=state.situation;
    const locked=state.phase==='combat';for(const control of [categorySelect,foeSelect,regionSelect,subtypeSelect,variantSelect,experienceSelect,loadoutSelect,qty,Dom.id('situation')])control.disabled=locked;
    const addButton=document.querySelector('[data-action="addFoe"]'),startButton=document.querySelector('[data-action="start"]');if(addButton)addButton.disabled=locked;if(startButton)startButton.disabled=locked;
    const lineup=setup.lineup||[];
    const details=row=>{
      const bits=[EncounterRegionService.label(row.region||'random')];
      if(row.foe==='truedragon')bits.push(EncounterCatalog.subtypeLabel(row.foe,row.subtype||'random'));
      bits.push(EncounterCatalog.variantLabel(row.foe,row.variant));if(EncounterCatalog.allowsExperience(row.foe))bits.push((EncounterCatalog.experienceOptions(row.foe).find(([id])=>id===(row.experience||'random'))||[])[1]||row.experience);if(EncounterCatalog.allowsLoadout(row.foe))bits.push((EncounterCatalog.loadouts(row.foe).find(([id])=>id===(row.loadout||'random'))||[])[1]||row.loadout);return bits.filter(Boolean).join(' · ');
    };
    Dom.id('encounterLineup').innerHTML=lineup.length?`<span class="lineup-empty">Lineup:</span>${lineup.map((row,index)=>`<span class="lineup-chip"><b>${row.quantity}× ${esc(EncounterCatalog.name(row.foe))}</b><span>${esc(details(row))}</span><button class="btn small" data-action="removeFoe" data-index="${index}" aria-label="Remove">×</button></span>`).join('')}<button class="btn small ghost" data-action="clearLineup">Clear</button><button class="btn small ghost" data-action="randomLineup">Random</button>`:`<span class="lineup-empty">No saved lineup — Start uses the contextual controls above. Subspecies appears only where the creature actually has one.</span><button class="btn small ghost" data-action="randomLineup">Random lineup</button>`;
    const changed=validFoe!==setup.foe||validVariant!==setup.variant||validRegion!==setup.region||validSubtype!==setup.subtype||validExperience!==setup.experience||validLoadout!==setup.loadout;
    if(changed)queueMicrotask(()=>Store.update(d=>{d.setup.foe=validFoe;d.setup.variant=validVariant;d.setup.region=validRegion;d.setup.subtype=validSubtype;d.setup.experience=validExperience;d.setup.loadout=validLoadout;},{silent:false}));
  }
});
/** Views added after the migration began are composed in `Shell.ts`, not here. */
const Shell = new PresentationShell({
  pipeline: Pipeline, registry: Registry, store: Store,
  startEncounter: (options) => CombatFlow.start(options),
  dispatch: (action, payload) => RulesController.dispatch(action, payload),
  byId: (id) => Dom.id(id), query: (selector) => Dom.one(selector), esc, heroes: Heroes
});

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function bodyParts(actor) {
  return actor.family === 'Human'
    ? ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']
    : ['head', 'torso', 'leftLimb', 'rightLimb', 'special'];
}

function bodyPartHtml(actor, part) {
  const label = part.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());
  const sp = actor.armorByLocation ? (actor.armorByLocation[part] ?? actor.armorByLocation.torso ?? 0) : actor.armor || 0;
  const criticals = (actor.criticals || []).filter(injury => injury.location === part);
  const recent = actor.recentHit === part;
  return `<div class="body-part ${recent ? 'recent' : ''} ${criticals.length ? 'critical' : ''}"><b>${label}</b><small>SP ${sp}${criticals.length ? ` · ${criticals.map(injury => injury.name).join(', ')}` : ''}${actor.disabledLocations?.[part] ? ' · unusable' : ''}</small></div>`;
}
const BrowserUiController = Object.freeze({
  init() {
    Store.setNotifyScheduler(callback => (globalThis.requestAnimationFrame ? requestAnimationFrame(callback) : setTimeout(callback, 0)));
    TacticalMapView.initGrid(Dom.id('battleGrid'));
    RosterView.init(Dom.id('enemyRoster'));
    RendererAdapter = new WebRenderer(state => this.renderState(state));
    RendererAdapter.initialize();
    Store.subscribe(state => RendererAdapter?.render(state));
    document.addEventListener('click', event => this.onClick(event));
    document.addEventListener('change', event => this.onChange(event));
    Dom.id('commandInput').addEventListener('keydown', event => { if (event.key === 'Enter') this.command(); });
    renderRegistryViews({ registry: Registry, esc, byId: (id) => Dom.id(id) });
    // Battlefields are content, so the picker is built from the registry rather than hand-listed.
    const situations=Dom.id('situation');
    if(situations)situations.innerHTML=[...Registry.battlefieldPresets.entries()]
      .map(([id,row])=>`<option value="${esc(id)}" title="${esc(row.summary||'')}">${esc(row.name)}</option>`).join('');
    Shell.initialize();
    this.render();
  },

  onClick(event) {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.dataset.view) {
      Dom.all('.view').forEach(view => view.classList.toggle('active', view.id === `view-${button.dataset.view}`));
      Dom.all('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
      Shell.onViewOpened(button.dataset.view);
      return;
    }

    if (button.dataset.palette) {
      Store.update(draft => { draft.ui.palette = button.dataset.palette; });
      return;
    }

    const action = button.dataset.action;
    if (action === 'start') {
      const setup=Store.read().setup,lineup=setup.lineup.length?setup.lineup:[{foe:setup.foe,region:setup.region,subtype:setup.subtype,variant:setup.variant,experience:setup.experience,loadout:setup.loadout,quantity:setup.quantity}];
      CombatFlow.start({ lineup, situation: Dom.id('situation').value });
      return;
    }
    if (action === 'addFoe') { Store.update(d=>{d.setup.lineup.push({foe:d.setup.foe,region:d.setup.region,subtype:d.setup.subtype,variant:d.setup.variant,experience:d.setup.experience,loadout:d.setup.loadout,quantity:d.setup.quantity});}); return; }
    if (action === 'removeFoe') { Store.update(d=>{d.setup.lineup.splice(Number(button.dataset.index),1);}); return; }
    if (action === 'clearLineup') { Store.update(d=>{d.setup.lineup=[];}); return; }
    if (action === 'randomLineup') { Store.update(d=>{const cats=EncounterCatalog.categories.filter(c=>EncounterCatalog.foes(c.id).length),groups=1+Dice.d(3);d.setup.lineup=[];for(let i=0;i<groups;i++){const cat=pick(cats),foe=pick(EncounterCatalog.foes(cat.id)),opts=EncounterCatalog.variants(foe),variant=pick(opts)[0],subtype=foe==='truedragon'?pick(EncounterCatalog.subtypes(foe))[0]:'random';d.setup.lineup.push({foe,region:'random',subtype,variant,experience:EncounterCatalog.allowsExperience(foe)?'random':'source',loadout:EncounterCatalog.allowsLoadout(foe)?'random':'source',quantity:foe==='truedragon'||foe==='highervampire'?1:Dice.d(3)})}}); return; }
    if (action === 'stop') { CombatFlow.stop(); return; }
    if (action === 'undo') { if (!Store.undo()) ToastView.show('Nothing to undo.', 'bad'); return; }
    if (action === 'reset') { CombatFlow.reset(); return; }
    if (action === 'audio') { const on = Shell.toggleAudio(); Store.update(draft => { draft.ui.audio = on; }); return; }
    if (action === 'debug') { Store.update(draft => { draft.ui.aiDebug = !draft.ui.aiDebug; }); return; }
    if (action === 'tester') { Store.update(draft => { draft.ui.pendingTester = true; }); return; }
    if (action === 'testerHeal') { RulesController.dispatch('testerHeal', { actorId: playerId() }); Store.update(d=>{d.ui.pendingTester=false;d.ui.pendingDefeat=false;if(d.phase==='ended'&&d.winner==='enemies'&&d.enemies.some(isHostile)){d.phase='combat';d.winner=null;d.aftermath.defeat=null;d.round=Math.max(1,d.round);Pipeline.emit('turn:begin',{state:d,side:'player'})}}); return; }
    if (action === 'testerRepair') { RulesController.dispatch('testerRepair', { actorId: playerId() }); return; }
    if (action === 'testerRestock') { RulesController.dispatch('testerRestock', { actorId: playerId() }); return; }
    if (action === 'testerFullRestore') { RulesController.dispatch('testerFullRestore', { actorId: playerId() }); Store.update(d=>{d.ui.pendingTester=false;d.ui.pendingDefeat=false;if(d.phase==='ended'&&d.winner==='enemies'&&d.enemies.some(isHostile)){d.phase='combat';d.winner=null;d.aftermath.defeat=null;d.round=Math.max(1,d.round);Pipeline.emit('turn:begin',{state:d,side:'player'})}}); return; }
    if (action === 'closeTester') { Store.update(d=>{d.ui.pendingTester=false}); return; }
    if (action === 'endTurn') { RulesController.dispatch('endTurn', { actorId: playerId() }); return; }
    if (action === 'recover') { RulesController.dispatch('recover', { actorId: playerId() }); return; }
    if (action === 'clearFeed') { Store.update(draft => { draft.feed = []; }); return; }
    if (action === 'lifeToggle') { Store.update(draft => { draft.ui.showLife = !draft.ui.showLife; }); return; }
    if (action === 'command') { this.command(); return; }
    if (action === 'selfTest') { Diagnostics.run(); return; }
    if (action === 'acceptSurrender') { RulesController.dispatch('social', { actorId: playerId(), targetId: button.dataset.target, kind: 'acceptSurrender' }); return; }
    if (action === 'refuseSurrender') { RulesController.dispatch('social', { actorId: playerId(), targetId: button.dataset.target, kind: 'refuseSurrender' }); return; }
    if (action === 'collectLoot') { RulesController.dispatch('collectLoot', { actorId: playerId() }); return; }
    if (action === 'harvestMonster') { RulesController.dispatch('harvestMonster', { actorId: playerId(), targetId: button.dataset.target }); return; }
    if (action === 'closeModal') { ModalView.close(); return; }

    if (button.dataset.enemy) {
      Store.update(draft => { draft.selectedEnemyId = button.dataset.enemy; draft.ui.palette = 'attack'; });
      return;
    }

    if (button.dataset.tileIndex !== undefined) {
      const { x, y } = GridService.pos(Number(button.dataset.tileIndex));
      const state = Store.read();
      const enemy = state.enemies.find(unit => isActiveOnMap(unit) && unit.pos.x === x && unit.pos.y === y);
      if (enemy) Store.update(draft => { draft.selectedEnemyId = enemy.id; draft.ui.palette = 'attack'; });
      else if (state.phase === 'combat' && state.turn.side === 'player') RulesController.dispatch('move', { actorId: playerId(), to: { x, y } });
      return;
    }

    if (Shell.handleClick(button)) return;

    if (button.dataset.choice) this.handleChoice(button);
  },

  onChange(event) {
    const id=event.target.id;
    if (id === 'situation' && Store.read().phase !== 'combat') { Store.update(draft => { draft.situation = event.target.value; }); return; }
    if (Store.read().phase === 'combat') return;
    if (id === 'enemyCategory') { Store.update(d=>{d.setup.category=event.target.value;const foes=EncounterCatalog.foes(d.setup.category);d.setup.foe=foes[0]||'bandit';d.setup.region='random';d.setup.subtype='random';d.setup.variant=EncounterCatalog.variants(d.setup.foe)[0]?.[0]||'source';d.setup.experience=EncounterCatalog.experienceOptions(d.setup.foe)[0]?.[0]||'source';d.setup.loadout=EncounterCatalog.loadouts(d.setup.foe)[0]?.[0]||'source';}); return; }
    if (id === 'enemyFoe') { Store.update(d=>{d.setup.foe=event.target.value;d.setup.region='random';d.setup.subtype='random';d.setup.variant=EncounterCatalog.variants(d.setup.foe)[0]?.[0]||'source';d.setup.experience=EncounterCatalog.experienceOptions(d.setup.foe)[0]?.[0]||'source';d.setup.loadout=EncounterCatalog.loadouts(d.setup.foe)[0]?.[0]||'source';}); return; }
    if (id === 'enemyRegion') { Store.update(d=>{d.setup.region=event.target.value;}); return; }
    if (id === 'enemySubtype') { Store.update(d=>{d.setup.subtype=event.target.value;}); return; }
    if (id === 'enemyVariant') { Store.update(d=>{d.setup.variant=event.target.value;}); return; }
    if (id === 'enemyExperience') { Store.update(d=>{d.setup.experience=event.target.value;}); return; }
    if (id === 'enemyLoadout') { Store.update(d=>{d.setup.loadout=event.target.value;}); return; }
    if (id === 'enemyQuantity') { Store.update(d=>{d.setup.quantity=Math.max(1,Math.min(20,Number(event.target.value)||1));}); }
  },

  handleChoice(button) {
    const kind = button.dataset.choice;
    const state = Store.read();
    const targetId = state.selectedEnemyId;

    // The Attack palette owns its own display state; only its requests reach the table below.
    if (handleAttackChoice(kind, button.dataset.value ?? '', Store)) return;
    // The Signs palette owns its own display state; only its cast request reaches the table below.
    if (handleSignChoice(kind, button.dataset.value ?? '', Store, (action, payload) => RulesController.dispatch(action, payload))) return;

    const attack = attackRequest(kind, state, button.dataset.value, { weapons: Registry.weapons });
    if (attack) { RulesController.dispatch(attack[0], attack[1]); return; }

    const actions = {
      sign: ['sign', { actorId: playerId(), targetId, signId: button.dataset.value, cost: Number(button.dataset.cost || state.ui.signCost), augmentIds: selectedAugments(state) }],
      potion: ['potion', { actorId: playerId(), itemId: button.dataset.value }],
      tool: ['tool', { actorId: playerId(), kind: button.dataset.value }],
      social: ['social', { actorId: playerId(), targetId, kind: button.dataset.value }]
    };

    const request = actions[kind];
    if (request) RulesController.dispatch(request[0], request[1]);
  },

  command() {
    const input = Dom.id('commandInput');
    const text = input.value.trim();
    if (!text) return;

    const command = parseCommand(text, Store.read(), { registry: Registry, playerId });
    if (!command) {
      ToastView.show('Command not recognized. Try: strong silver attack head; cast Igni 3; reload; recover; move 5', 'bad');
      return;
    }

    const result = RulesController.dispatch(command.name, command.payload);
    if (result.ok) input.value = '';
  },

  render() { this.renderState(Store.read()); },

  renderState(state) {
    HudView.renderVitals(state);
    EncounterBuilderView.render(state);
    HudView.renderResources(state);
    HudView.renderHeader(state);
    TacticalMapView.render(state);
    ReactionView.render(state);
    ActionPaletteView.render(state);
    RosterView.render(state);
    TargetView.render(state);
    FeedView.render(state);
    HudView.syncControls(state);
    ModalView.sync(state);
  }
});
// ============================================================================
// DIAGNOSTICS — regression tests at subsystem boundaries.
// ============================================================================

const Diagnostics = (() => {
  // Simulation contracts live in the browser-free kernel module so they also run under `npm test`.
  // Only checks that genuinely inspect the DOM stay here.
  const presentationChecks: SelfCheck[] = [];
  const addUi = (group: string, name: string, test: () => unknown) => { presentationChecks.push({ group, name, test }); };

  addUi('Core', 'No persistence UI controls', () => !document.querySelector('[data-action="save"], [data-action="load"], [data-action="export"], [data-action="import"]'));
  addUi('Performance', 'Persistent tactical grid owns exactly one node per tile', () => TacticalMapView.nodeCount()===GridService.SIZE&&Dom.id('battleGrid').children.length===GridService.SIZE);
  addUi('Performance', 'Roster uses keyed persistent cards', () => typeof RosterView.init==='function'&&typeof RosterView.nodeCount==='function');
  addUi('Actions', 'Strict-only engine has no alternate rules selector', () => !('rulesMode' in defaultState())&&!document.getElementById('rulesMode'));

  function run() {
    const results = [...runSelfChecks(), ...presentationChecks.map(runSelfCheck)];
    const html = results.map(result => `<div class="${result.ok ? 'diag-pass' : 'diag-fail'}">${result.ok ? 'PASS' : 'FAIL'} — <b>${esc(result.group)}</b> · ${esc(result.name)}${result.detail ? ` · ${esc(result.detail)}` : ''}</div>`).join('');
    const passed = results.filter(result => result.ok).length;
    Dom.id('diagReport').innerHTML = html + `<br><b>${passed}/${results.length} passed</b><br><span class="muted">Seeded RNG · validated registries · atomic Store · centralized CombatFlow · descriptor-based AI.</span>`;
    return results;
  }

  return Object.freeze({ run, count: () => selfCheckCount() + presentationChecks.length });
})();

BrowserUiController.init();
if (location.hash === '#selftest') setTimeout(() => Diagnostics.run(), 50);
