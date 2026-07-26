/**
 * Contract tests for cross-reference validation.
 *
 * `validateCrossReferences` answers five independent questions about a PRD:
 * are references dangling, are definitions orphaned, do dependencies cycle, is
 * the numbering continuous, and are any IDs defined twice. Each gets its own
 * block, because a change that breaks one should not be able to hide behind
 * another still passing.
 *
 * The definition/reference distinction is positional — an ID is a DEFINITION
 * when it starts its line, follows a table pipe, or follows a heading marker,
 * and a REFERENCE anywhere else. That rule is the load-bearing one: get it
 * wrong and every dangling/orphan verdict inverts, so it is pinned directly.
 */

import { describe, expect, it } from "vitest";
import { validateCrossReferences } from "../cross-ref-validator.js";

const s = (name: string, content: string) => ({ name, content });

describe("definition vs reference detection", () => {
  it("treats an ID at the start of a line as a definition", () => {
    const r = validateCrossReferences([s("req", "FR-1 the system does a thing")]);
    expect(r.danglingReferences).toEqual([]);
  });

  it("treats an ID after a table pipe as a definition", () => {
    const r = validateCrossReferences([s("req", "| FR-1 | a thing |")]);
    expect(r.danglingReferences).toEqual([]);
  });

  it("treats an ID in a heading as a definition", () => {
    const r = validateCrossReferences([s("req", "## FR-1 a thing")]);
    expect(r.danglingReferences).toEqual([]);
  });

  it("treats an ID mid-sentence as a reference, so it dangles when undefined", () => {
    const r = validateCrossReferences([s("test", "this verifies FR-9 fully")]);
    expect(r.danglingReferences.map((d) => d.id)).toEqual(["FR-9"]);
  });
});

describe("dangling references", () => {
  it("reports an ID referenced but never defined, with where and what type", () => {
    const r = validateCrossReferences([s("testing", "covers AC-3 here")]);
    expect(r.danglingReferences).toHaveLength(1);
    expect(r.danglingReferences[0]).toMatchObject({ id: "AC-3", type: "AC" });
    expect(r.danglingReferences[0].referencedIn).toContain("testing");
    expect(r.isValid).toBe(false);
  });

  it("reports none when every referenced ID is defined somewhere", () => {
    const r = validateCrossReferences([
      s("req", "FR-1 a thing"),
      s("test", "covers FR-1"),
    ]);
    expect(r.danglingReferences).toEqual([]);
  });

  it("names every section a dangling ID was referenced from", () => {
    const r = validateCrossReferences([
      s("a", "see FR-7"),
      s("b", "also FR-7"),
    ]);
    expect(r.danglingReferences[0].referencedIn).toContain("a");
    expect(r.danglingReferences[0].referencedIn).toContain("b");
  });
});

describe("orphan definitions", () => {
  it("flags a definition never referenced from another section", () => {
    const r = validateCrossReferences([s("req", "FR-1 a lonely requirement")]);
    expect(r.orphanNodes.map((o) => o.id)).toEqual(["FR-1"]);
    expect(r.orphanNodes[0].type).toBe("FR");
    expect(r.orphanNodes[0].reason).toMatch(/not referenced/i);
  });

  it("does not flag a definition referenced from a second section", () => {
    const r = validateCrossReferences([
      s("req", "FR-1 a thing"),
      s("test", "covers FR-1"),
    ]);
    expect(r.orphanNodes).toEqual([]);
  });

  it("still flags a definition referenced only inside its own section", () => {
    const r = validateCrossReferences([s("req", "FR-1 a thing\nrelated to FR-1 again")]);
    expect(r.orphanNodes.map((o) => o.id)).toEqual(["FR-1"]);
  });

  it("an orphan alone does not make the document invalid", () => {
    const r = validateCrossReferences([s("req", "FR-1 a lonely requirement")]);
    expect(r.orphanNodes).toHaveLength(1);
    expect(r.isValid).toBe(true);
  });
});

