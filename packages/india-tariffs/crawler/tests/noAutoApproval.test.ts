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

/**
 * The one deliberate exception: src/release/compileRelease.ts runs strictly
 * *after* a human has recorded a review decision. It reads what the human
 * already approved and freezes it into an immutable, versioned release
 * (dataset_releases) -- it never writes to approved_tariffs or
 * review_decisions itself. This is a different pipeline stage than the
 * crawl -> classify -> extract -> validate lane this test protects, so it is
 * named here explicitly rather than silently exempted by a path pattern.
 */
const ALLOWED_APPROVAL_READER_FILES = [join(SRC_DIR, "release", "compileRelease.ts")];

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
 * those tables belong exclusively to a human-reviewer-driven promotion step.
 * A reference to either name in src/ would mean some code path can write (or
 * even just read, ahead of a write) data into the human-approval boundary --
 * this test makes that a hard, mechanically-enforced regression guard rather
 * than a design note reviewers have to remember to check for by hand.
 *
 * The sole exception is ALLOWED_APPROVAL_READER_FILES (currently just the
 * release compiler, which runs strictly after a human decision has already
 * been recorded and never writes to either table) -- named explicitly here
 * rather than exempted by a path pattern, so widening this exception is a
 * visible, reviewable diff to this test file itself.
 */
test("no .ts file under src/ references the approved_tariffs or review_decisions table names, outside the named exception", () => {
  const files = listTsFilesRecursive(SRC_DIR).filter((f) => !ALLOWED_APPROVAL_READER_FILES.includes(f));
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

test("ALLOWED_APPROVAL_READER_FILES never writes to approved_tariffs or review_decisions, only reads", () => {
  for (const file of ALLOWED_APPROVAL_READER_FILES) {
    const content = readFileSync(file, "utf8");
    assert.equal(
      /INSERT\s+INTO\s+(approved_tariffs|review_decisions)/i.test(content),
      false,
      `${file} must never INSERT into the human-approval-boundary tables`,
    );
    assert.equal(
      /UPDATE\s+(approved_tariffs|review_decisions)/i.test(content),
      false,
      `${file} must never UPDATE the human-approval-boundary tables`,
    );
    assert.equal(
      /DELETE\s+FROM\s+(approved_tariffs|review_decisions)/i.test(content),
      false,
      `${file} must never DELETE from the human-approval-boundary tables`,
    );
  }
});

test("runValidation's own source never sets candidate_tariffs.status to APPROVED", () => {
  const content = readFileSync(join(SRC_DIR, "validation", "runValidation.ts"), "utf8");
  assert.equal(/['"]APPROVED['"]/.test(content), false);
});
