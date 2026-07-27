#!/usr/bin/env node
/**
 * check-doc-claims.mjs — fail when a number the docs advertise stops being true.
 *
 * The test count is quoted in six user-facing places: the README badge, the
 * README summary line, the README `pnpm test` comment, package.json,
 * manifest.json, and both .claude-plugin descriptions. Every one of those is
 * read by a prospective user, and every one of them went stale twice within a
 * single working session — first at 877 while the suite was at 962, then at
 * 962 while it was at 1496. Correcting it by hand is what failed; this makes
 * the claim checkable instead.
 *
 * Usage:
 *   node scripts/check-doc-claims.mjs            # verify (exit 1 on drift)
 *   node scripts/check-doc-claims.mjs --fix      # rewrite the docs to match
 *
 * The actual count comes from vitest's own JSON reporter rather than from
 * anything this script counts itself, so the number in the docs and the number
 * the suite reports have a single source.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Files that quote the test count, with the shapes they quote it in. */
const CLAIM_FILES = [
  "README.md",
  "package.json",
  "manifest.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  // The OpenSSF answers quote the count twice (test / test_most). Those are
  // read by bestpractices.dev off the default branch and become a public
  // assurance claim, which is the strongest reason of all to keep them true.
  ".bestpractices.json",
];

/** Every phrasing the count appears in. `%d` stands in for the number. */
const PATTERNS = [
  /(\bTests-)(\d+)(_passing\b)/g,
  /(\balt="?)(\d+)( passing\b)/g,
  /(\b)(\d+)( tests\b)/g,
];

function actualTestCount() {
  const dir = mkdtempSync(join(tmpdir(), "doc-claims-"));
  const out = join(dir, "results.json");
  try {
    // `vitest run` exits non-zero when a test fails. A drifted doc claim is
    // not the thing to report in that case, and a raw ENOENT/exec stack tells
    // the reader nothing — say plainly that the count could not be established
    // and let the test failure itself be the finding.
    try {
      execFileSync("pnpm", ["vitest", "run", "--reporter=json", `--outputFile=${out}`], {
        stdio: ["ignore", "ignore", "inherit"],
      });
    } catch {
      console.error(
        "Cannot check documented claims: the test suite did not pass, so the\n" +
          "authoritative test count is unknown. Fix the suite first — the failing\n" +
          "test is the real finding, not the documentation.",
      );
      process.exit(2);
    }
    const report = JSON.parse(readFileSync(out, "utf8"));
    if (typeof report.numTotalTests !== "number") {
      console.error("vitest JSON report has no numTotalTests — cannot verify doc claims.");
      process.exit(2);
    }
    return report.numTotalTests;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const fix = process.argv.includes("--fix");
  const expected = actualTestCount();
  const drifted = [];

  for (const file of CLAIM_FILES) {
    const before = readFileSync(file, "utf8");
    let after = before;
    for (const pattern of PATTERNS) {
      after = after.replace(pattern, (whole, lead, num, tail) => {
        if (Number(num) === expected) return whole;
        drifted.push(`${file}: claims ${num}, suite has ${expected}`);
        return `${lead}${expected}${tail}`;
      });
    }
    if (fix && after !== before) writeFileSync(file, after);
  }

  if (drifted.length === 0) {
    console.log(`doc claims OK — every quoted test count is ${expected}`);
    return;
  }

  if (fix) {
    console.log(`updated ${drifted.length} stale claim(s) to ${expected}`);
    return;
  }

  console.error("Documented test count has drifted from the suite:\n");
  for (const d of new Set(drifted)) console.error(`  ${d}`);
  console.error("\nRun `node scripts/check-doc-claims.mjs --fix` to correct them.");
  process.exit(1);
}

main();
