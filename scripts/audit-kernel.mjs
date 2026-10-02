import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src/core', 'src/entities', 'src/data', 'src/services', 'src/testing'];
const violations = [];
function walk(root) {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.ts')) {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, '');
      if (/\b(document|window|HTMLElement|AudioContext)\b/.test(source)) violations.push(path);
    }
  }
}
for (const root of roots) walk(root);

// Dependency direction: the simulation kernel must never import presentation.
const backEdges = [];
function walkImports(root) {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) walkImports(path);
    else if (path.endsWith('.ts')) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        const target = match[1];
        if (/(^|\/)(ui|adapters)\//.test(target) || target.includes('CompatibilityPresentation')) {
          backEdges.push(`${path} -> ${target}`);
        }
      }
    }
  }
}
for (const root of roots) walkImports(root);

if (violations.length) {
  console.error('Browser API leaked into the kernel. Move it to src/ui or src/adapters:');
  console.error('  ' + violations.join('\n  '));
}
if (backEdges.length) {
  console.error('Simulation imported presentation. Dependencies point one way only:');
  console.error('  ' + backEdges.join('\n  '));
}
if (violations.length || backEdges.length) process.exit(1);
console.log('Kernel audit passed: browser-free, and no simulation -> presentation imports.');
