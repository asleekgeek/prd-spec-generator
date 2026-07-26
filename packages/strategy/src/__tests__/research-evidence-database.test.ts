/**
 * @prd-gen/strategy — research evidence database contract tests.
 *
 * These pin the tier single-source-of-truth. `ResearchEvidence.tier` used to
 * be hand-written on every entry while `calculateScore` indexed
 * `STRATEGY_TIERS[ev.tier].selectionWeight` — so an entry could select its
 * weight out of a tier it did not belong to. Five of fifteen strategies had
 * drifted (reflexion and problem_analysis declared tier 1 vs canonical 2;
 * meta_prompting and plan_and_solve 2 vs 3; multimodal_cot 3 vs 4), each
 * inflating that strategy's selection score.
 *
 * The tier is now derived from core's STRATEGY_TIERS at assembly. The
 * assertions below are on OBSERVABLE postconditions, not on the derivation.
 */

import { describe, expect, it } from "vitest";
import {
  getStrategyTier,
  STRATEGY_TIERS,
  ThinkingStrategySchema,
} from "@prd-gen/core";
import { ResearchEvidenceDatabase } from "../index.js";

const db = new ResearchEvidenceDatabase();

describe("tier is derived from core STRATEGY_TIERS", () => {
  it("every strategy's reported tier equals getStrategyTier(strategy)", () => {
    for (const strategy of db.getAllStrategies()) {
      expect(db.getTier(strategy)).toBe(getStrategyTier(strategy));
    }
  });

  it("every evidence entry's tier equals its strategy's canonical tier", () => {
    for (const strategy of db.getAllStrategies()) {
      for (const ev of db.getEvidence(strategy)) {
        expect(ev.tier).toBe(getStrategyTier(ev.strategy));
      }
    }
  });

  /**
   * The five strategies that had drifted. Named explicitly so a regression
   * that reintroduces a hand-written tier fails with a readable diff rather
   * than only tripping the generic invariant above.
   */
  it.each([
    ["reflexion", 2],
    ["problem_analysis", 2],
    ["meta_prompting", 3],
    ["plan_and_solve", 3],
    ["multimodal_cot", 4],
  ] as const)("%s is tier %i (was locally declared one tier better)", (strategy, tier) => {
    expect(db.getTier(strategy)).toBe(tier);
  });

  it("getStrategiesInTier agrees with core membership, both directions", () => {
    for (const tierKey of Object.keys(STRATEGY_TIERS)) {
      const tier = Number(tierKey) as 1 | 2 | 3 | 4;
      for (const strategy of db.getStrategiesInTier(tier)) {
        expect(getStrategyTier(strategy)).toBe(tier);
      }
    }
    // No strategy the database knows about is missing from its tier bucket.
    for (const strategy of db.getAllStrategies()) {
      const tier = getStrategyTier(strategy);
      expect(db.getStrategiesInTier(tier)).toContain(strategy);
    }
  });

  it("every strategy in the database is a valid ThinkingStrategy", () => {
    for (const strategy of db.getAllStrategies()) {
      expect(ThinkingStrategySchema.safeParse(strategy).success).toBe(true);
    }
  });
});

describe("calculateScore uses the canonical tier weight", () => {
  it("scores a matching strategy above zero and no higher than its tier weight allows", () => {
    const chars = new Set(["iterative_refinement", "self_correction"]);
    const score = db.calculateScore("reflexion", chars);
    expect(score).toBeGreaterThan(0);
    // reflexion is tier 2 (weight 2.0). The per-evidence term is
    // improvementPercent * tierWeight * (0.5 + 0.5*overlapRatio) ≤
    // improvementPercent * tierWeight, so the mean cannot exceed that bound.
    const best = db.getBestEvidence("reflexion");
    expect(best).toBeDefined();
    expect(score).toBeLessThanOrEqual(
      best!.improvementPercent * STRATEGY_TIERS[2].selectionWeight,
    );
  });

  it("returns 0 for a strategy with no evidence entry", () => {
    // prompt_chaining is a valid ThinkingStrategy with no evidence row.
    expect(db.calculateScore("prompt_chaining", new Set(["anything"]))).toBe(0);
  });
});
