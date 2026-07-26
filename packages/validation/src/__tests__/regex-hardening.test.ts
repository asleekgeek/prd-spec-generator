/**
 * Regressions for the CodeQL regex findings closed alongside this file.
 *
 * Two kinds of assertion live here, and they are different in nature:
 *
 *  - BEHAVIOUR: two of the flagged patterns were not merely slow, they were
 *    wrong. `[:<≤<=]` never matched the `<=` operator, and the unanchored
 *    bash-function pattern matched `test_foo` inside `mytest_foo`. Those get
 *    ordinary contract tests, each of which fails on the pre-fix code.
 *
 *  - COMPLEXITY: the three polynomial patterns are pinned by GROWTH, not by a
 *    wall-clock threshold. Asserting "under N ms" on a shared CI runner is a
 *    flake generator; asserting that doubling the input does not quadruple the
 *    time is the actual property (quadratic → ~4x, linear → ~1x per doubling),
 *    and it holds regardless of how loaded the machine is. The headroom below
 *    is deliberately wide — it is there to catch a reintroduced O(n²), not to
 *    measure performance.
 */

import { describe, expect, it } from "vitest";
import { validateSection } from "../index.js";

/**
 * Median wall-clock of `run` over `samples` iterations, in milliseconds.
 * Median rather than mean: one descheduled iteration should not move it.
 */
function medianMs(run: () => void, samples = 5): number {
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    run();
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)];
}

/**
 * Assert that doubling the input length does not multiply the time by ~4.
 *
 * A quadratic pattern lands near 4.0; a linear one near 1.0. The 2.5 ceiling
 * sits between them with room for scheduler noise on a loaded runner.
 * source: measured pre-fix growth of the three patterns in this repo (each
 * ~3.9–4.0x per doubling; see the comments at their definitions).
 */
const QUADRATIC_GROWTH_CEILING = 2.5;

function expectSubQuadratic(build: (n: number) => string, section: Parameters<typeof validateSection>[1]): void {
  const base = 4000;
  const small = build(base);
  const large = build(base * 2);
  // Warm the JIT so the first sample does not carry compilation cost.
  validateSection(small, section);
  const tSmall = medianMs(() => validateSection(small, section));
  const tLarge = medianMs(() => validateSection(large, section));
  // A floor guards against dividing two sub-millisecond timings, where noise
  // dominates and the ratio is meaningless.
  const ratio = tLarge / Math.max(tSmall, 0.5);
  expect(ratio).toBeLessThan(QUADRATIC_GROWTH_CEILING);
}

describe("NFR operator matching — js/regex/duplicate-in-character-class", () => {
  // The old class `[:<≤<=]` is a SET, so the two-character `<=` was
  // unreachable: every NFR written the ordinary way escaped the rule.
  const withVerdicts = (nfr: string) =>
    ["## Verification", "", nfr, "", "Verdict: PASS", "Verdict: PASS", ""].join("\n");

  it.each(["p95 <= 200", "latency <= 300", "response time <= 1"])(
    "treats %s as an NFR (fails pre-fix: `<=` never matched)",
    (nfr) => {
      const report = validateSection(withVerdicts(nfr), "performance_requirements");
      const flagged = report.violations.some(
        (v) => v.rule === "honest_verification_verdicts",
      );
      expect(flagged).toBe(true);
    },
  );

  it.each(["p95 < 200", "p95 ≤ 200", "p95: 200", "p95 = 200"])(
    "still treats %s as an NFR (operators the old class already matched)",
    (nfr) => {
      const report = validateSection(withVerdicts(nfr), "performance_requirements");
      const flagged = report.violations.some(
        (v) => v.rule === "honest_verification_verdicts",
      );
      expect(flagged).toBe(true);
    },
  );

  it("does not treat an unrelated comparison as an NFR", () => {
    const report = validateSection(withVerdicts("p99 >= 5"), "performance_requirements");
    const flagged = report.violations.some(
      (v) => v.rule === "honest_verification_verdicts",
    );
    expect(flagged).toBe(false);
  });
});

describe("bash test-function detection — word boundary", () => {
  const matrixRow = (name: string) => `| ${name} | covers AC-1 |`;

  it("counts test_foo() as defining test_foo", () => {
    const content = [
      matrixRow("test_foo"),
      "```bash",
      "test_foo() {",
      "  assert_true",
      "}",
      "```",
    ].join("\n");
    const report = validateSection(content, "testing");
    const missing = report.violations.filter(
      (v) => v.rule === "test_traceability_integrity",
    );
    expect(missing).toHaveLength(0);
  });

  it("does NOT accept mytest_foo() as defining test_foo (fails pre-fix)", () => {
    const content = [
      matrixRow("test_foo"),
      "```bash",
      "mytest_foo() {",
      "  assert_true",
      "}",
      "```",
    ].join("\n");
    const report = validateSection(content, "testing");
    const missing = report.violations.filter(
      (v) => v.rule === "test_traceability_integrity",
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].offendingContent).toBe("test_foo");
  });
});

