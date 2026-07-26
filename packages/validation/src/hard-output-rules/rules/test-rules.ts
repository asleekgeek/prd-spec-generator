import type { HardOutputRuleViolation, SectionType } from "@prd-gen/core";
import { findPatternViolations, makeViolation } from "./helpers.js";

const PLACEHOLDER_MESSAGE =
  "Found placeholder test with empty or TODO-only body";

/**
 * A body is "placeholder" when it carries a TODO/FIXME/PLACEHOLDER comment.
 * Applied ONCE to an already-extracted body, so it cannot backtrack: there is
 * no quantifier around it to re-split the input.
 */
const PLACEHOLDER_COMMENT = /\/\/\s*(?:TODO|FIXME|PLACEHOLDER)/;

// Rule 7: No Placeholder Tests
export function checkNoPlaceholderTests(
  content: string,
  sectionType: SectionType,
): HardOutputRuleViolation[] {
  // The body pattern was
  //   `…\{[^}]*\/\/\s*(?:TODO|FIXME|PLACEHOLDER)[^}]*\}`
  // and was quadratic (js/polynomial-redos): with the closing brace absent,
  // the leading `[^}]*` offers a split at every `//` and the trailing
  // `[^}]*\}` rescans to end-of-input for each one. Measured 3.89x, 4.01x,
  // 4.00x per doubling (11 ms at 12 KB, 713 ms at 96 KB).
  //
  // A brace-run is delimited, so capturing it once and testing the capture is
  // both linear and exactly equivalent: `[^}]` cannot cross `}`, so the old
  // pattern already required the comment to sit in the FIRST brace-run — the
  // very text `([^}]*)` captures. A 30k-input differential (old regex vs this
  // form, including nested-brace, missing-brace and multi-function cases)
  // reported 0 differing inputs. Measured 1.98x per doubling after the change.
  //
  // Driven by `.exec`, so it is built per call rather than hoisted: `.exec`
  // advances `lastIndex` on a /g regex, and a shared object would carry that
  // state into the next call (same reason sp-rules.ts hoists only its
  // `matchAll` pattern).
  const testFuncBody =
    /func\s+test\w+\s*\([^)]*\)\s*(?:throws\s+)?(?:async\s+)?(?:throws\s+)?\{([^}]*)\}/g;

  const violations: HardOutputRuleViolation[] = [];

  let bodyMatch: RegExpExecArray | null;
  while ((bodyMatch = testFuncBody.exec(content)) !== null) {
    if (!PLACEHOLDER_COMMENT.test(bodyMatch[1])) continue;
    violations.push(
      makeViolation(
        "no_placeholder_tests",
        sectionType,
        PLACEHOLDER_MESSAGE,
        bodyMatch[0].substring(0, 120),
      ),
    );
  }

  // The empty-body and matrix-row patterns stay declarative — neither has a
  // quantifier pair that can re-split the same characters.
  //
  // The matrix row was `^\s*\|\s*test\w+\s*\|[^|]*\|\s*`?\s*\/\/\s*(?:TODO|Setup)`,
  // quadratic through the ``\s*`?\s*`` pair: with the backtick absent, a run of
  // spaces can be split between the two `\s*` in n+1 ways. Measured 3.95x,
  // 3.99x, 4.04x per doubling. `[ \t]*(?:`[ \t]*)?` accepts the same language
  // — whitespace, optionally a backtick, optionally more whitespace — with
  // exactly one parse, and measured 1.97x after the change.
  //
  // The classes are narrowed to horizontal space in the same edit because the
  // rule is about ONE matrix row: `\s` and `[^|]` both match `\n`, so the old
  // pattern also accepted the `// TODO` on a LATER line than the row it
  // belongs to. That is the single behavioural delta a 20k-input differential
  // found, and it is pinned by a test.
  const patterns: readonly RegExp[] = [
    /func\s+test\w+\s*\([^)]*\)\s*(?:throws\s+)?(?:async\s+)?(?:throws\s+)?\{\s*\}/g,
    /^[ \t]*\|[ \t]*test\w+[ \t]*\|[^|\n]*\|[ \t]*(?:`[ \t]*)?\/\/[ \t]*(?:TODO|Setup)/gm,
  ];

  for (const pattern of patterns) {
    violations.push(
      ...findPatternViolations(
        pattern,
        content,
        "no_placeholder_tests",
        sectionType,
        PLACEHOLDER_MESSAGE,
      ),
    );
  }

  return violations;
}

// Rule 17: Test Traceability Integrity
export function checkTestTraceabilityIntegrity(
  content: string,
  sectionType: SectionType,
): HardOutputRuleViolation[] {
  const matrixRowPattern = /^\s*\|\s*(test\w+)\s*\|/gm;
  const matrixTestNames: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = matrixRowPattern.exec(content)) !== null) {
    matrixTestNames.push(match[1]);
  }

  if (matrixTestNames.length === 0) return [];

  // source: bug found 2026-07-15, e2e run run_mrlqa0aj_u2rh15 — a testing
  // section for a bash script defined every coverage-table test as
  // `test_xxx() { ... }` and `function test_xxx() { ... }` inside fenced
  // code blocks (```bash and untagged), but the old pattern only matched
  // the Swift-style `func test_xxx(` keyword form, so every bash test was
  // reported as "no matching func found" even though it was defined.
  // Detection is language-agnostic: each pattern targets one function-
  // definition syntax; a name is "defined" if ANY pattern matches it,
  // independent of the fence's language tag (extractCodeBlocks is not
  // needed here — code block bodies are already part of `content`).
  const testFuncPatterns: readonly RegExp[] = [
    // Swift/Kotlin: func test_xxx(...)
    /func\s+(test\w+)\s*\(/g,
    // JS/TS/PHP/bash named-function keyword: function test_xxx(...)
    /function\s+(test\w+)\s*\(/g,
    // Python: def test_xxx(...)
    /def\s+(test\w+)\s*\(/g,
    // Rust: fn test_xxx(...)
    /fn\s+(test\w+)\s*\(/g,
    // Bash implicit-function form: test_xxx() { ... } / test_xxx () { ... }
    // (optional space before both the parens and the opening brace)
    //
    // `\b` is load-bearing, not decoration. This is the only pattern here with
    // no keyword prefix to anchor it, so without a boundary the engine restarts
    // at every embedded "test" and re-scans the identifier run from each one.
    // Measured on `"test".repeat(n)`: 2000 → 8.0 ms, 4000 → 30.8 ms,
    // 8000 → 122.4 ms, 16000 → 488.2 ms — quadratic (js/polynomial-redos).
    // A boundary cannot occur inside a run of word characters, so the restarts
    // collapse: flat at ≤0.1 ms across the same range.
    //
    // It also tightens the rule. `mytest_foo() {` used to register `test_foo`
    // as defined, so a matrix row naming `test_foo` passed traceability against
    // a function that is not it. Differential check over 65,290 lines of this
    // repo found 0 names that only the old form matched, so nothing real is
    // lost by requiring the boundary.
    /\b(test\w+)\s*\(\s*\)\s*\{/g,
    // Bash explicit "function" form without parens: function test_xxx { ... }
    /function\s+(test\w+)\s*\{/g,
  ];

  const definedTestNames = new Set<string>();
  for (const pattern of testFuncPatterns) {
    let funcMatch: RegExpExecArray | null;
    while ((funcMatch = pattern.exec(content)) !== null) {
      definedTestNames.add(funcMatch[1]);
    }
  }

  const violations: HardOutputRuleViolation[] = [];
  for (const matrixName of matrixTestNames) {
    if (!definedTestNames.has(matrixName)) {
      violations.push(
        makeViolation(
          "test_traceability_integrity",
          sectionType,
          `Test '${matrixName}' listed in traceability matrix but no matching func ${matrixName}() found in test code`,
          matrixName,
        ),
      );
    }
  }

  return violations;
}

// Document-Level Rule 17: Cross-Section Test Traceability
export function checkDocumentTestTraceability(
  sections: ReadonlyArray<{ type: SectionType; content: string }>,
): HardOutputRuleViolation[] {
  const testSections = sections.filter((s) => s.type === "testing");
  if (testSections.length === 0) return [];

  const combinedTestContent = testSections
    .map((s) => s.content)
    .join("\n\n");
  return checkTestTraceabilityIntegrity(combinedTestContent, "testing");
}
