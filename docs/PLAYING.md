# Playing

How to use the simulator: build a hero, start a fight, weave a Sign, and add your own characters and
scenarios. This page says where the buttons are; the rules behind them are the tabletop system's
(see [CONTENT_POLICY.md](CONTENT_POLICY.md)).

```bash
npm run dev
```

## Building a hero

The **Hero** tab opens on a shelf of premade characters. **Play** seats one as the hero you will fight
with, and **Edit a copy** opens a premade in the creator so you can change it. Or start from a blank
sheet. The creator works top to bottom, and a live sheet beside it shows the finished character and
tells you what is still wrong.

| Section | What you choose |
| --- | --- |
| Who are they? | Name (with a **Suggest** button), gender, age, region, temperament and appearance. |
| Which people? | Human, Elf, Dwarf or Witcher. Each adjusts statistics, may grant bonus skills or natural armour, and fixes what the character can take (Witchers alone can take decoctions). |
| Which calling? | A profession, from bard and merchant to mage and witcher. Choosing one refits skills, kit and gear to it; your identity and people stay. |
| How are they made? | **Spend a pool** of points (60, 70, 75 or 80 depending on how heroic you want them) or **roll the dice**. |
| What can they do? | Skills. The calling's package takes 44 points with at least one level in each skill; pick-up skills outside it are bought with INT + REF points. Nothing starts above level 6, and hard skills cost two points a level. |
| What do they carry? | Weapons and armour bought with starting coin (a profession's crowns times 2d6, rolled or averaged), plus an optional field kit of alchemy items. |
| Keep or share | **Export** writes the hero as text you can save; paste it back and press **Import**. Nothing leaves your browser. |

**Quick build** refits skills and gear to the current calling, and **Randomize** makes a whole new
random hero. **Use this hero** seats the result, and the build report on the sheet blocks it until
there are no errors.

Magic is honest about what it simulates. A hero can cast the five basic Signs. Mage and Priest magic
is not simulated for heroes, and the sheet marks it "not simulated" rather than pretending. Perks that
are pure character colour (languages, social standing) are tagged "narrative" because they do not
touch combat.

## Starting a fight

Two ways in.

**The encounter builder** (Game tab) is the quick one: pick a category, a foe, a region, a variance
and a battlefield, press **Start**. Regions and variances are procedural, so the same foe produces a
different named opponent with a different history each time. **+ Add** stacks several groups into
one lineup before you start.

**The Forge tab** is the deliberate one. It lists ten authored set pieces, from *The Roadside Toll*
and *Drowners at the Ford* to *The Mage and Her Guard* and *Wyvern on the Pass*, each with a
briefing written to be read aloud before the first roll. Press **Run** and it builds the encounter,
places any hazards the scenario starts with, and puts the briefing at the top of the combat feed.

## Your turn

The action economy follows the tabletop system: one Action, one Bonus Action, movement, and
reactions. The cockpit's palette buttons map to it directly: Attack, Signs, Alchemy, Fight Tools,
Morale/Social, Move, Recover STA, End Turn.

Clicking a reachable tile moves; clicking an enemy token selects it as your target. The **Text
command** drawer takes plain instructions if that is faster:

```text
strong silver attack head
cast igni 3 with white flame
hold gnomish staff
grapple
move 5
end turn
```

## Signs, and weaving them

The Signs palette has four parts, top to bottom.

**Draw (STA)** is how much chaos you pull. Everything about a Sign scales from this: Igni's damage
dice, Quen's blocks, Aard's knockdown chance, Axii's Stun save penalty.

**Focus** appears only if your character carries one. A magical focus subtracts its value from the
STA cost, can never take that cost below 1, and only one may be used at a time. A Greater Focus also
makes the cast 2 points harder to resist. Taking one in hand costs no Action.

**Weave** is the house layer. Each augment is a small declarative change (a narrowed cone, a hotter
flame, a wider circle) and each one costs extra STA. A cast carries at most two, and augments in the
same group are mutually exclusive.

Some augments only appear once the battlefield earns them:

| Augment | Wants |
| --- | --- |
| Glyph ignition | the target standing in your Yrden |
| Grounded surge | the target standing in your Yrden |
| Kindled dust | the target inside a Dragon's Dream cloud |
| Shatter frost | the target already frozen |
| Cauterising burn | the target already bleeding |
| Piercing weave | a held focus, and casting skill 14 |

Unavailable augments are shown greyed with the reason on hover, rather than hidden, so you can see
what the fight is offering you if you set it up.

**The cost readout** is the important part. It shows exactly what the cast will spend before you
commit the Action:

```text
Igni            6 STA    focus −2    Overexert 1 · −5 HP
draw 5 + weave 3 − focus 2 · Vigor 5
```

Past your Vigor Threshold you pay 5 HP per point over. That is the whole balance of weaving:
augments are not free power, they are a way of spending Health for effect. The button disables
itself, with the reason, if the cast would kill you.

## Bombs

A bomb hits **every** body location for full damage dice each, which is why one Grapeshot erases a
drowner pack and barely marks a dragon: armour subtracts at every location separately.

Two things worth remembering before you throw one:

- **Everyone in the radius is caught, you included.** A Dancing Star has a 4 m blast. Standing 1 m
  from the burst means you burn too.
- **A failed Athletics check does not mean nothing happens.** The bomb lands 1d6 m away in a
  random direction and goes off there, sometimes back towards you.

A natural 1 on the casting roll is a magic fumble. Roll again: 1-6 and it still goes off but hurts;
7-9 and it fails with an elemental backlash; above 9 any focus you are carrying detonates.

## Adding characters and scenarios

Everything is in the **Forge** tab, and everything goes through the same validation.

**A character.** Fill in the sheet (name, species, statistics, the skills that matter in a fight,
HP/STA/REC/Vigor, a weapon, a focus, armour) and press **Add to roster**. Out-of-range values are
clamped rather than rejected, and a duplicate name gets a distinct id. For a player character with a
full build report, use the Hero tab instead; the Forge is for the opposition and the supporting cast.

**A scenario.** Scenarios are authored as JSON. Press **Insert template** for a worked example of
all three sections, edit it, and press **Load pack**. A scenario needs a name, a battlefield, and at
least one lineup entry; a briefing is what makes it worth replaying.

**Your own augments.** The same pack format takes `signAugments`. The schema caps every effect field
and refuses to let an authored augment call itself official: you can invent magic, but not magic
that outruns the rules.

**Keeping it.** Pasting a pack loads it for the session only; there is no save system. Press
**Export custom content** and save the JSON into `src/data/packs/` to make it permanent. See
[`src/data/packs/README.md`](../src/data/packs/README.md).

## The ground

The field defaults to 48 x 32 metres and one tile is one metre, which is what makes distance mean
something: Run is SPD x 3, a crossbow reaches 50 m, and closing on an archer is a decision rather
than a formality. The size can be changed in code (`GridService.configure`, 8 to 128 tiles a side);
the interface has no control for it. On a desktop-width window the whole field fits its panel, with
tiles scaling between 11 and 18 pixels; on a narrower screen the map pans sideways.

Hover any tile for what it is, what it costs to enter, and what cover it gives. The rules that
matter:

| Ground | What it does |
| --- | --- |
| Undergrowth, brambles, bog | -2 Dodge/Escape and Athletics |
| Deep water | -2 to attack, block and parry; bow and crossbow range quartered and damage halved; Athletics replaces Dodge |
| Ice, snow, scree | DC:14 Athletics after running or attacking, or you go down |
| Walls, boulders, trees | cover; a stone wall is 30 SP |

Elevation lightens the tile and costs movement to climb. Darkness (the night road) is -2 to attack
and defense for anyone without Night Vision, which most things that hunt at night have and you
do not.

Seventeen battlefields, each generated fresh: a river crossing with one ford, a boulder field, an
abandoned camp, a drowned marsh, a village graveyard, a frozen lake. The layout changes every fight.
The simulation itself is deterministic, so a seeded run replays exactly, which is what makes a bug
report reproducible.

**Opening distance depends on who you are fighting.** Anything whose only reach is its claws starts
at the far edge and has to cross the ground to reach you; that crossing is your window. Archers,
crossbowmen and mages deploy inside their own reach instead, around 16-20 m, and a mixed warband
comes in together at the reach of its longest arm. If the lineup has a mage in it, the shield wall
in front of it starts closer too.

## What you are fighting

Monsters use their own abilities, and the counters are the counters the rules give.

- A **griffin** charges the moment you open more than 10 m: -4 to hit, 10d6, and it throws you 8 m.
- A **noonwraith** is incorporeal (steel does *nothing* until Yrden forces it to materialise) and
  it will put three copies of itself around you that drain 3 Health a round.
- A **siren** screeches: everyone within 10 m makes a Stun save at -1.
- A **drowner** fights from the water, where it takes none of the penalties you do, and is immune
  to Axii because it is too simple to be reasoned with.
- A **werewolf** regenerates 5 a round, so a long fight is a losing fight.
- A **grave hag** commands every necrophage within 20 m.
- A **nekker**, troll or cyclops picks up a stone and throws it rather than closing empty-handed.
- Anything winged (griffin, wyvern, siren, dragon) will take to the air to reach ground you
  thought was safe.
- A **mage** keeps its distance and opens with the heaviest spell it can afford. It will not
  trade cantrips against your armour, and it only blinks away once it is actually hurt.

Turn on **AI Debug** to see the utility scores behind any of it.

## Reading the fight

Damage floats off the body it landed on, criticals name the wound, conditions announce themselves,
and the battlefield shakes in proportion to the hit. All of it is presentation: it never changes an
outcome, and it all switches off under `prefers-reduced-motion`.

The combat feed carries the narration and the arithmetic behind every roll. **AI Debug** on the
battlefield header shows the enemy's utility scores, which is how you find out why something chose
to flank instead of charge.

The **Bestiary**, **Alchemy**, and **Rules** tabs are reference: every registered creature, weapon,
Sign, potion, bomb, oil, condition, and critical wound, including anything a pack added.
