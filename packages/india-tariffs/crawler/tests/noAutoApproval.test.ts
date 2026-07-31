import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.url is dist/tests at runtime (npm test always rebuilds via tsc
// first); walk up to the package root, then into the real TypeScript src/
// tree -- this intentionally reads the authored .ts files, not compiled
// output, so the assertion reflects the actual source of truth reviewers
// edit and can never be defeated by a build step stripping a comment.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = join(PACKAGE_ROOT, "src");

const FORBIDDEN_TABLE_NAMES = ["approved_tariffs", "review_decisions"];

function listTsFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listTsFilesRecursive(fullPath));
    } else if (entry.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * This milestone's crawl -> classify -> extract -> validate pipeline has no
 * legitimate reason to ever reference approved_tariffs or review_decisions:
 * those tables belong exclusively to a human-reviewer-driven promotion step
 * that does not exist in this codebase yet. A reference to either name in
 * src/ would mean some code path can write (or even just read, ahead of a
 * write) data into the human-approval boundary -- this test makes that a
 * hard, mechanically-enforced regression guard rather than a design note
 * reviewers have to remember to check for by hand.
 */
test("no .ts file under src/ references the approved_tariffs or review_decisions table names", () => {
  const files = listTsFilesRecursive(SRC_DIR);
  assert.ok(files.length > 10, "sanity check: expected to find a substantial number of source files");

  const violations: { file: string; table: string }[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const table of FORBIDDEN_TABLE_NAMES) {
      if (content.includes(table)) {
        violations.push({ file, table });
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found forbidden references to human-approval-boundary tables: ${JSON.stringify(violations, null, 2)}`,
  );
});

test("runValidation's own source never sets candidate_tariffs.status to APPROVED", () => {
  const content = readFileSync(join(SRC_DIR, "validation", "runValidation.ts"), "utf8");
  assert.equal(/['"]APPROVED['"]/.test(content), false);
});
