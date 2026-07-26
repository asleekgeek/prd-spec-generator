/**
 * Tests for specOracle (E2.D).
 *
 * Contract under test:
 *   - truth = ((violations.length === 0) === expected_passes)
 *   - oracle_evidence always contains the internal-grounding caveat
 *   - oracle_evidence is always non-empty
 *
 * Stakes: Medium — calibration infrastructure.
 */

import { describe, it, expect } from "vitest";
import { specOracle } from "../spec-oracle.js";

// A "requirements" section that triggers NONE of the requirements-level rules
// (sp_not_in_fr_table, fr_traceability, no_self_referencing_deps,
// duplicate_requirement_ids, fr_numbering_gaps). Verified: 0 violations.
//
// Prose, not an FR table: fr_traceability fires on an FR table whose AC
// references do not resolve within the section, so ANY self-contained FR
// table is a violation, not a clean fixture. The previous content here was
// exactly such a table and produced 1 violation despite its name — it was
// never referenced by a test, so nothing caught it.
const CLEAN_REQUIREMENTS_SECTION = `
## Functional Requirements

The system shall provide authentication.
`;

// A requirements section that triggers duplicate_requirement_ids (FR-001
// twice) — and fr_traceability, since the AC column is absent.
// Verified: 2 violations. The previous content here was a story-point list
// that triggered NOTHING, so the test asserting "duplicate requirement IDs"
// below was passing vacuously.
const BAD_REQUIREMENTS_SECTION = `
## Functional Requirements

| ID | Title | Description | Priority |
|---|---|---|---|
| FR-001 | Login | User can log in | High |
| FR-001 | Login again | Duplicate id | High |
`;

// overview section — very few rules apply; clean content should pass.
const CLEAN_OVERVIEW_SECTION = `
## Overview

This feature adds single sign-on support to the platform.
`;

describe("specOracle", () => {
  it("clean overview section + expected_passes=true → truth=true", async () => {
    const result = await specOracle({
      markdown: CLEAN_OVERVIEW_SECTION,
      section_type: "overview",
      expected_passes: true,
    });

    // overview has no Hard Output Rules mapped to it (see rule-mapping.ts);
    // zero violations → actually_passes=true → truth=(true===true)=true.
    expect(result.truth).toBe(true);
    expect(result.oracle_evidence).toBeTruthy();
    expect(result.oracle_evidence).toContain("truth=true");
  });

  it("oracle_evidence always contains the internal-grounding caveat", async () => {
    const result = await specOracle({
      markdown: CLEAN_OVERVIEW_SECTION,
      section_type: "overview",
      expected_passes: true,
    });

    expect(result.oracle_evidence).toContain("internally-grounded");
    expect(result.oracle_evidence).toContain("PHASE_4_PLAN.md");
  });

  it("clean overview + expected_passes=false → truth=false", async () => {
    // The section IS valid (no violations), but caller claims it should fail.
    // truth = (true === false) = false.
    const result = await specOracle({
      markdown: CLEAN_OVERVIEW_SECTION,
      section_type: "overview",
      expected_passes: false,
    });

    expect(result.truth).toBe(false);
    expect(result.oracle_evidence).toContain("actually_passes=true");
    expect(result.oracle_evidence).toContain("expected_passes=false");
    expect(result.oracle_evidence).toContain("truth=false");
  });

  it("clean requirements section + expected_passes=true → truth=true", async () => {
    // Positive control for the `requirements` section type — the fixture was
    // declared but never exercised, so only the failing path was covered.
    const result = await specOracle({
      markdown: CLEAN_REQUIREMENTS_SECTION,
      section_type: "requirements",
      expected_passes: true,
    });

    expect(result.truth).toBe(true);
    expect(result.oracle_evidence).toContain("actually_passes=true");
    expect(result.oracle_evidence).toContain("truth=true");
  });

  it("section with duplicate requirement IDs + expected_passes=false → truth=true", async () => {
    // Duplicate FR-001 triggers duplicate_requirement_ids (and fr_traceability,
    // since the AC column is absent). The section fails validation and the
    // claim says it should fail, so truth = (false === false) = true.
    const result = await specOracle({
      markdown: BAD_REQUIREMENTS_SECTION,
      section_type: "requirements",
      expected_passes: false,
    });

    // Asserted concretely — this test previously only checked
    // `typeof result.truth === "boolean"`, which held for either outcome.
    expect(result.truth).toBe(true);
    expect(result.oracle_evidence).toContain("actually_passes=false");
    expect(result.oracle_evidence).toContain("truth=true");
    expect(result.oracle_evidence).toContain("internally-grounded");
  });

  it("oracle_evidence includes violation count", async () => {
    const result = await specOracle({
      markdown: CLEAN_OVERVIEW_SECTION,
      section_type: "overview",
      expected_passes: true,
    });

    expect(result.oracle_evidence).toContain("violations=0");
  });

  it("invalid section_type is handled without throwing", async () => {
    const result = await specOracle({
      markdown: "# Some content",
      section_type: "not_a_real_type",
      expected_passes: true,
    });

    // Either validateSection throws (caught) or returns zero violations for
    // an unknown type — either way oracle_evidence is non-empty.
    expect(result.oracle_evidence).toBeTruthy();
    expect(typeof result.truth).toBe("boolean");
  });
});
