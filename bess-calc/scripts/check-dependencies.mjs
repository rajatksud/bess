#!/usr/bin/env node
// Fails (non-zero exit) if dependency-cruiser reports an `error`-severity
// violation — currently the engine-modules-must-not-depend-on-express-or-prisma
// rule in .dependency-cruiser.cjs. `warn`-severity rules (e.g. no-circular)
// are reported but do not fail the run. Run via `npm run architecture:check`.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const depcruiseEntry = join(root, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');

try {
  const output = execFileSync(
    process.execPath,
    [depcruiseEntry, '--config', '.dependency-cruiser.cjs', '--output-type', 'err', 'src', 'server'],
    { cwd: root, encoding: 'utf8' }
  );
  console.log(output);
} catch (err) {
  console.log(err.stdout ?? '');
  console.error(err.stderr ?? '');
  process.exit(err.status ?? 1);
}