describe("dependency cycles", () => {
  it("detects a two-node cycle", () => {
    const r = validateCrossReferences([
      s("req", "FR-1 first\nDepends On: FR-2\nFR-2 second\nDepends On: FR-1"),
    ]);
    expect(r.cycles.length).toBeGreaterThan(0);
    expect(r.isValid).toBe(false);
  });

  it("reports no cycle for a linear dependency chain", () => {
    const r = validateCrossReferences([
      s("req", "FR-1 first\nFR-2 second\nDepends On: FR-1"),
    ]);
    expect(r.cycles).toEqual([]);
  });

  it("accepts the lowercase spelling of the marker", () => {
    const r = validateCrossReferences([
      s("req", "FR-1 first\nDepends on: FR-2\nFR-2 second\nDepends on: FR-1"),
    ]);
    expect(r.cycles.length).toBeGreaterThan(0);
  });

  it("reports no cycle when nothing declares a dependency", () => {
    const r = validateCrossReferences([s("req", "FR-1 a\nFR-2 b")]);
    expect(r.cycles).toEqual([]);
  });
});

describe("numbering continuity", () => {
  it("reports the gap when a number is skipped", () => {
    const r = validateCrossReferences([s("req", "FR-1 a\nFR-3 c")]);
    expect(r.numberingGaps).toHaveLength(1);
    expect(r.numberingGaps[0]).toMatchObject({ expected: 2, actual: 3 });
  });

  it("reports nothing for a contiguous run", () => {
    const r = validateCrossReferences([s("req", "FR-1 a\nFR-2 b\nFR-3 c")]);
    expect(r.numberingGaps).toEqual([]);
  });

  it("checks each prefix independently", () => {
    const r = validateCrossReferences([s("req", "FR-1 a\nFR-2 b\nAC-1 x\nAC-5 y")]);
    expect(r.numberingGaps.map((g) => g.actual)).toEqual([5]);
  });

  it("a numbering gap alone does not make the document invalid", () => {
    const r = validateCrossReferences([s("req", "FR-1 a\nFR-3 c")]);
    expect(r.numberingGaps).toHaveLength(1);
    expect(r.isValid).toBe(true);
  });
});

describe("duplicate definitions", () => {
  it("reports an ID defined twice", () => {
    const r = validateCrossReferences([
      s("a", "FR-1 first definition"),
      s("b", "FR-1 second definition"),
    ]);
    expect(r.duplicateIds).toEqual(["FR-1"]);
    expect(r.isValid).toBe(false);
  });

  it("does not count a reference as a second definition", () => {
    const r = validateCrossReferences([
      s("a", "FR-1 the definition"),
      s("b", "this covers FR-1"),
    ]);
    expect(r.duplicateIds).toEqual([]);
  });
});

describe("supported ID prefixes and empty input", () => {
  it.each(["FR", "AC", "US", "STORY", "TEST", "OQ", "RISK", "NFR"])(
    "recognises %s-n",
    (prefix) => {
      const r = validateCrossReferences([s("x", `refers to ${prefix}-2 here`)]);
      expect(r.danglingReferences.map((d) => d.id)).toEqual([`${prefix}-2`]);
    },
  );

  it("does not match an unknown prefix", () => {
    const r = validateCrossReferences([s("x", "refers to ZZ-1 here")]);
    expect(r.danglingReferences).toEqual([]);
  });

  it("does not match an ID glued to surrounding word characters", () => {
    const r = validateCrossReferences([s("x", "xFR-1y")]);
    expect(r.danglingReferences).toEqual([]);
  });

  it("returns a valid empty result for no sections", () => {
    const r = validateCrossReferences([]);
    expect(r).toMatchObject({
      danglingReferences: [], orphanNodes: [], cycles: [],
      numberingGaps: [], duplicateIds: [], isValid: true,
    });
  });

  it("returns a valid empty result for empty content", () => {
    expect(validateCrossReferences([s("x", "")]).isValid).toBe(true);
  });
});