// The third flagged pattern, `typeKeywordPattern`, is deliberately NOT pinned
// here. Its quadratic witness is a run of newlines, and its caller splits the
// code block on "\n" before testing, so no reachable input ever contains one —
// a growth test through `validateSection` passes on the PRE-fix code too, which
// makes it a test that asserts nothing. The `(?:^|\n)` → `^` change is still
// correct (it deletes an unreachable alternative and the ambiguity CodeQL
// flagged), but the hazard it removes is latent, not live, and pretending
// otherwise with a green-either-way test would be worse than saying so.
describe("polynomial-ReDoS patterns stay sub-quadratic", () => {
  it("modifier runs on a declaration line (typeStartPattern)", () => {
    expectSubQuadratic(
      (n) => ["```kotlin", "abstract ".repeat(n), "```"].join("\n"),
      "technical_specification",
    );
  });

  it("identifier runs in test code (bash function pattern)", () => {
    expectSubQuadratic((n) => ["| test_a |", "```bash", "test".repeat(n), "```"].join("\n"), "testing");
  });

  // The three witnesses below are CodeQL's own, taken verbatim from the
  // js/polynomial-redos report. Each measured 3.9x–4.0x per doubling before
  // the fix; the shared `findPatternViolations` call site was the reported
  // location, but the quadratic lived in the patterns passed to it.
  it("near-miss runs in one SP table cell (sp_not_in_fr_table)", () => {
    expectSubQuadratic((n) => "|storypoint" + "storypoints".repeat(n), "requirements");
  });

  it("comment runs in an unterminated test body (no_placeholder_tests)", () => {
    expectSubQuadratic((n) => "func testa(){{//TODO" + "//TODO".repeat(n), "testing");
  });

  it("space runs after a matrix row's third cell (no_placeholder_tests)", () => {
    expectSubQuadratic((n) => "|testa||" + " ".repeat(n), "testing");
  });
});

describe("SP-in-FR-table detection is row-scoped", () => {
  const spViolations = (content: string) =>
    validateSection(content, "requirements").violations.filter(
      (v) => v.rule === "sp_not_in_fr_table",
    );

  // Pre-fix, `\s` and `[^|]` both matched `\n`, so the greedy cell loop ran to
  // the LAST SP cell in the section and reported ONE violation whose evidence
  // spanned every row in between. Two offending rows are two violations.
  it("reports one violation per offending row (fails pre-fix: coalesced to 1)", () => {
    const content = [
      "| ID | Story Points |",
      "|---|---|",
      "| FR-002 | Story Points |",
    ].join("\n");
    expect(spViolations(content)).toHaveLength(2);
  });

  it("carries only its own row as evidence (fails pre-fix: evidence spanned rows)", () => {
    const content = [
      "| ID | Story Points |",
      "|---|---|",
      "| FR-002 | Story Points |",
    ].join("\n");
    expect(spViolations(content).map((v) => v.offendingContent)).toEqual([
      "| ID | Story Points |",
      "| FR-002 | Story Points |",
    ]);
  });

  it.each([
    ["| ID | Story Points |", "canonical spelling"],
    ["| ID | story  points |", "lowercase, double space"],
    ["  | ID | StoryPoint |", "indented, singular, no space"],
    ["| ID | Story\tPoints |", "tab between the words"],
  ])("still flags %s (%s)", (row) => {
    expect(spViolations(row)).toHaveLength(1);
  });

  it.each([
    ["| ID | Title | Priority |", "table with no SP column"],
    ["Story Points are tracked in the roadmap.", "prose, not a table row"],
    ["|---|---|", "separator row"],
  ])("does not flag %s (%s)", (row) => {
    expect(spViolations(row)).toHaveLength(0);
  });
});

describe("placeholder-test detection", () => {
  const placeholderViolations = (content: string) =>
    validateSection(content, "testing").violations.filter(
      (v) => v.rule === "no_placeholder_tests",
    );

  it.each([
    ["func testA() { // TODO }", "TODO body"],
    ["func testA() { // FIXME }", "FIXME body"],
    ["func testA() throws { // PLACEHOLDER }", "PLACEHOLDER body, throws"],
    ["func testA() { func testB() { //TODO } }", "comment in a nested brace run"],
  ])("flags %s (%s)", (content) => {
    expect(placeholderViolations(content)).toHaveLength(1);
  });

  it.each([
    ["func testA() { assertTrue(x) }", "real body"],
    ["func testA() { no todo } func testB() { assert() }", "two real bodies"],
  ])("does not flag %s (%s)", (content) => {
    expect(placeholderViolations(content)).toHaveLength(0);
  });

  it("flags only the placeholder among several test funcs", () => {
    const content = "func testA() { assert() } func testB() { // TODO }";
    const violations = placeholderViolations(content);
    expect(violations).toHaveLength(1);
    expect(violations[0].offendingContent).toContain("testB");
  });

  it.each([
    "| test_a | covers AC-1 | // TODO",
    "| test_a | covers AC-1 | ` // TODO",
    "| test_a | covers AC-1 |   `   // Setup",
  ])("flags the matrix row %s", (row) => {
    expect(placeholderViolations(row)).toHaveLength(1);
  });

  // The one behavioural delta the differential found: `\s` matched `\n`, so a
  // comment on the NEXT line was read as the row's own third cell. A markdown
  // row cannot wrap, so this was a false positive, not a lost detection.
  it("does not flag a comment on the line AFTER the row (fails pre-fix)", () => {
    expect(placeholderViolations("| test_a | covers AC-1 |\n// TODO")).toHaveLength(0);
  });
});
