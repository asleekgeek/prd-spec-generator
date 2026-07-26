/**
 * Contract tests for the audit-flag helpers.
 *
 * These are the primitives every audit rule is built from: regex application,
 * section filtering, line arithmetic, and suppression-scope resolution. They
 * are small and pure, and two of them swallow exceptions by design
 * (`testRegex` / `hasMatch` return empty/false on an invalid pattern rather
 * than throwing, because rule patterns come from YAML written by humans). That
 * swallow is the interesting behaviour: without a test it is indistinguishable
 * from a rule that silently never fires.
 */

import { describe, expect, it } from "vitest";
import type { AuditRule } from "../audit-flags/types.js";
import {
  combineSections,
  getLineIndex,
  getNearbyLines,
  getRowAtIndex,
  hasMatch,
  isSuppressedAtMatch,
  makeFinding,
  sectionMatchesRule,
  testRegex,
} from "../audit-flags/helpers.js";

describe("testRegex", () => {
  it("returns every match, not just the first", () => {
    expect(testRegex("a", "a b a b a")).toHaveLength(3);
  });

  it("applies multiline semantics so ^ anchors per line", () => {
    expect(testRegex("^x", "x\ny\nx")).toHaveLength(2);
  });

  it("returns [] rather than throwing on an invalid pattern", () => {
    expect(testRegex("([unclosed", "anything")).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    expect(testRegex("zzz", "abc")).toEqual([]);
  });

  it("exposes capture groups on each match", () => {
    const [m] = testRegex("a(b)c", "abc");
    expect(m[1]).toBe("b");
  });
});

describe("hasMatch", () => {
  it("is true when the pattern occurs", () => {
    expect(hasMatch("b", "abc")).toBe(true);
  });

  it("is false when it does not", () => {
    expect(hasMatch("z", "abc")).toBe(false);
  });

  it("returns false rather than throwing on an invalid pattern", () => {
    expect(hasMatch("([unclosed", "abc")).toBe(false);
  });

  it("anchors per line, like testRegex", () => {
    expect(hasMatch("^second", "first\nsecond")).toBe(true);
  });
});

describe("sectionMatchesRule", () => {
  it("treats an empty rule-section list as 'applies everywhere'", () => {
    expect(sectionMatchesRule("requirements", [])).toBe(true);
  });

  it("matches when the section is listed", () => {
    expect(sectionMatchesRule("requirements", ["requirements", "testing"])).toBe(true);
  });

  it("does not match when it is absent", () => {
    expect(sectionMatchesRule("requirements", ["testing"])).toBe(false);
  });
});

describe("combineSections", () => {
  const sections = [
    { type: "requirements", content: "R" },
    { type: "testing", content: "T" },
  ] as const;

  it("joins every section when the filter is empty", () => {
    expect(combineSections(sections as never, [])).toBe("R\n\nT");
  });

  it("keeps only the filtered types, in input order", () => {
    expect(combineSections(sections as never, ["testing"])).toBe("T");
  });

  it("returns an empty string when nothing survives the filter", () => {
    expect(combineSections(sections as never, ["risks"])).toBe("");
  });

  it("returns an empty string for no sections at all", () => {
    expect(combineSections([], [])).toBe("");
  });
});

describe("getLineIndex", () => {
  const text = "zero\none\ntwo";

  it("is 0 before the first newline", () => {
    expect(getLineIndex(text, 0)).toBe(0);
    expect(getLineIndex(text, 3)).toBe(0);
  });

  it("counts the newlines before the index", () => {
    expect(getLineIndex(text, text.indexOf("one"))).toBe(1);
    expect(getLineIndex(text, text.indexOf("two"))).toBe(2);
  });

  it("clamps an index past the end to the final line", () => {
    expect(getLineIndex(text, 9999)).toBe(2);
  });

  it("is 0 for empty text", () => {
    expect(getLineIndex("", 5)).toBe(0);
  });
});

describe("getRowAtIndex", () => {
  const lines = ["a", "b", "c"];

  it("returns the addressed row", () => {
    expect(getRowAtIndex(lines, 1)).toBe("b");
  });

  it("returns an empty string out of range rather than undefined", () => {
    expect(getRowAtIndex(lines, 99)).toBe("");
    expect(getRowAtIndex(lines, -1)).toBe("");
  });
});

