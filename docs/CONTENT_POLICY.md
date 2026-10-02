# Content policy

How rules and content are classified, how provenance is recorded, and what does and does not belong
in the repository. [NOTICE.md](../NOTICE.md) covers the legal footing; this page covers the working
rules for contributors.

## 1. What the simulator models

Grimoire Battle Sim implements the combat and magic system of a published tabletop role-playing game
as an unofficial fan project. That system is the reference for **what the rules are**: action
economy, stamina, skills, weapons and armour, damage, critical wounds, Signs and spells, alchemy,
and creature abilities.

- Mechanics are encoded as data: numbers, tables, costs and declarative effects, kept concise and
  held in registry rows.
- Prose is original. Descriptions, narration, briefings, tooltips and dialogue are written for this
  project in its own words.
- Mechanics from other games, adaptations or general fantasy habit are not substitutes. If the
  reference does not settle a question, say so and record a decision instead of guessing.

## 2. Rule status

Every non-obvious rule or content definition is one of four things:

| Status | Meaning | Example |
| --- | --- | --- |
| `standard` | Follows the reference rules as understood. | Armor Piercing halves armour; the improved level also skips Damage Resistance. |
| `adapted` | A reference rule adjusted to work in a tactical simulator. | Terrain movement costs, because a tile grid has to put a number on a qualitative rule. |
| `house` | A deliberate addition or deviation chosen by the maintainers. | Sign augments; the hero creator's starting field kit. |
| `original` | Invented for this project and not part of the reference setting. | Scenario set pieces and battlefield recipes. |

The status travels with the content: creature abilities, Signs, augments and similar rows carry a
`ruleStatus`, and content packs carry `source: { status, origin }` so a row can say whether it ships
with the project, was authored by a user, or is incomplete. An authored Sign augment can only be
`house` or `original`; the pack schema refuses to let it call itself standard.

Three consequences:

- **Never mislabel.** An invented rule marked `standard` is worse than an unmarked one.
- **Interpretations are not rules.** Where the reference is silent or ambiguous, the choice is
  recorded in [DECISIONS.md](DECISIONS.md) as a simulator interpretation and the row stays honest
  about it. Example: whether a second potion dose refreshes the timer (D9).
- **A disagreement between two reference sources** is stated, resolved only when a more specific or
  later rule justifies it, and recorded. It is never reconciled silently.

## 3. Tested behaviour during refactors

While code is being restructured, the existing tests define what works, and existing behaviour wins
even where it differs from the reference. When implementation and reference disagree, classify the
difference before acting:

| Class | Meaning | Action |
| --- | --- | --- |
| deliberate adaptation | Simplified on purpose for a tactical simulator. | Document, keep. |
| house rule | A maintainer chose it. | Document, keep. |
| bug | Wrong by its own intent. | Separate change: failing test, then fix. |
| implementation mistake | Right intent, wrong code. | Separate change: failing test, then fix. |
| ambiguous source | The reference does not settle it. | Document the ambiguity; do not invent. |

Never change a rule as a side effect of moving code.

## 4. Writing content

- **Write your own text.** Do not copy sentences, flavour text, quotations, tables of prose or
  descriptions from any book, wiki or game. Describe what a thing does in a sentence of your own.
- **Names.** Terms of the setting, such as creature, Sign, potion and region names, are used as
  labels. Invent new names for people, places and items you create. Do not reuse named characters
  from the source works.
- **No paper trail.** Do not cite page numbers, quote passages, or commit scans, PDFs, extraction
  output or transcription scripts.
- **No lore in the engine.** Behaviour comes from data fields, never from checking a creature's
  name. See ground rule 8 in [CONTRIBUTING.md](../CONTRIBUTING.md).
- **Keep numbers in data.** A stat, cost or modifier belongs in a registry row, not scattered
  through services.

## 5. Replacing and extending built-in content

Authored content arrives as a content pack and passes through one validated path
(see [DECISIONS.md](DECISIONS.md) D18). Ids are unique and never overwrite: loading a pack whose id
already exists skips that row and reports it. Silently replacing a built-in creature with a custom
one is the drift this policy exists to prevent.

Because everything is data, a fork can replace the whole setting with original content without
touching engine code.

## 6. Engineering references

Books and papers on game AI, utility scoring, tactical positioning, event-based simulation and
automated testing inform how the code is structured. They never decide what a rule is, and an AI
must not gain an ability the rules do not grant because a technique suggested one.

Before applying a technique, answer: what concrete problem does it solve here, does this project
actually have that problem, is there a simpler fix, and what does it cost in complexity? This is a
single-player tactical simulator, so avoid architecture built for a studio.

## 7. Maintainer decisions

Explicit decisions by the maintainers outrank generic advice and, where they establish a house rule,
outrank the reference. Record them in [DECISIONS.md](DECISIONS.md).
