/**
 * Contract tests for the audit-flag pipeline operations.
 *
 * Each `op*` function is a step in a rule's declarative pipeline: it reads from
 * and writes into a shared `vars` bag. The bag is the contract, so every
 * assertion below is on what a step leaves in `vars` — including the aliases
 * (`into`/`store_as`, `from`/`source`) that exist because the rule YAML uses
 * both spellings, and which are exactly the kind of thing that rots silently.
 *
 * `evaluateCondition` deserves the attention it gets here: it is a tiny
 * expression evaluator over untyped rule text, its unknown-token path resolves
 * to 0 rather than failing, and a malformed condition returns false. Those are
 * the paths that make a rule quietly never fire.
 */

import { describe, expect, it } from "vitest";
import type { AuditRule, SectionInput } from "../audit-flags/types.js";
import {
  evaluateCondition,
  interpolateVars,
  opCount,
  opCrossSectionPresence,
  opExtract,
  opExtractTable,
  opFlagIf,
  opRatio,
  opSimilarity,
} from "../audit-flags/pipeline-ops.js";

const op = (o: Record<string, unknown>) => o as unknown as AuditRule["pipeline"][number];

const RULE = {
  id: "R1",
  family: { code: "F", name: "f", display_name: "Fam", description: "", primary_persona: "" },
  name: "r",
  display_name: "Rule",
  description: "fallback description",
  type: "pattern",
  sections: [],
  detect: [],
  suppress: [],
  pipeline: [],
  claim_count: "",
  suggested_action: "act",
} as unknown as AuditRule;

const sections = [
  { type: "requirements", content: "FR-1 alpha\nFR-2 beta" },
  { type: "testing", content: "AC-1 covers FR-1" },
] as unknown as readonly SectionInput[];

describe("opCrossSectionPresence", () => {
  it("counts source and target hits into their own vars", () => {
    const vars: Record<string, unknown> = {};
    opCrossSectionPresence(
      op({
        source_sections: ["requirements"], source_pattern: "FR-\\d+",
        target_sections: ["testing"], target_pattern: "FR-\\d+",
      }),
      sections, vars,
    );
    expect(vars.source_found).toBe(2);
    expect(vars.target_found).toBe(1);
  });

  it("searches every section when the section lists are omitted", () => {
    const vars: Record<string, unknown> = {};
    opCrossSectionPresence(op({ source_pattern: "FR-\\d+", target_pattern: "AC-\\d+" }), sections, vars);
    expect(vars.source_found).toBe(3);
    expect(vars.target_found).toBe(1);
  });

  it("records zero rather than failing when nothing matches", () => {
    const vars: Record<string, unknown> = {};
    opCrossSectionPresence(op({ source_pattern: "ZZZ", target_pattern: "ZZZ" }), sections, vars);
    expect(vars.source_found).toBe(0);
    expect(vars.target_found).toBe(0);
  });
});

describe("opExtract", () => {
  it("stores every match under `into`", () => {
    const vars: Record<string, unknown> = {};
    opExtract(op({ pattern: "FR-\\d+", into: "frs" }), RULE, sections, vars);
    expect(vars.frs).toEqual(["FR-1", "FR-2", "FR-1"]);
  });

  it("accepts `store_as` as an alias for `into`", () => {
    const vars: Record<string, unknown> = {};
    opExtract(op({ pattern: "FR-\\d+", store_as: "frs" }), RULE, sections, vars);
    expect(vars.frs).toHaveLength(3);
  });

  it("stores an empty array when nothing matches", () => {
    const vars: Record<string, unknown> = {};
    opExtract(op({ pattern: "ZZZ", into: "none" }), RULE, sections, vars);
    expect(vars.none).toEqual([]);
  });

  it("respects the rule's own section filter", () => {
    const scoped = { ...RULE, sections: ["testing"] } as unknown as AuditRule;
    const vars: Record<string, unknown> = {};
    opExtract(op({ pattern: "FR-\\d+", into: "frs" }), scoped, sections, vars);
    expect(vars.frs).toEqual(["FR-1"]);
  });
});

describe("opExtractTable", () => {
  const tabular = [
    { type: "requirements", content: "| ID | Name |\n|----|----|\n| 1 | a |\nnot a row" },
  ] as unknown as readonly SectionInput[];

  it("collects the pipe rows when the header pattern is present", () => {
    const vars: Record<string, unknown> = {};
    opExtractTable(op({ header_pattern: "\\| ID \\|", into: "rows" }), RULE, tabular, vars);
    expect(vars.rows).toEqual(["| ID | Name |", "|----|----|", "| 1 | a |"]);
  });

  it("stores an empty array when the header is absent", () => {
    const vars: Record<string, unknown> = {};
    opExtractTable(op({ header_pattern: "\\| NOPE \\|", into: "rows" }), RULE, tabular, vars);
    expect(vars.rows).toEqual([]);
  });
});

describe("opCount", () => {
  it("counts an array and mirrors it into total", () => {
    const vars: Record<string, unknown> = { items: ["a", "b", "c"] };
    opCount(op({ from: "items", into: "n" }), vars);
    expect(vars.n).toBe(3);
    expect(vars.total).toBe(3);
  });

  it("accepts the source/store_as aliases", () => {
    const vars: Record<string, unknown> = { items: ["a"] };
    opCount(op({ source: "items", store_as: "n" }), vars);
    expect(vars.n).toBe(1);
  });

  it("counts a missing or non-array source as zero", () => {
    const vars: Record<string, unknown> = { notAnArray: 7 };
    opCount(op({ from: "notAnArray", into: "n" }), vars);
    expect(vars.n).toBe(0);
    const vars2: Record<string, unknown> = {};
    opCount(op({ from: "absent", into: "n" }), vars2);
    expect(vars2.n).toBe(0);
  });
});

