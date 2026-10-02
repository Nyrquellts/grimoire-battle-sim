import { SeededRng } from './SeededRng';

export interface DiceRoll { rolls: number[]; mod: number; total: number; text: string }
export interface CheckRoll { base: number; first: number; chain: number[]; kind: 'normal' | 'exploding' | 'imploding'; total: number; text: string }

/** Strict deterministic dice facade used by combat and tests. */
export class DiceService {
  constructor(readonly rng = new SeededRng()) {}

  /** Resets the deterministic seed. */
  seed(value: number): number { return this.rng.setSeed(value); }
  /** Captures the RNG state. */
  snapshot(): number { return this.rng.snapshot(); }
  /** Restores the RNG state. */
  restore(value: number): void { this.rng.restore(value); }
  /** Inclusive integer roll. */
  int(max: number): number { return this.rng.int(max); }
  /** Rolls one die. */
  d(sides = 10): number { return this.int(sides); }

  /** Parses and rolls NdS±M notation. */
  rollNotation(expression: string): DiceRoll {
    const match = String(expression).trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) throw new Error(`Bad dice notation: ${expression}`);
    const count = Number(match[1]);
    const sides = Number(match[2]);
    const modifier = Number(match[3] || 0);
    const rolls = Array.from({ length: count }, () => this.d(sides));
    const subtotal = rolls.reduce((sum, roll) => sum + roll, 0);
    const total = subtotal + modifier;
    return { rolls, mod: modifier, total, text: `${rolls.join('+')}${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''} = ${total}` };
  }

  /** Performs the Witcher d10 exploding/imploding skill-check sequence. */
  check(base: number, options: { label?: string; maxDepth?: number } = {}): CheckRoll {
    const label = options.label ?? 'Check';
    const maxDepth = options.maxDepth ?? 8;
    const first = this.d(10);
    const chain = [first];
    let delta = first;
    let kind: CheckRoll['kind'] = 'normal';
    if (first === 10) {
      kind = 'exploding';
      for (let depth = 0; depth < maxDepth; depth++) {
        const roll = this.d(10); chain.push(roll); delta += roll; if (roll !== 10) break;
      }
    } else if (first === 1) {
      kind = 'imploding';
      for (let depth = 0; depth < maxDepth; depth++) {
        const roll = this.d(10); chain.push(roll); delta -= roll; if (roll !== 10) break;
      }
    }
    const total = base + delta;
    return { base, first, chain, kind, total, text: `${label} ${base} + [${chain.join(kind === 'imploding' ? ' − ' : ' + ')}] = ${total}` };
  }
}
