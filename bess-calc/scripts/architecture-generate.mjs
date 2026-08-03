#!/usr/bin/env node
// Regenerates the machine-derived parts of the repository intelligence layer:
// madge's import graph (JSON + DOT) and a directory-derived module inventory.
// Run via `npm run architecture:generate`. Idempotent — safe to run repeatedly;
// output only changes when the source tree's structure or imports change.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const repoRoot = join(root, '..');
const graphDir = join(repoRoot, '.agent', 'graph');

mkdirSync(graphDir, { recursive: true });

// Invoke each tool's JS entry point directly via `node`, rather than through
// npx or the node_modules/.bin shim: the .bin shims are .cmd batch files on
// Windows, which Node's execFileSync cannot spawn without shell:true, and
// shelling out re-introduces argument-escaping risk for no benefit here.
const madgeEntry = join(root, 'node_modules', 'madge', 'bin', 'cli.js');
const depcruiseEntry = join(root, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');

function madge(args) {
  return execFileSync(
    process.execPath,
    [madgeEntry, '--extensions', 'ts,tsx', '--ts-config', 'tsconfig.json', ...args, 'src', 'server'],
    { cwd: root, encoding: 'utf8' }
  );
}

console.log('Running madge (JSON import graph)...');
const graphJson = madge(['--json']);
writeFileSync(join(graphDir, 'import-graph.json'), graphJson);

// dependency-cruiser's own DOT reporter is pure JS (no Graphviz binary
// required to *generate* the .dot text — only to render it to an image,
// which this script does not do). madge's --dot mode shells out to
// Graphviz's gvpr and is skipped here to avoid a system dependency.
console.log('Running dependency-cruiser (DOT graph)...');
const graphDot = execFileSync(
  process.execPath,
  [depcruiseEntry, '--config', '.dependency-cruiser.cjs', '--output-type', 'dot', 'src', 'server'],
  { cwd: root, encoding: 'utf8' }
);
writeFileSync(join(graphDir, 'import-graph.dot'), graphDot);

console.log('Checking for circular dependencies...');
let circularOutput;
try {
  circularOutput = madge(['--circular']);
} catch (err) {
  // madge exits non-zero when circular deps are found; capture its stdout either way.
  circularOutput = err.stdout ?? String(err);
}
writeFileSync(join(graphDir, 'circular-report.txt'), circularOutput);

// Directory-derived module inventory: top-level directories under src/ and server/,
// each with its immediate .ts/.tsx file count, so module-map.md's file listing can
// be regenerated from reality instead of hand-maintained.
function listModules(base) {
  const abs = join(root, base);
  return readdirSync(abs)
    .filter((name) => statSync(join(abs, name)).isDirectory())
    .filter((name) => name !== '__tests__' && name !== 'node_modules')
    .map((name) => {
      const dirAbs = join(abs, name);
      const files = readdirSync(dirAbs).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'));
      return { module: `${base}/${name}`, fileCount: files.length, files };
    });
}

const inventory = {
  generatedAt: new Date().toISOString().slice(0, 10),
  src: listModules('src'),
  server: listModules('server'),
};
writeFileSync(join(graphDir, 'module-inventory.json'), JSON.stringify(inventory, null, 2));

console.log(`Wrote graph artifacts to ${relative(repoRoot, graphDir)}/`);
console.log('Next: review .agent/architecture/*.md and update by hand if the module inventory changed.');
