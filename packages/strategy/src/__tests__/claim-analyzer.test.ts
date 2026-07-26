/**
 * Contract tests for the claim analyzer.
 *
 * `analyzeClaim` is a pure keyword classifier: it lowercases claim + context,
 * runs eight independent detectors over the result, unions their
 * characteristics, and scores complexity from the union plus word count. Every
 * assertion below is on that observable contract — which characteristics come
 * out, and how the score and tier respond — never on the shape of the
 * `containsAny` calls that produce them.
 *
 * The detectors are keyword tables, so the risk they carry is a keyword that
 * silently stops matching (exactly the `[:<≤<=]` defect this repo already
 * shipped once, see regex-hardening.test.ts). Each detector therefore gets one
 * case per trigger group rather than one case per detector.
 */

import { describe, expect, it } from "vitest";
import { analyzeClaim, characteristicSet, ClaimAnalysisResultSchema } from "../claim-analyzer.js";

const chars = (claim: string, context?: string) => analyzeClaim(claim, context).characteristics;

describe("analyzeClaim — reasoning-complexity detector", () => {
  it.each(["calculate", "compute", "formula", "equation", "math"])(
    "flags mathematical_reasoning on %s",
    (kw) => expect(chars(`We ${kw} the total`)).toContain("mathematical_reasoning"),
  );

  it.each(["step", "sequence", "then", "after", "before", "process"])(
    "flags multi_step_logic and sequential_planning on %s",
    (kw) => {
      const c = chars(`First ${kw} the input`);
      expect(c).toContain("multi_step_logic");
      expect(c).toContain("sequential_planning");
    },
  );

  it.each(["technical", "architecture", "system", "implementation", "api", "database"])(
    "flags complex_technical on %s",
    (kw) => expect(chars(`Describe the ${kw}`)).toContain("complex_technical"),
  );

  it.each(["precise", "exact", "accurate", "critical", "must", "shall"])(
    "flags high_precision and accuracy_critical on %s",
    (kw) => {
      const c = chars(`The value ${kw} hold`);
      expect(c).toContain("high_precision");
      expect(c).toContain("accuracy_critical");
    },
  );
});

describe("analyzeClaim — structure, exploration, verification detectors", () => {
  it.each(["depend", "relationship", "connect", "link", "reference"])(
    "flags dependency_analysis and cross_reference on %s",
    (kw) => {
      const c = chars(`It has a ${kw} here`);
      expect(c).toContain("dependency_analysis");
      expect(c).toContain("cross_reference");
    },
  );

  it.each(["structure", "hierarchy", "organize", "component", "module"])(
    "flags structural_reasoning on %s",
    (kw) => expect(chars(`Define the ${kw}`)).toContain("structural_reasoning"),
  );

  it.each(["explore", "alternative", "option", "approach", "possibility"])(
    "flags the three exploration characteristics on %s",
    (kw) => {
      const c = chars(`Consider each ${kw}`);
      expect(c).toContain("exploratory_reasoning");
      expect(c).toContain("multiple_approaches");
      expect(c).toContain("branch_exploration");
    },
  );

  it.each(["creative", "innovative", "novel", "design"])(
    "flags creative_problems on %s",
    (kw) => expect(chars(`A ${kw} solution`)).toContain("creative_problems"),
  );

  it.each(["uncertain", "unclear", "ambiguous", "complex", "difficult"])(
    "flags uncertainty_handling on %s",
    (kw) => expect(chars(`This is ${kw}`)).toContain("uncertainty_handling"),
  );

  it.each(["verify", "validate", "check", "ensure", "confirm"])(
    "flags fact_verification and consistency_check on %s",
    (kw) => {
      const c = chars(`We ${kw} the claim`);
      expect(c).toContain("fact_verification");
      expect(c).toContain("consistency_check");
    },
  );

  it.each(["risk", "threat", "vulnerability", "issue", "problem"])(
    "flags risk_analysis on %s",
    (kw) => expect(chars(`There is a ${kw}`)).toContain("risk_analysis"),
  );
});

describe("analyzeClaim — domain, iterative, external, special detectors", () => {
  it.each(["codebase", "repository", "existing code", "current system"])(
    "flags codebase_integration and tool_use on %s",
    (kw) => {
      const c = chars(`Look at the ${kw}`);
      expect(c).toContain("codebase_integration");
      expect(c).toContain("tool_use");
    },
  );

  it.each(["example", "sample", "template", "pattern"])(
    "flags pattern_matching and example_based on %s",
    (kw) => {
      const c = chars(`Follow the ${kw}`);
      expect(c).toContain("pattern_matching");
      expect(c).toContain("example_based");
    },
  );

  it.each(["code", "function", "class", "method", "implement"])(
    "flags code_generation on %s",
    (kw) => expect(chars(`Write the ${kw}`)).toContain("code_generation"),
  );

  it.each(["refine", "improve", "iterate", "enhance", "optimize"])(
    "flags iterative_refinement and quality_improvement on %s",
    (kw) => {
      const c = chars(`We ${kw} it`);
      expect(c).toContain("iterative_refinement");
      expect(c).toContain("quality_improvement");
    },
  );

  it.each(["correct", "fix", "revise", "update"])(
    "flags self_correction on %s",
    (kw) => expect(chars(`Please ${kw} that`)).toContain("self_correction"),
  );

  it.each(["search", "find", "lookup", "retrieve", "fetch"])(
    "flags external_knowledge and tool_use on %s",
    (kw) => {
      const c = chars(`We ${kw} the record`);
      expect(c).toContain("external_knowledge");
      expect(c).toContain("tool_use");
    },
  );

  it.each(["image", "visual", "diagram", "mockup", "screenshot", "ui"])(
    "flags the three visual characteristics on %s",
    (kw) => {
      const c = chars(`Render the ${kw}`);
      expect(c).toContain("visual_reasoning");
      expect(c).toContain("multimodal");
      expect(c).toContain("diagram_analysis");
    },
  );

  it.each(["perspective", "role", "stakeholder", "expert"])(
    "flags role_based_reasoning and expert_orchestration on %s",
    (kw) => {
      const c = chars(`From the ${kw} view`);
      expect(c).toContain("role_based_reasoning");
      expect(c).toContain("expert_orchestration");
    },
  );
});

