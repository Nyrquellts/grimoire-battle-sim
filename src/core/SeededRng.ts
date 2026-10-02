import { invariant } from './utils';

/** Deterministic xorshift32 RNG. The same seed produces the same combat sequence. */
export class SeededRng {
  #state = 0x9e3779b9;

  constructor(seed = SeededRng.randomSeed()) {
    this.setSeed(seed);
  }

  /** Uses Web Crypto when present without making the simulation depend on browser APIs. */
  static randomSeed(): number {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.getRandomValues) {
      const data = new Uint32Array(1);
      cryptoApi.getRandomValues(data);
      return data[0] || 0x9e3779b9;
    }
    const now = Date.now() >>> 0;
    return now || 0x9e3779b9;
  }

  /** Sets and normalizes the current seed. */
  setSeed(seed: number): number {
    const normalized = Number(seed) >>> 0;
    this.#state = normalized || 0x9e3779b9;
    return this.#state;
  }

  /** Returns the current deterministic state. */
  snapshot(): number { return this.#state >>> 0; }

  /** Restores a prior deterministic state. */
  restore(snapshot: number): void { this.setSeed(snapshot); }

  /** Advances xorshift32 and returns an unsigned 32-bit integer. */
  nextU32(): number {
    let x = this.#state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state;
  }

  /** Returns an integer in the inclusive range 1..max. */
  int(max: number): number {
    invariant(Number.isInteger(max) && max >= 1, `RNG max must be a positive integer, got ${max}.`);
    return (this.nextU32() % max) + 1;
  }
}
