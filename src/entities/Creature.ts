import type { IActor } from './types';

/** Creature-specific type alias used by factories and bestiary adapters. */
export type CreatureActor = IActor & { family: string };