describe("analyzeClaim — notes", () => {
  it("emits a note for each detector that carries one", () => {
    const { analysisNotes } = analyzeClaim("compute the diagram for the alternative approach");
    expect(analysisNotes).toContain("Mathematical reasoning detected");
    expect(analysisNotes).toContain("Visual content processing needed");
    expect(analysisNotes.length).toBeGreaterThanOrEqual(2);
  });

  it("emits no notes when only note-less detectors fire", () => {
    // `hierarchy` hits detectStructurePatterns, which returns a bare Set.
    expect(analyzeClaim("hierarchy").analysisNotes).toEqual([]);
  });
});

describe("analyzeClaim — fallback and context", () => {
  it("falls back to basic_reasoning when nothing matches", () => {
    const r = analyzeClaim("zz qq");
    expect(r.characteristics).toEqual(["basic_reasoning"]);
  });

  it("reads the context argument, not only the claim", () => {
    expect(chars("zz qq", "please verify it")).toContain("fact_verification");
  });

  it("is case-insensitive", () => {
    expect(chars("CALCULATE THE TOTAL")).toContain("mathematical_reasoning");
  });

  it("echoes the claim back unmodified, preserving original case", () => {
    expect(analyzeClaim("CALCULATE X").claim).toBe("CALCULATE X");
  });

  it("deduplicates characteristics that several detectors both add", () => {
    // `codebase` and `search` both add tool_use.
    const c = chars("search the codebase");
    expect(c.filter((x) => x === "tool_use")).toHaveLength(1);
  });
});

describe("analyzeClaim — complexity score and tier", () => {
  it("scores an unmatched claim as simple", () => {
    const r = analyzeClaim("zz qq");
    expect(r.complexityTier).toBe("simple");
    expect(r.complexityScore).toBeLessThan(0.3);
  });

  it("scores a claim hitting many high-weight characteristics as complex", () => {
    const r = analyzeClaim(
      "calculate the architecture dependency risk in the codebase and iterate to improve accuracy, it must be exact",
    );
    expect(r.complexityTier).toBe("complex");
    expect(r.complexityScore).toBeGreaterThanOrEqual(0.6);
  });

  it("never exceeds 1.0 however much matches", () => {
    const everything =
      "calculate step technical must depend structure explore creative uncertain verify risk " +
      "codebase example code refine correct search image perspective " +
      "architecture database formula equation optimize retrieve diagram stakeholder";
    const r = analyzeClaim(everything, everything);
    expect(r.complexityScore).toBeLessThanOrEqual(1.0);
    expect(r.complexityTier).toBe("complex");
  });

  it("is monotone: adding a matching characteristic never lowers the score", () => {
    const base = analyzeClaim("hierarchy").complexityScore;
    const more = analyzeClaim("hierarchy and a formula").complexityScore;
    expect(more).toBeGreaterThan(base);
  });

  it("tiers at the documented boundaries", () => {
    // Boundary behaviour is what a consumer branches on, so it is pinned
    // through the public surface rather than by calling the private helper.
    for (const claim of ["zz qq", "hierarchy", "calculate the architecture dependency risk in the codebase iterate must"]) {
      const { complexityScore, complexityTier } = analyzeClaim(claim);
      const expected = complexityScore >= 0.6 ? "complex" : complexityScore >= 0.3 ? "moderate" : "simple";
      expect(complexityTier).toBe(expected);
    }
  });

  it("counts word volume toward the score, capped", () => {
    const short = analyzeClaim("formula").complexityScore;
    const long = analyzeClaim("formula " + "word ".repeat(400)).complexityScore;
    expect(long).toBeGreaterThan(short);
    expect(long - short).toBeLessThanOrEqual(0.15 + 1e-9);
  });
});

describe("analyzeClaim — output validates against its own schema", () => {
  it.each([
    "zz qq",
    "calculate the risk",
    "explore alternatives in the existing code and verify the diagram",
  ])("parses for %s", (claim) => {
    expect(() => ClaimAnalysisResultSchema.parse(analyzeClaim(claim))).not.toThrow();
  });
});

describe("characteristicSet", () => {
  it("gives set membership over the array form", () => {
    const s = characteristicSet(["a", "b"]);
    expect(s.has("a")).toBe(true);
    expect(s.has("c")).toBe(false);
    expect(s.size).toBe(2);
  });

  it("collapses duplicates", () => {
    expect(characteristicSet(["a", "a", "b"]).size).toBe(2);
  });

  it("returns an empty set for an empty list", () => {
    expect(characteristicSet([]).size).toBe(0);
  });
});
