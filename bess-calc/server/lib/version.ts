import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PackageJsonShape {
  version: string;
}

/**
 * Resolves the app version. Prefers APP_VERSION from the environment (set at Docker
 * build time from the package.json baked into the image) since bundling collapses
 * server/lib/version.ts's own directory depth, making a relative path back to
 * package.json unreliable across dev (tsx, unbundled) vs. production (tsup, single
 * bundled file) execution. Falls back to walking upward from this file looking for a
 * package.json, which works in dev/test but is not guaranteed after bundling.
 */
function readPackageVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;

  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as PackageJsonShape;
      if (pkg.version) return pkg.version;
    } catch {
      // keep walking up
    }
    dir = join(dir, '..');
  }
  return '0.0.0-unknown';
}

export const APP_VERSION = readPackageVersion();
export const CALCULATION_ENGINE_VERSION = '1.0.0';
export const GIT_COMMIT_SHA = process.env.GIT_COMMIT_SHA ?? 'unknown';