describe("getNearbyLines", () => {
  const lines = ["0", "1", "2", "3", "4"];

  it("returns the window either side of the line", () => {
    expect(getNearbyLines(lines, 2, 1)).toBe("1\n2\n3");
  });

  it("clamps at the start", () => {
    expect(getNearbyLines(lines, 0, 2)).toBe("0\n1\n2");
  });

  it("clamps at the end", () => {
    expect(getNearbyLines(lines, 4, 2)).toBe("2\n3\n4");
  });

  it("returns just the line at radius 0", () => {
    expect(getNearbyLines(lines, 2, 0)).toBe("2");
  });

  it("returns everything when the radius exceeds the text", () => {
    expect(getNearbyLines(lines, 2, 99)).toBe("0\n1\n2\n3\n4");
  });
});

describe("isSuppressedAtMatch", () => {
  const sup = (pattern: string, scope: string) => ({ pattern, scope, description: "" });
  const content = "alpha\nbeta MATCH\ngamma\ndelta\nepsilon";
  const matchIndex = content.indexOf("MATCH");

  it("is false when there are no suppressors", () => {
    expect(isSuppressedAtMatch([], content, matchIndex, content)).toBe(false);
  });

  it("same_row suppresses only from the matching line", () => {
    expect(isSuppressedAtMatch([sup("beta", "same_row")], content, matchIndex, content)).toBe(true);
    expect(isSuppressedAtMatch([sup("gamma", "same_row")], content, matchIndex, content)).toBe(false);
  });

  it("same_section searches the whole section", () => {
    expect(isSuppressedAtMatch([sup("epsilon", "same_section")], content, matchIndex, content)).toBe(true);
  });

  it("any_section searches the combined document, not the section", () => {
    const all = content + "\n\nomega";
    expect(isSuppressedAtMatch([sup("omega", "any_section")], content, matchIndex, all)).toBe(true);
    expect(isSuppressedAtMatch([sup("omega", "same_section")], content, matchIndex, all)).toBe(false);
  });

  it("nearby_lines_N honours the radius", () => {
    // match is on line 1; gamma is line 2, epsilon is line 4.
    expect(isSuppressedAtMatch([sup("gamma", "nearby_lines_1")], content, matchIndex, content)).toBe(true);
    expect(isSuppressedAtMatch([sup("epsilon", "nearby_lines_1")], content, matchIndex, content)).toBe(false);
    expect(isSuppressedAtMatch([sup("epsilon", "nearby_lines_3")], content, matchIndex, content)).toBe(true);
  });

  it("falls back to same_section for an unrecognised scope", () => {
    expect(isSuppressedAtMatch([sup("epsilon", "nonsense")], content, matchIndex, content)).toBe(true);
  });

  it("suppresses if ANY suppressor matches", () => {
    const s = [sup("nope", "same_section"), sup("epsilon", "same_section")];
    expect(isSuppressedAtMatch(s, content, matchIndex, content)).toBe(true);
  });

  it("does not suppress when an invalid suppressor pattern is the only one", () => {
    expect(isSuppressedAtMatch([sup("([bad", "same_section")], content, matchIndex, content)).toBe(false);
  });
});

describe("makeFinding", () => {
  const rule = {
    id: "R1",
    family: { code: "F", name: "fam", display_name: "Family", description: "", primary_persona: "" },
    name: "r",
    display_name: "Rule One",
    description: "",
    type: "pattern",
    sections: [],
    detect: [],
    suppress: [],
    pipeline: [],
    claim_count: "",
    suggested_action: "do the thing",
  } as unknown as AuditRule;

  it("carries the rule identity and the caller's message through", () => {
    const f = makeFinding(rule, 3, "msg");
    expect(f).toMatchObject({
      ruleId: "R1",
      familyCode: "F",
      familyName: "Family",
      ruleName: "Rule One",
      message: "msg",
      suggestedAction: "do the thing",
      matchCount: 3,
    });
  });

  it("defaults severity to warning when the rule declares none", () => {
    expect(makeFinding(rule, 1, "m").severity).toBe("warning");
  });

  it("uses the rule's severity when it declares one", () => {
    const critical = { ...rule, severity: "critical" } as unknown as AuditRule;
    expect(makeFinding(critical, 1, "m").severity).toBe("critical");
  });
});
