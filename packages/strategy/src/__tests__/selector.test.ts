/**
 * Contract tests for strategy selection.
 *
 * `selectStrategy` is deterministic: analyse the claim, enrich the
 * characteristic set from the context flags, score every strategy against the
 * research-evidence database, constrain by complexity tier, then split into
 * required / optional / forbidden. Assertions here are on that observable
 * contract and on the invariants a consumer relies on — the three lists never
 * overlap, tier constraints hold, the forbidden list follows the tier — rather
 * than on specific strategy names, which are data in the evidence database and
 * would make these tests a change-detector for that table.
 *
 * Where a specific name IS asserted (`verified_reasoning`, `react`) it is
 * because the selector hardcodes that rule in `selectRequired`, so the name is
 * part of the contract rather than of the data.
 */

import { describe, expect, it } from "vitest";
import { selectStrategy, StrategyAssignmentSchema } from "../selector.js";
import type { EvidenceRepository } from "@prd-gen/core";

const COMPLEX =
  "calculate the architecture dependency risk across the codebase, iterate to improve it, the result must be exact";
const SIMPLE = "zz qq";

describe("selectStrategy — output shape", () => {
  it("returns an assignment that validates against its own schema", () => {
    expect(() =>
      StrategyAssignmentSchema.parse(selectStrategy({ claim: COMPLEX })),
    ).not.toThrow();
  });

  it("never puts the same strategy in both required and optional", () => {
    for (const claim of [SIMPLE, COMPLEX, "verify the api structure"]) {
      const a = selectStrategy({ claim });
      expect(a.optional.filter((s) => a.required.includes(s))).toEqual([]);
    }
  });

  it("never recommends a strategy it also forbids", () => {
    for (const claim of [SIMPLE, COMPLEX, "explore alternative approaches"]) {
      const a = selectStrategy({ claim });
      const recommended = [...a.required, ...a.optional];
      expect(recommended.filter((s) => a.forbidden.includes(s))).toEqual([]);
    }
  });

  it("carries the claim analysis through", () => {
    const a = selectStrategy({ claim: COMPLEX });
    expect(a.claimAnalysis.claim).toBe(COMPLEX);
    expect(a.claimAnalysis.characteristics.length).toBeGreaterThan(0);
  });

  it("keeps confidence and improvement in range", () => {
    for (const claim of [SIMPLE, COMPLEX]) {
      const a = selectStrategy({ claim });
      expect(a.assignmentConfidence).toBeGreaterThanOrEqual(0);
      expect(a.assignmentConfidence).toBeLessThanOrEqual(1);
      expect(a.expectedImprovement).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("selectStrategy — forbidden list follows complexity tier", () => {
  it("forbids zero_shot and chain_of_thought on a complex claim", () => {
    const a = selectStrategy({ claim: COMPLEX });
    expect(a.claimAnalysis.complexityTier).toBe("complex");
    expect(a.forbidden).toEqual(["zero_shot", "chain_of_thought"]);
  });

  it("forbids nothing on a simple claim", () => {
    const a = selectStrategy({ claim: SIMPLE });
    expect(a.claimAnalysis.complexityTier).toBe("simple");
    expect(a.forbidden).toEqual([]);
  });

  it("forbids exactly zero_shot on a moderate claim", () => {
    // Search for a claim that lands in the moderate band rather than assuming
    // one does; the band is a function of the scorer, not of this test.
    const candidates = [
      "verify the structure",
      "explore the alternative option",
      "check the component hierarchy",
      "refine the approach",
    ];
    const moderate = candidates
      .map((c) => selectStrategy({ claim: c }))
      .find((a) => a.claimAnalysis.complexityTier === "moderate");
    expect(moderate, "no candidate produced a moderate tier").toBeDefined();
    expect(moderate!.forbidden).toEqual(["zero_shot"]);
  });
});

describe("selectStrategy — required-selection rules", () => {
  it("always selects at least one required strategy when any scores", () => {
    expect(selectStrategy({ claim: COMPLEX }).required.length).toBeGreaterThan(0);
  });

  it("respects maxRequiredStrategies", () => {
    const a = selectStrategy({ claim: COMPLEX, maxRequiredStrategies: 1 });
    expect(a.required).toHaveLength(1);
  });

  it("adds verified_reasoning for an accuracy-critical claim", () => {
    // "must" sets high_precision + accuracy_critical in the analyzer.
    const a = selectStrategy({ claim: "the total must be exact", maxRequiredStrategies: 8 });
    expect(a.claimAnalysis.characteristics).toContain("accuracy_critical");
    expect(a.required).toContain("verified_reasoning");
  });

  it("adds react when the claim integrates a codebase and verified_reasoning is not already required", () => {
    const a = selectStrategy({ claim: "read the repository", maxRequiredStrategies: 8 });
    expect(a.claimAnalysis.characteristics).toContain("codebase_integration");
    expect(a.required.includes("react") || a.required.includes("verified_reasoning")).toBe(true);
  });

  it("never repeats a strategy inside required", () => {
    const a = selectStrategy({ claim: COMPLEX, maxRequiredStrategies: 8 });
    expect(new Set(a.required).size).toBe(a.required.length);
  });
});

describe("selectStrategy — context flags enrich the characteristic set", () => {
  it("hasCodebase injects codebase_integration and tool_use", () => {
    const a = selectStrategy({ claim: SIMPLE, hasCodebase: true });
    expect(a.claimAnalysis.characteristics).toContain("codebase_integration");
    expect(a.claimAnalysis.characteristics).toContain("tool_use");
  });

  it("hasMockups injects visual_reasoning and multimodal", () => {
    const a = selectStrategy({ claim: SIMPLE, hasMockups: true });
    expect(a.claimAnalysis.characteristics).toContain("visual_reasoning");
    expect(a.claimAnalysis.characteristics).toContain("multimodal");
  });

  it("leaves the set untouched when both flags are false", () => {
    const a = selectStrategy({ claim: SIMPLE, hasCodebase: false, hasMockups: false });
    expect(a.claimAnalysis.characteristics).not.toContain("codebase_integration");
    expect(a.claimAnalysis.characteristics).not.toContain("visual_reasoning");
  });
});

describe("selectStrategy — optional list", () => {
  it("returns at most three optional strategies", () => {
    for (const claim of [SIMPLE, COMPLEX, "verify the api"]) {
      expect(selectStrategy({ claim }).optional.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("selectStrategy — historical adjustment from an evidence repository", () => {
  const repoWith = (adj: Map<string, number>): EvidenceRepository =>
    ({ getHistoricalAdjustments: () => adj } as unknown as EvidenceRepository);

  it("consults the repository when one is supplied", () => {
    let called = false;
    const repo = {
      getHistoricalAdjustments: () => {
        called = true;
        return new Map();
      },
    } as unknown as EvidenceRepository;
    selectStrategy({ claim: COMPLEX, evidenceRepository: repo });
    expect(called).toBe(true);
  });

  it("works without a repository", () => {
    expect(() => selectStrategy({ claim: COMPLEX })).not.toThrow();
  });

  it("clamps an absurd positive adjustment rather than letting it dominate", () => {
    const baseline = selectStrategy({ claim: COMPLEX });
    const boosted = selectStrategy({
      claim: COMPLEX,
      evidenceRepository: repoWith(
        new Map(baseline.optional.map((s) => [s, 1000] as const)),
      ),
    });
    // The clamp is ±0.3, so a 1000× adjustment cannot produce an assignment
    // outside the normal shape.
    expect(boosted.required.length).toBeGreaterThan(0);
    expect(() => StrategyAssignmentSchema.parse(boosted)).not.toThrow();
  });

  it("clamps an absurd negative adjustment without emptying the assignment", () => {
    const baseline = selectStrategy({ claim: COMPLEX });
    const suppressed = selectStrategy({
      claim: COMPLEX,
      evidenceRepository: repoWith(
        new Map([...baseline.required, ...baseline.optional].map((s) => [s, -1000] as const)),
      ),
    });
    expect(suppressed.required.length).toBeGreaterThan(0);
  });
});

describe("selectStrategy — tuning knobs", () => {
  it("accepts an overlapWeight at either extreme", () => {
    for (const overlapWeight of [0, 1]) {
      const a = selectStrategy({ claim: COMPLEX, overlapWeight });
      expect(() => StrategyAssignmentSchema.parse(a)).not.toThrow();
    }
  });

  it("a very high improvement threshold cannot remove tier-1 strategies", () => {
    // scoreStrategies skips below-threshold strategies "unless tier 1", so a
    // complex claim still gets a required strategy at an impossible threshold.
    const a = selectStrategy({ claim: COMPLEX, minimumImprovementThreshold: 999 });
    expect(a.required.length).toBeGreaterThan(0);
  });

  it("is deterministic for identical input", () => {
    const a = selectStrategy({ claim: COMPLEX, hasCodebase: true });
    const b = selectStrategy({ claim: COMPLEX, hasCodebase: true });
    expect(b.required).toEqual(a.required);
    expect(b.optional).toEqual(a.optional);
    expect(b.forbidden).toEqual(a.forbidden);
    expect(b.expectedImprovement).toBe(a.expectedImprovement);
    expect(b.assignmentConfidence).toBe(a.assignmentConfidence);
  });
});

describe("selectStrategy — citations", () => {
  it("emits a citation for each selected strategy that has evidence", () => {
    const a = selectStrategy({ claim: COMPLEX });
    if (a.required.length + a.optional.length > 0) {
      expect(a.researchCitations.length).toBeGreaterThan(0);
    }
    for (const c of a.researchCitations) expect(typeof c).toBe("string");
  });
});
