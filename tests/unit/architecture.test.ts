import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ActionDispatcher, Registry } from '../../src/services/SimulationRuntime';

/** Layers that must stay pure: no browser APIs, no presentation, no identity branching. */
const KERNEL_ROOTS = ['src/core', 'src/entities', 'src/data', 'src/services', 'src/testing'];

function filesUnder(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

/** Removes comments and string literals so matches reflect executable code only. */
function executableSource(text: string): string {
  return text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, '');
}

describe('kernel portability boundary', () => {
  it('keeps browser APIs out of executable kernel source', () => {
    const violations: string[] = [];
    for (const root of KERNEL_ROOTS) {
      for (const file of filesUnder(root)) {
        if (/\b(document|window|HTMLElement|AudioContext)\b/.test(executableSource(readFileSync(file, 'utf8')))) {
          violations.push(file);
        }
      }
    }
    expect(violations, 'browser APIs belong in src/ui or src/adapters').toEqual([]);
  });
});

describe('dependency direction', () => {
  it('never imports presentation from the simulation kernel', () => {
    const violations: string[] = [];
    for (const root of KERNEL_ROOTS) {
      for (const file of filesUnder(root)) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
          const target = match[1] ?? '';
          if (/(^|\/)(ui|adapters)\//.test(target) || target.includes('CompatibilityPresentation')) {
            violations.push(`${file} -> ${target}`);
          }
        }
      }
    }
    expect(violations, 'simulation must not depend on presentation').toEqual([]);
  });
});

describe('no character identity branching in simulation code', () => {
  /**
   * Guards KNOWN_ISSUES C. Rules must come from actor data — control mode, skills, traits, weapon
   * properties — never from which character an actor happens to be. Content stays free to define
   * Nikhail, equip him, and name him in narration when he is actually fighting.
   *
   * The protected ids come from the character registry, so registering a new named character
   * automatically covers it too.
   */
  it('never compares against a registered character id', () => {
    const characterIds = [...Registry.characters.values()].map(entry => String(entry.id)).filter(Boolean);
    expect(characterIds.length, 'expected at least one registered character').toBeGreaterThan(0);

    const comparison = new RegExp('[=!]==?\\s*([\'"`])(' + characterIds.join('|') + ')\\1', 'i');
    const violations: string[] = [];

    for (const root of KERNEL_ROOTS) {
      for (const file of filesUnder(root)) {
        readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
          const match = comparison.exec(line.replace(/\/\/.*$/, ''));
          if (match) violations.push(`${file}:${index + 1} ${match[0]}`);
        });
      }
    }

    expect(violations, 'branch on actor data (control, skills, traits), not on identity').toEqual([]);
  });
});

/** Splits the top-level arguments of the call whose opening parenthesis is at `open`. */
function callArguments(text: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = open + 1;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const char = text[i]!;
    if (quote) {
      if (char === String.fromCharCode(92)) i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if ('([{'.includes(char)) { depth++; continue; }
    if (')]}'.includes(char)) {
      depth--;
      if (!depth) { out.push(text.slice(start, i)); return out; }
      continue;
    }
    if (char === ',' && depth === 1) { out.push(text.slice(start, i)); start = i + 1; }
  }
  return out;
}

describe('every action the AI can offer actually exists', () => {
  /**
   * Guards a bug this suite was extended for.
   *
   * The enemy AI offered `enemyDragonFlight` on every dragon turn. Nothing had ever registered
   * that action, so the gateway rejected it as unknown every single time — dragons could not fly,
   * and the self-check covering it passed anyway because it only asserted the candidate was
   * *offered*. An offer no gateway can dispatch is not a capability.
   *
   * Reading the offers out of the source rather than from a live fight is deliberate: a candidate
   * that only appears in rare states would otherwise never be checked.
   */
  it('registers every action name the enemy AI passes to the gateway', () => {
    const source = readFileSync('src/services/SimulationRuntime.ts', 'utf8');
    const offered = new Set<string>();
    // The AI builds candidates with add(name, score, 'actionName', ...). A two-argument `add` is the
    // scoring helper and means nothing here, so the arguments are split on real nesting depth: a
    // loose regex reads a quoted string inside a scoring call as though it were an action name.
    for (const match of source.matchAll(/\badd\(/g)) {
      const parts = callArguments(source, (match.index ?? 0) + match[0].length - 1);
      if (parts.length < 3) continue;
      const literal = /^'([A-Za-z]\w*)'$/.exec(parts[2]!.trim());
      if (literal) offered.add(literal[1]!);
    }
    expect(offered.size, 'expected to find the AI candidate offers').toBeGreaterThan(5);

    const registered = new Set(ActionDispatcher.list().map(String));
    const missing = [...offered].filter(name => !registered.has(name));
    expect(missing, 'the AI offers an action nothing registered').toEqual([]);
  });
});
