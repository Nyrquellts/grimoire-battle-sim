import { z } from 'zod';

/** Runtime schema for untrusted coordinate data crossing an import boundary. */
export const PositionSchema = z.object({ x: z.number().int(), y: z.number().int() });

/** Runtime schema for imported tactical tiles. */
export const TileSchema = PositionSchema.extend({
  elevation: z.number().int().min(0).max(4),
  moveCost: z.number().positive(),
  coverSp: z.number().nonnegative(),
  blocksMove: z.boolean(),
  blocksLos: z.boolean(),
  terrainKind: z.string().optional()
});

/** Runtime schema for imported persistent zones. */
export const ZoneSchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
  radius: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  power: z.number().optional(),
  source: z.string().optional()
});

/** Boundary schema deliberately validates only stable top-level state invariants. */
export const StateBoundarySchema = z.object({
  version: z.string().min(1),
  phase: z.string().min(1),
  round: z.number().int().nonnegative(),
  map: z.object({
    // Length is not pinned: the grid is configurable, so a fixed 384 would reject a resized field.
    tiles: z.array(TileSchema).min(64),
    zones: z.array(ZoneSchema),
    objects: z.array(z.record(z.string(), z.unknown())),
    visibilityPenalty: z.number()
  })
}).passthrough();

/** Validates external/imported state without forcing game services to know about Zod. */
export function parseExternalState(input: unknown): z.infer<typeof StateBoundarySchema> {
  return StateBoundarySchema.parse(input);
}
