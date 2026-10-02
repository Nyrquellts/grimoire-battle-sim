import type { IActor } from './types';

/** Player-specific type alias kept separate so the kernel never hardcodes one named character. */
export type PlayerActor = IActor & { control?: 'PLAYER' | string };
