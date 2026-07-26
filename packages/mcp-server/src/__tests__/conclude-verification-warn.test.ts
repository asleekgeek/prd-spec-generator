/**
 * B5 — `buildConcludeOpts` warns when `claim_types` is omitted while the
 * reliability repository is open (Curie A3 one-sided-censoring guard).
 *
 * What is verified: the guard in build-conclude-opts.ts:
 *   if (claim_types === undefined && reliabilityRepo !== null) console.warn(...)
 * is exercised through the real exported function — the same one
 * pipeline-tools.ts:conclude_verification calls — not re-simulated inline.
 *
 * Each test also asserts the CONSEQUENCE the warn is about (claimTypes and
 * onObservation left undefined ⇒ observations are silently dropped), so the
 * suite pins the causal link, not just the log line. §13.1 F1: the emission
 * itself is asserted, and the nominal path is asserted quiet.
 *
 * Strategy: vi.mock on ../reliability-wiring.js supplies a stub repo (or null)
 * so the guard's second operand is controlled without a real SQLite DB —
 * matching the seam used by conclude-verification-claims-e2e.test.ts.
 * FAILS_ON: test that needs a real reliability DB — intentional, this is a unit seam.
 *
 * source: Curie cross-audit Wave D, A3 anomaly resolution.
 * source: Wave D B5 remediation.
 * Stakes: Medium — calibration infrastructure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildConcludeOpts } from "../build-conclude-opts.js";

// ─── Mock reliability-wiring so the guard's repo operand is controllable ──────

const mocks = vi.hoisted(() => ({
  repo: null as { recordObservation: () => void } | null,
}));

vi.mock("../reliability-wiring.js", () => ({
  getReliabilityRepo: () => mocks.repo,
  getConsensusReliabilityProvider: () => null,
  closeReliabilityRepo: () => {},
}));

/** An open repository — satisfies the guard's `reliabilityRepo !== null` operand. */
function openRepo(): { recordObservation: () => void } {
  return { recordObservation: () => {} };
}

describe("buildConcludeOpts — B5 claim_types omission warn", () => {
  beforeEach(() => {
    mocks.repo = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns, and drops the observation flusher, when claim_types is omitted and a repo is open", () => {
    // Precondition: claim_types omitted by the caller, reliability repo open.
    // Postcondition: exactly one warn naming the failure mode, AND the
    //   ConcludeOptions carry neither claimTypes nor onObservation — the
    //   silent data loss the warn exists to announce.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.repo = openRepo();

    const opts = buildConcludeOpts({
      consensus_strategy: "weighted_average",
      run_id: "run-b5",
    });

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[reliability] WARNING"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("one-sided censoring"),
    );

    // The consequence the operator is being warned about.
    expect(opts.claimTypes).toBeUndefined();
    expect(opts.onObservation).toBeUndefined();
  });

  it("stays quiet, and wires the flusher, when claim_types is provided", () => {
    // Precondition: caller supplied the claim_id → claim_type map, repo open.
    // Postcondition: no warn; claimTypes populated and onObservation wired,
    //   i.e. observations WILL be flushed. Negative assertion per §13.1 G4.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.repo = openRepo();

    const opts = buildConcludeOpts({
      consensus_strategy: "weighted_average",
      run_id: "run-b5",
      claim_types: { "claim-001": "correctness" },
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(opts.claimTypes?.get("claim-001")).toBe("correctness");
    expect(opts.onObservation).toBeDefined();
  });

  it("stays quiet when no repo is open — omitting claim_types is then harmless", () => {
    // Precondition: better-sqlite3 absent / DB unopenable ⇒ getReliabilityRepo() null.
    // Postcondition: no warn (nothing to censor), and no flusher is wired.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.repo = null;

    const opts = buildConcludeOpts({
      consensus_strategy: "weighted_average",
      run_id: "run-b5",
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(opts.onObservation).toBeUndefined();
  });
});
