/**
 * Migration metrics reporter.
 *
 * Prints the numbers tracked in docs/STATUS.md so they are measured, never guessed.
 * Run with `npm run metrics`, or `npm run metrics -- --json` for machine-readable output.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/** Every TypeScript file under a directory tree. */
function filesUnder(root) {
  const out = [];
  let entries;
  try { entries = readdirSync(root); } catch { return out; }
  for (const name of entries) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const sources = [...filesUnder('src'), ...filesUnder('tests')];
const read = path => readFileSync(path, 'utf8');
const lineCount = path => read(path).split('\n').length;

/**
 * Executable characters in a file, comments and string literals stripped.
 *
 * Line count alone is a poor measure of the bridges: their legacy code is minified onto very long
 * lines, so lifting several thousand characters of logic into a readable module can *raise* the
 * line count even though the bridge genuinely shrank. This counts the code itself, so the number
 * cannot be gamed by reflowing in either direction.
 */
const codeSize = path => code(read(path)).replace(/\s+/g, ' ').trim().length;

/** Strips comments and string literals so token counts reflect executable code only. */
function code(text) {
  return text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, '');
}

const BRIDGES = ['src/services/SimulationRuntime.ts', 'src/ui/CompatibilityPresentation.ts'];
const isBridge = path => BRIDGES.includes(relative(ROOT, path).replace(/\\/g, '/'));

function countMatches(paths, pattern, { skipBridges = false, stripComments = true } = {}) {
  let total = 0;
  for (const path of paths) {
    if (skipBridges && isBridge(path)) continue;
    const text = stripComments ? code(read(path)) : read(path);
    total += (text.match(pattern) ?? []).length;
  }
  return total;
}

function filesMatching(paths, pattern) {
  return paths.filter(path => pattern.test(read(path))).map(path => relative(ROOT, path).replace(/\\/g, '/'));
}

const metrics = {
  'SimulationRuntime.ts lines': lineCount('src/services/SimulationRuntime.ts'),
  'SimulationRuntime.ts code chars': codeSize('src/services/SimulationRuntime.ts'),
  'CompatibilityPresentation.ts lines': lineCount('src/ui/CompatibilityPresentation.ts'),
  'CompatibilityPresentation.ts code chars': codeSize('src/ui/CompatibilityPresentation.ts'),
  '@ts-nocheck files': filesMatching(sources, /@ts-nocheck/).length,
  'files importing SimulationRuntime': filesMatching(sources, /from '[^']*SimulationRuntime'/).length,
  'files importing CompatibilityPresentation': filesMatching(sources, /['"][^'"]*CompatibilityPresentation['"]/).length,
  'nikhail references in src': countMatches(filesUnder('src'), /\bnikhail\b/gi, { stripComments: false }),
  'state.player references in src': countMatches(filesUnder('src'), /\b(?:state|st|s|d|draft|context)\.player\b/g),
  'state.enemies references in src': countMatches(filesUnder('src'), /\b(?:state|st|s|d|draft|context)\.enemies\b/g),
  'any tokens outside bridges': countMatches(sources, /\bany\b/g, { skipBridges: true }),
  'any tokens inside bridges': countMatches(BRIDGES, /\bany\b/g)
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(metrics, null, 2));
} else {
  const width = Math.max(...Object.keys(metrics).map(key => key.length));
  for (const [key, value] of Object.entries(metrics)) console.log(`${key.padEnd(width)}  ${value}`);
  console.log('\nDetail:');
  console.log('  @ts-nocheck:', filesMatching(sources, /@ts-nocheck/).join(', ') || 'none');
  console.log('  SimulationRuntime importers:', filesMatching(sources, /from '[^']*SimulationRuntime'/).join(', ') || 'none');
}
