# Content packs

Drop a `.json` pack in this folder to keep authored content permanently, then register it from
`src/data/witcherContent.ts`:

```ts
import myPack from './packs/my-pack.json';
loadContentPack(Registry, myPack);
```

A pack loaded here behaves identically to one pasted into the Forge — same schemas, same validation,
same non-destructive registration. The Forge's **Export custom content** button writes exactly this
format, so the workflow is: build it in the app, export it, save it here.

## Shape

```jsonc
{
  "formatVersion": 1,
  "name": "My pack",
  "author": "",
  "notes": "",
  "characters":   [ /* CharacterSchema  */ ],
  "scenarios":    [ /* ScenarioSchema   */ ],
  "signAugments": [ /* AugmentPackSchema */ ]
}
```

Every section is optional. The authoritative field list is `src/data/ContentPack.ts`; the Forge's
**Insert template** button writes a worked example of all three.

## Rules that apply to authored content

- **Ids are unique and never overwrite.** Loading a pack whose id already exists skips that row and
  reports it. Replacing a built-in creature with a custom one silently is the drift
  [CONTENT_POLICY.md](../../../docs/CONTENT_POLICY.md) exists to prevent.
- **Authored augments are house rules.** The schema refuses `ruleStatus: "standard"` and caps every
  effect field, so a pack cannot grant magic the rules do not support. See
  [DECISIONS.md](../../../docs/DECISIONS.md) D17.
- **This is not a save system.** Nothing is written automatically. A pack pasted into the Forge
  lasts for that session only; saving it here is the deliberate act that makes it permanent.
