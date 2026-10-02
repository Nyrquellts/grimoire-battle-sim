import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../src/ui/CommandParser';
import { Store } from '../../src/services/SimulationRuntime';
import { Registry } from '../../src/data/witcherContent';
import type { IState } from '../../src/entities/types';

/**
 * The text console builds requests; the gateway still validates them. These tests therefore assert
 * the *shape* of what a command asks for, never that it would be legal.
 */

const deps = { registry: Registry, playerId: () => 'nikhail' };

function state(overrides: Partial<IState> = {}): IState {
  return { ...structuredClone(Store.read()), ...overrides } as IState;
}

describe('parseCommand', () => {
  it('returns null for anything it does not recognise', () => {
    expect(parseCommand('', state(), deps)).toBeNull();
    expect(parseCommand('make me a sandwich', state(), deps)).toBeNull();
  });

  it('parses the simple turn verbs', () => {
    expect(parseCommand('end turn', state(), deps)?.name).toBe('endTurn');
    expect(parseCommand('reload', state(), deps)?.name).toBe('reload');
    expect(parseCommand('recover', state(), deps)?.name).toBe('recover');
  });

  it('moves the requested number of metres along the row', () => {
    const current = state();
    const command = parseCommand('move 5', current, deps);
    expect(command?.name).toBe('move');
    expect(command?.payload.to).toEqual({ x: Math.min(23, current.player.pos.x + 5), y: current.player.pos.y });
  });

  it('clamps movement to the edge of the board', () => {
    const current = state();
    current.player.pos = { x: 21, y: 4 };
    expect(parseCommand('move 9', current, deps)?.payload.to).toEqual({ x: 23, y: 4 });
  });

  it('reads the weapon, mode, and called shot out of an attack line', () => {
    const command = parseCommand('strong silver attack head', state(), deps);
    expect(command?.name).toBe('melee');
    expect(command?.payload).toMatchObject({ weaponId: 'manticoreSilver', mode: 'strong', called: 'head' });
  });

  it('prefers the longer location phrase', () => {
    expect(parseCommand('attack left arm', state(), deps)?.payload.called).toBe('leftArm');
    expect(parseCommand('attack right leg', state(), deps)?.payload.called).toBe('rightLeg');
  });

  it('defaults an attack to steel, normal, random location', () => {
    expect(parseCommand('attack', state(), deps)?.payload).toMatchObject({
      weaponId: 'manticoreSteel', mode: 'normal', called: 'random'
    });
  });

  it('parses a Sign and the STA invested in it', () => {
    const command = parseCommand('cast igni 3', state(), deps);
    expect(command?.name).toBe('sign');
    expect(command?.payload).toMatchObject({ signId: 'igni', cost: 3 });
  });

  it('falls back to the palette draw when the line names no number', () => {
    const current = state();
    (current.ui as Record<string, unknown>).signCost = 4;
    expect(parseCommand('cast quen', current, deps)?.payload.cost).toBe(4);
  });

  it('weaves augments named in the line', () => {
    const command = parseCommand('cast igni 3 with white flame', state(), deps);
    expect(command?.payload.augmentIds).toEqual(['whiteFlame']);
  });

  it('never weaves more than a cast may carry', () => {
    const command = parseCommand('cast aard 2 with narrowed cone and hammer blow and extended reach', state(), deps);
    expect((command?.payload.augmentIds as string[]).length).toBeLessThanOrEqual(2);
  });

  it('takes a named focus in hand', () => {
    const command = parseCommand('hold gnomish staff', state(), deps);
    expect(command).toMatchObject({ name: 'equipFocus', payload: { focusId: 'gnomishStaff' } });
  });

  it('stows the focus on request', () => {
    expect(parseCommand('stow focus', state(), deps)).toMatchObject({ name: 'equipFocus', payload: { focusId: null } });
  });

  it('parses brawling moves', () => {
    expect(parseCommand('grapple', state(), deps)).toMatchObject({ name: 'barehanded', payload: { move: 'grapple' } });
    expect(parseCommand('strong kick', state(), deps)?.payload).toMatchObject({ move: 'kick', mode: 'strong' });
  });

  it('carries the currently selected target', () => {
    const current = state();
    current.selectedEnemyId = 'enemy-7';
    expect(parseCommand('attack', current, deps)?.payload.targetId).toBe('enemy-7');
  });
});

describe('parseCommand for a hero who carries other weapons', () => {
  function armed(weapons: string[], selectedWeapon?: string): IState {
    const current = state();
    current.player = { ...structuredClone(current.player), weapons, selectedWeapon } as IState['player'];
    return current;
  }

  it('swings what the hero actually carries rather than the premade veteran’s sword', () => {
    expect(parseCommand('attack', armed(['armingSword']), deps)?.payload.weaponId).toBe('armingSword');
  });

  it('reads a carried weapon out of the line by its name', () => {
    const kit = armed(['dagger', 'armingSword'], 'armingSword');
    expect(parseCommand('dagger attack', kit, deps)?.payload.weaponId).toBe('dagger');
    expect(parseCommand('strong arming sword attack head', kit, deps)?.payload).toMatchObject({ weaponId: 'armingSword', mode: 'strong', called: 'head' });
  });

  it('ignores a weapon the line names but the hero does not carry', () => {
    expect(parseCommand('silver attack', armed(['armingSword']), deps)?.payload.weaponId).toBe('armingSword');
  });

  it('uses the weapon in hand when the line names none, else the first carried', () => {
    expect(parseCommand('attack', armed(['dagger', 'armingSword'], 'armingSword'), deps)?.payload.weaponId).toBe('armingSword');
    expect(parseCommand('attack', armed(['dagger', 'armingSword']), deps)?.payload.weaponId).toBe('dagger');
  });

  it('never mistakes a bow in hand for a melee weapon', () => {
    expect(parseCommand('attack', armed(['longBow', 'dagger'], 'longBow'), deps)?.payload.weaponId).toBe('dagger');
  });

  it('throws a punch when the hero carries no melee weapon at all', () => {
    for (const hero of [armed([]), armed(['longBow'], 'longBow')]) {
      expect(parseCommand('attack', hero, deps)).toMatchObject({ name: 'barehanded', payload: { move: 'punch', mode: 'normal' } });
    }
    expect(parseCommand('strong attack', armed([]), deps)?.payload.mode).toBe('strong');
  });
});
