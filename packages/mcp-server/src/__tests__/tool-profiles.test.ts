/**
 * Unit tests for the tool-profile logic (issue #28, criteria 5 & 8).
 */
import { describe, expect, it } from "vitest";
import {
  INTERNAL_TOOL_NAMES,
  instructions,
  isAllowed,
  parseProfile,
  resolveProfile,
} from "../tool-profiles.js";

describe("resolveProfile", () => {
  it("defaults to full", () => {
    expect(resolveProfile([], {})).toBe("full");
  });

  it("reads PRD_GEN_PROFILE when no flag", () => {
    expect(resolveProfile([], { PRD_GEN_PROFILE: "agent" })).toBe("agent");
  });

  it("flag wins over env", () => {
    expect(resolveProfile(["--profile", "full"], { PRD_GEN_PROFILE: "agent" })).toBe("full");
  });

  it("supports --profile=<value>", () => {
    expect(resolveProfile(["--profile=agent"], {})).toBe("agent");
  });

  it("throws on an unknown profile name (criterion 8)", () => {
    expect(() => resolveProfile([], { PRD_GEN_PROFILE: "bogus" })).toThrow(/invalid profile/);
    expect(() => parseProfile("scout")).toThrow(/expected 'full' or 'agent'/);
  });

  it("throws on a trailing --profile with no value", () => {
    expect(() => resolveProfile(["--profile"], {})).toThrow(/requires a value/);
  });
});

describe("isAllowed", () => {
  it("full allows every tool", () => {
    for (const name of INTERNAL_TOOL_NAMES) {
      expect(isAllowed("full", name)).toBe(true);
    }
    expect(isAllowed("full", "start_pipeline")).toBe(true);
  });

  it("agent excludes exactly the internal tools", () => {
    for (const name of INTERNAL_TOOL_NAMES) {
      expect(isAllowed("agent", name)).toBe(false);
    }
  });

  it("agent allows the pipeline/generation tools", () => {
    for (const name of [
      "start_pipeline",
      "submit_action_result",
      "get_pipeline_state",
      "coordinate_context_budget",
      "validate_prd_document",
      "conclude_verification",
    ]) {
      expect(isAllowed("agent", name)).toBe(true);
    }
  });
});

describe("instructions", () => {
  it("differ by profile and both name the pipeline entry", () => {
    const full = instructions("full");
    const agent = instructions("agent");
    expect(full).not.toBe(agent);
    expect(full).toContain("full");
    expect(agent).toContain("agent");
    expect(full).toContain("start_pipeline");
    expect(agent).toContain("start_pipeline");
  });
});
