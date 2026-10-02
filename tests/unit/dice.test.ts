import { describe, expect, it } from 'vitest';
import { DiceService } from '../../src/core/Dice';
import { SeededRng } from '../../src/core/SeededRng';

describe('DiceService', () => {
  it('replays identical rolls from the same seed', () => {
    const a = new DiceService(new SeededRng(123456));
    const b = new DiceService(new SeededRng(123456));
    expect([a.d(10), a.d(10), a.rollNotation('3d6+2')]).toEqual([b.d(10), b.d(10), b.rollNotation('3d6+2')]);
  });

  it('parses NdS modifiers without changing RNG semantics', () => {
    const dice = new DiceService(new SeededRng(99));
    const roll = dice.rollNotation('2d6+3');
    expect(roll.rolls).toHaveLength(2);
    expect(roll.total).toBe(roll.rolls[0]! + roll.rolls[1]! + 3);
  });
});
