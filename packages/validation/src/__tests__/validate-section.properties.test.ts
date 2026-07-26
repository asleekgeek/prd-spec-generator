/**
 * Property-based tests for `validateSection` (issue #36, Scorecard FuzzingID).
 *
 * Why properties and not more examples: this function is fed LLM output. The
 * input space is "any string a model might emit", which no example table
 * enumerates — the repo already learned this the expensive way when `[:<≤<=]`
 * silently never matched `<=` and an unanchored pattern matched `test_foo`
 * inside `mytest_foo` (see regex-hardening.test.ts). Both were reachable by
 * ordinary inputs nobody had thought to write down. fast-check generates the
 * inputs nobody thought to write down, and shrinks a failure to its minimal
 * reproducer.
 *
 * Each property below is an invariant of the CONTRACT, not of any one rule, so
 * adding a rule cannot quietly invalidate them. Deliberately no wall-clock
 * assertion lives here: growth is pinned by ratio in regex-hardening.test.ts,
 * and duplicating it as a timing bound is the flake generator that file's
 * header warns about.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateSection } from "../index.js";

/**
 * Every section type the rule map accepts.
 * source: SECTION_RULES keys in ../hard-output-rules/rule-mapping.ts.
 */
const SECTION_TYPES = [
  "requirements",
  "user_stories",
  "technical_specification",
  "data_model",
  "api_specification",
  "security_considerations",
  "testing",
  "timeline",
  "deployment",
  "acceptance_criteria",
  "performance_requirements",
  "risks",
  "overview",
  "goals",
  "source_code",
  "test_code",
  "jira_tickets",
] as const;

const anySection = fc.constantFrom(...SECTION_TYPES);

/**
 * Content generator biased toward the shapes that actually break parsers:
 * markdown scaffolding, the NFR/verdict vocabulary the rules key on, unicode
 * comparison operators, and repetition (the ReDoS-adjacent shape). Plain
 * `fc.string()` alone would spend most of its budget on inputs no rule looks at.
 */
const anyContent = fc.oneof(
  fc.string(),
  fc.string({ unit: "grapheme", maxLength: 400 }),
  fc.array(
    fc.constantFrom(
      "## Verification",
      "Verdict: PASS",
      "Verdict: FAIL",
      "p95 <= 200",
      "p95 ≤ 200",
      "latency < 1",
      "| test_a |",
      "```bash",
      "```",
      "//TODO",
      "storypoints",
      "func testa(){",
      "- [ ] AC-001",
      "|",
      "\t",
      " ",
      "",
    ),
    { maxLength: 60 },
  ).map((parts) => parts.join("\n")),
);

describe("validateSection — contract properties", () => {
  it("never throws, for any content in any section", () => {
    fc.assert(
      fc.property(anyContent, anySection, (content, section) => {
        validateSection(content, section);
      }),
      { numRuns: 300 },
    );
  });

  it("always reports a score within [0, 1]", () => {
    fc.assert(
      fc.property(anyContent, anySection, (content, section) => {
        const { totalScore } = validateSection(content, section);
        expect(Number.isFinite(totalScore)).toBe(true);
        expect(totalScore).toBeGreaterThanOrEqual(0);
        expect(totalScore).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it("passes exactly the checked rules it did not violate", () => {
    fc.assert(
      fc.property(anyContent, anySection, (content, section) => {
        const report = validateSection(content, section);
        const checked = new Set(report.rulesChecked);
        const violated = new Set(report.violations.map((v) => v.rule));

        // Nothing is reported outside the set of rules actually run.
        for (const rule of report.rulesPassed) expect(checked.has(rule)).toBe(true);
        for (const rule of violated) expect(checked.has(rule)).toBe(true);
        // A rule cannot be both passed and violated in the same report.
        for (const rule of report.rulesPassed) expect(violated.has(rule)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("reports hasCriticalViolations iff some violation is critical", () => {
    fc.assert(
      fc.property(anyContent, anySection, (content, section) => {
        const report = validateSection(content, section);
        expect(report.hasCriticalViolations).toBe(report.violations.some((v) => v.isCritical));
      }),
      { numRuns: 300 },
    );
  });

  it("is deterministic — the same input yields the same verdict", () => {
    fc.assert(
      fc.property(anyContent, anySection, (content, section) => {
        const first = validateSection(content, section);
        const second = validateSection(content, section);
        // `checkedAt` is a timestamp and is expected to differ; everything a
        // caller decides on must not.
        expect(second.violations).toStrictEqual(first.violations);
        expect(second.rulesPassed).toStrictEqual(first.rulesPassed);
        expect(second.totalScore).toBe(first.totalScore);
        expect(second.hasCriticalViolations).toBe(first.hasCriticalViolations);
      }),
      { numRuns: 200 },
    );
  });

  it("echoes back the section type it was asked about", () => {
    fc.assert(
      fc.property(anyContent, anySection, (content, section) => {
        expect(validateSection(content, section).sectionType).toBe(section);
      }),
      { numRuns: 200 },
    );
  });
});
