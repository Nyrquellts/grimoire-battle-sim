import type { RegistryHub } from '../RegistryHub';
import { ScenarioSchema } from '../ContentPack';

/**
 * Shipped scenarios: named set pieces to fight and roleplay through.
 *
 * These exist for two reasons. They give the simulator something to *start* rather than a blank
 * encounter builder, and they are worked examples of the pack format — every field here is one an
 * authored scenario may use, so copying one and editing it is a complete tutorial.
 *
 * The framing text is written to match the setting: witcher work is contract work, the North is at
 * war, and monsters are ecology rather than set dressing. None of it is a rules source; the
 * mechanics come entirely from the lineup and battlefield the scenario selects.
 */

const SCENARIOS = [
  {
    id: 'roadside-toll',
    name: 'The Roadside Toll',
    summary: 'Four outlaws working a stretch of the Temerian road.',
    briefing:
      'They have picked their ground well: a bend where the cart ruts run deep and the trees crowd the verge. '
      + 'The big one steps out first, axe resting on his shoulder, and explains — reasonably, almost pleasantly — '
      + 'that the road is theirs and the toll is everything you carry. The other three are already spreading wide. '
      + 'They have done this before. They have not done it to a witcher before.',
    situation: 'open',
    lineup: [{ foe: 'bandit', quantity: 4, region: 'Temeria', experience: 'trained', loadout: 'random' }],
    tags: ['human', 'low', 'opening'],
    source: { status: 'project', origin: 'Project scenario' }
  },
  {
    id: 'drowners-at-the-ford',
    name: 'Drowners at the Ford',
    summary: 'Necrophages in the shallows where the river crossing has gone quiet.',
    briefing:
      'The ford has not been used in a month and the reason is lying under two feet of water, waiting. '
      + 'Drowners hunt by vibration; every step into the shallows rings like a bell. The wet ground will slow you '
      + 'as much as it slows them, and there are more eyes above the waterline than you counted from the bank.',
    situation: 'ravine',
    lineup: [{ foe: 'drowner', quantity: 5, region: 'Velen / No Man’s Land', experience: 'random', loadout: 'random' }],
    tags: ['necrophage', 'contract'],
    source: { status: 'project', origin: 'Project scenario' }
  },
  {
    id: 'noonwraith-in-the-wheat',
    name: 'The Noonwraith in the Wheat',
    summary: 'A specter bound to the field where she died. Yrden work.',
    briefing:
      'The villagers stopped harvesting this field three summers ago and will not say why beyond a name. '
      + 'She comes at the hottest part of the day, when the air over the wheat bends and doubles, and she is '
      + 'incorporeal until something makes her otherwise. You know what makes her otherwise. Draw the circle '
      + 'before she is on you, not after.',
    situation: 'open',
    lineup: [{ foe: 'noonwraith', quantity: 1, region: 'Temeria', experience: 'veteran', loadout: 'random' }],
    tags: ['specter', 'yrden', 'signature'],
    source: { status: 'project', origin: 'Project scenario' }
  },
  {
    id: 'nekker-warren',
    name: 'Nekker Warren',
    summary: 'A swarm that fights well only while it outnumbers you.',
    briefing:
      'Nekkers are cowards individually and a serious problem collectively, and they know the difference better '
      + 'than most humans do. They will mob, they will bite at the legs, and the moment the count turns they will '
      + 'break for the mounds. Aard is worth more here than a clean cut — a knocked-down nekker is a nekker that '
      + 'is not flanking you.',
    situation: 'ruins',
    lineup: [{ foe: 'nekker', quantity: 7, region: 'Velen / No Man’s Land', experience: 'random', loadout: 'random' }],
    tags: ['ogroid', 'swarm', 'aard'],
    source: { status: 'project', origin: 'Project scenario' }
  },
  {
    id: 'the-thing-in-the-crypt',
    name: 'The Thing in the Crypt',
    summary: 'A katakan that has been feeding on this village for a season.',
    briefing:
      'It is fast enough that you will not see the first pass, strong enough that you cannot afford the second, '
      + 'and clever enough to have chosen a place with no clean lines. Silver, oil, and everything you are willing '
      + 'to pour into a Sign. If it goes invisible, it is repositioning, and it is not going for your sword arm.',
    situation: 'ruins',
    lineup: [{ foe: 'katakan', quantity: 1, region: 'Redania', experience: 'elite', loadout: 'random' }],
    tags: ['vampire', 'silver', 'hard'],
    source: { status: 'project', origin: 'Project scenario' }
  },
  {
    id: 'hunters-in-novigrad',
    name: 'Hunters in the Narrow Street',
    summary: 'Witch hunters who have decided a mutant counts.',
    briefing:
      'The Eternal Fire does not draw a careful line between a mage and anything else touched by chaos, and four '
      + 'of them have decided that a medallion is close enough to a confession. The street is narrow, which cuts '
      + 'both ways. They expect you to run. Killing them in a Novigrad alley solves this evening and no other.',
    situation: 'backAlley',
    lineup: [{ foe: 'witchhunter', quantity: 4, region: 'Novigrad & Pontar', experience: 'veteran', loadout: 'random' }],
    tags: ['human', 'urban', 'moral'],
    source: { status: 'project', origin: 'Project scenario' }
  },
  {
    id: 'griffin-above-the-crags',
    name: 'Griffin Above the Crags',
    summary: 'A mated griffin defending a nest. The classic contract.',
    briefing:
      'Its mate was killed by a hunting party six weeks ago and it has been taking livestock and the occasional '
      + 'herdsman ever since. That is not malice; that is a griffin doing exactly what a griffin does. It will '
      + 'open from the air, and it will keep opening from the air until you make the sky an unpleasant place to be.',
    situation: 'woods',
    lineup: [{ foe: 'griffin', quantity: 1, region: 'Velen / No Man’s Land', experience: 'veteran', loadout: 'random' }],
    tags: ['hybrid', 'contract', 'classic'],
    source: { status: 'project', origin: 'Project scenario' }
  },
  {
    id: 'the-mage-and-her-guard',
    name: 'The Mage and Her Guard',
    summary: 'A sorceress with hired steel between you and her.',
    briefing:
      'She has no intention of trading blows and every intention of making the ground between you unusable. '
      + 'The soldiers are there to buy her the six seconds a spell needs. Close the distance or make her spend '
      + 'Vigor she cannot afford — a mage who overdraws pays in blood the same as anyone.',
    situation: 'ruins',
    lineup: [
      { foe: 'mage', quantity: 1, region: 'Redania', experience: 'elite', loadout: 'random' },
      { foe: 'soldier', quantity: 3, region: 'Redania', experience: 'veteran', loadout: 'random' }
    ],
    tags: ['human', 'magic', 'mixed'],
    source: { status: 'project', origin: 'Project scenario' }
  },
  {
    id: 'wyvern-on-the-pass',
    name: 'Wyvern on the Pass',
    summary: 'A draconid that has claimed the mountain road.',
    briefing:
      'Not a dragon, whatever the merchants shouting in the valley believe, and it will not be reasoned with '
      + 'either way. It hunts the pass because the pass funnels prey. So does everything else about this ground: '
      + 'there is no wide field to retreat into, only the road, the drop, and the rock.',
    situation: 'ravine',
    lineup: [{ foe: 'wyvern', quantity: 1, region: 'Kaedwen', experience: 'veteran', loadout: 'random' }],
    tags: ['draconid', 'contract'],
    source: { status: 'project', origin: 'Project scenario' }
  },
  {
    id: 'night-road-ambush',
    name: 'Night Road Ambush',
    summary: 'Barghests on a road nobody sane travels after dark.',
    briefing:
      'The fog came up too fast to be weather, and the shapes moving in it are not dogs. Barghests hunt in '
      + 'packs and materialise where the dark is thickest, which on this road is everywhere. Visibility is '
      + 'against you. So is the count.',
    situation: 'night',
    lineup: [{ foe: 'barghest', quantity: 5, region: 'Velen / No Man’s Land', experience: 'random', loadout: 'random' }],
    tags: ['specter', 'night', 'swarm'],
    source: { status: 'project', origin: 'Project scenario' }
  }
];

/** Registers the shipped scenarios, validating each through the same schema authored packs use. */
export function registerScenarioContent(registry: RegistryHub): void {
  for (const raw of SCENARIOS) {
    const scenario = ScenarioSchema.parse(raw);
    if (!registry.scenarios.has(scenario.id)) registry.add('scenarios', scenario.id, scenario);
  }
}