describe("opSimilarity", () => {
  it("counts pairs at or above the threshold", () => {
    const vars: Record<string, unknown> = { items: ["the quick fox", "the quick fox", "utterly different"] };
    opSimilarity(op({ from: "items", threshold: 0.9 }), vars);
    expect(vars.similar_count).toBe(1);
  });

  it("counts nothing when every pair is dissimilar", () => {
    const vars: Record<string, unknown> = { items: ["alpha", "beta", "gamma"] };
    opSimilarity(op({ from: "items", threshold: 0.9 }), vars);
    expect(vars.similar_count).toBe(0);
  });

  it("is zero for fewer than two items", () => {
    for (const items of [[], ["only one"]]) {
      const vars: Record<string, unknown> = { items };
      opSimilarity(op({ from: "items" }), vars);
      expect(vars.similar_count).toBe(0);
    }
  });

  it("is zero when the source is not an array", () => {
    const vars: Record<string, unknown> = { items: "nope" };
    opSimilarity(op({ from: "items" }), vars);
    expect(vars.similar_count).toBe(0);
  });

  it("defaults the threshold to 0.8 when unspecified", () => {
    // Identical strings are similarity 1.0, so they pass any default ≤ 1.
    const vars: Record<string, unknown> = { items: ["same words here", "same words here"] };
    opSimilarity(op({ from: "items" }), vars);
    expect(vars.similar_count).toBe(1);
  });
});

describe("opRatio", () => {
  it("computes the matching share, case-insensitively", () => {
    const vars: Record<string, unknown> = { verdicts: ["PASS", "pass", "FAIL", "FAIL"] };
    opRatio(op({ numerator_from: "verdicts", numerator_match: "pass" }), vars);
    expect(vars.pass_rate).toBe(0.5);
    expect(vars.total).toBe(4);
  });

  it("is zero over an empty list rather than NaN", () => {
    const vars: Record<string, unknown> = { verdicts: [] };
    opRatio(op({ numerator_from: "verdicts", numerator_match: "PASS" }), vars);
    expect(vars.pass_rate).toBe(0);
    expect(vars.total).toBe(0);
  });

  it("leaves vars untouched when the source is not an array", () => {
    const vars: Record<string, unknown> = { verdicts: "PASS" };
    opRatio(op({ numerator_from: "verdicts", numerator_match: "PASS" }), vars);
    expect(vars.pass_rate).toBeUndefined();
  });
});

describe("evaluateCondition", () => {
  const vars = { n: 5, zero: 0 };

  it.each([
    ["n > 3", true], ["n > 5", false],
    ["n >= 5", true], ["n <= 5", true],
    ["n < 10", true], ["n < 5", false],
    ["n == 5", true], ["n == 6", false],
    ["n != 6", true], ["n != 5", false],
  ])("evaluates %s as %s", (cond, expected) => {
    expect(evaluateCondition(cond, vars)).toBe(expected);
  });

  it("requires every AND clause to hold", () => {
    expect(evaluateCondition("n > 1 AND n < 10", vars)).toBe(true);
    expect(evaluateCondition("n > 1 AND n > 99", vars)).toBe(false);
  });

  it("matches AND case-insensitively", () => {
    expect(evaluateCondition("n > 1 and n < 10", vars)).toBe(true);
  });

  it("compares two variables, not only a variable and a literal", () => {
    expect(evaluateCondition("n > zero", vars)).toBe(true);
  });

  it("resolves an unknown token to 0 rather than throwing", () => {
    expect(evaluateCondition("missing == 0", vars)).toBe(true);
    expect(evaluateCondition("missing > 0", vars)).toBe(false);
  });

  it("treats a non-numeric variable as 0", () => {
    expect(evaluateCondition("s == 0", { s: "text" })).toBe(true);
  });

  it("returns false for an expression with no operator", () => {
    expect(evaluateCondition("just words", vars)).toBe(false);
  });
});

describe("interpolateVars", () => {
  it("substitutes a named variable", () => {
    expect(interpolateVars("count is {n}", { n: 3 })).toBe("count is 3");
  });

  it("rounds a number to two decimals", () => {
    expect(interpolateVars("{r}", { r: 0.666666 })).toBe("0.67");
  });

  it("leaves the placeholder in place when the variable is absent", () => {
    expect(interpolateVars("{missing}", {})).toBe("{missing}");
  });

  it("stringifies a non-number", () => {
    expect(interpolateVars("{s}", { s: "text" })).toBe("text");
  });

  it("substitutes every placeholder in the template", () => {
    expect(interpolateVars("{a} and {b}", { a: 1, b: 2 })).toBe("1 and 2");
  });

  it("accepts the format-suffix syntax", () => {
    expect(interpolateVars("{r:.2f}", { r: 0.5 })).toBe("0.5");
  });
});

describe("opFlagIf", () => {
  it("returns a finding when the condition holds", () => {
    const f = opFlagIf(op({ condition: "n > 1", finding: "saw {n}" }), RULE, { n: 4 });
    expect(f).not.toBeNull();
    expect(f!.message).toBe("saw 4");
    expect(f!.ruleId).toBe("R1");
    expect(f!.matchCount).toBe(1);
  });

  it("returns null when the condition does not hold", () => {
    expect(opFlagIf(op({ condition: "n > 99", finding: "x" }), RULE, { n: 4 })).toBeNull();
  });

  it("falls back to the rule description when no finding template is given", () => {
    const f = opFlagIf(op({ condition: "n > 1" }), RULE, { n: 4 });
    expect(f!.message).toBe("fallback description");
  });
});
