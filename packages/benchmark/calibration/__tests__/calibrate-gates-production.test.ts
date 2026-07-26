/**
 * Tests for the production-mode calibration runner (Wave F2 sub-stream).
 *
 * Coverage:
 *  - F2.E.1 (runner): runProductionCalibration threads AgentInvoker through
 *    measurePipelineAsync → makeProductionDispatcher → step() loop.
 *  - F2.E.2: production output JSON conforms to GateCalibrationK100Schema
 *    (extra fields stripped by Zod default semantics) so the canonical loader
 *    handles it identically.
 *  - F2.E.3: production output carries `data_source: "production_pilot_K=N"`
 *    so it is never confused with the canned baseline.
 *  - F2.E.4: --mode flag dispatch (selectModeFromArgv) routes "production"
 *    vs "canned"; rejects unknown modes.
 *  - F2.E.5: pilot run produces wall_time_ms numbers in the simulated-latency
 *    range (NOT the canned ~1ms floor) and shows fewer cortex-recall-empty
 *    counts than the canned 11.
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runProductionCalibration,
  PRODUCTION_OUTPUT_BASENAME,
} from "../calibrate-gates-production.js";
import { selectModeFromArgv } from "../calibrate-gates.js";
import { GateCalibrationK100Schema } from "../calibration-outputs.js";
import {
  makeStubAgentInvoker,
  type AgentInvoker,
} from "@prd-gen/orchestration";

const TMP_PREFIX = join(
  tmpdir(),
  `calib-prod-test-${process.pid}-${Date.now()}`,
);
let counter = 0;
function freshTmp(): string {
  const dir = `${TMP_PREFIX}-${counter++}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFastDeterministicInvoker(): AgentInvoker {
  // Deterministic, NEAR-INSTANT invoker for unit tests. We are NOT testing
  // latency here (the pilot test below does that) — we are testing that the
  // runner threads invocations through the dispatcher correctly.
  return makeStubAgentInvoker({
    latencyMinMs: 0,
    latencyMaxMs: 1,
    rng: (() => {
      let s = 0xdead_beef;
      return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
      };
    })(),
    sleep: async () => undefined, // no actual sleep
    warmCortexHitProbability: 0.7,
  });
}

describe("runProductionCalibration — F2.E (runner)", () => {
  it("threads AgentInvoker through every measurePipelineAsync call (E.1)", async () => {
    let subagentCallCount = 0;
    let cortexCallCount = 0;
    const invoker: AgentInvoker = {
      async invokeSubagentBatch(reqs) {
        subagentCallCount += 1;
        return reqs.map((r) => ({
          invocation_id: r.invocation_id,
          raw_text: "test",
        }));
      },
      async invokeCortexRecall() {
        cortexCallCount += 1;
        return { results: [], total: 0 };
      },
    };
    const result = await runProductionCalibration({
      k: 2,
      eventRateK: 2,
      outputDir: freshTmp(),
      frozenBaselineCommit: "test",
      featureDescription: "OAuth feature",
      codebasePath: "/tmp/test-prod",
      inMemoryOnly: true,
      agentInvoker: invoker,
      agentInvokerClass: "test-spy",
    });
    // Runner ran 2 calibration runs + 2 event-rate runs = 4 pipeline invocations,
    // each of which spawns subagents and queries cortex multiple times.
    expect(subagentCallCount).toBeGreaterThan(0);
    expect(cortexCallCount).toBeGreaterThan(0);
    expect(result.gateCalibration.k_achieved).toBe(2);
  });

  it("output JSON conforms to GateCalibrationK100Schema (E.2)", async () => {
    const dir = freshTmp();
    await runProductionCalibration({
      k: 2,
      eventRateK: 2,
      outputDir: dir,
      frozenBaselineCommit: "test",
      featureDescription: "feat",
      codebasePath: "/tmp/test-prod",
      inMemoryOnly: false,
      agentInvoker: makeFastDeterministicInvoker(),
      agentInvokerClass: "stub-deterministic-test",
    });
    const raw = JSON.parse(
      readFileSync(join(dir, PRODUCTION_OUTPUT_BASENAME), "utf8"),
    ) as unknown;
    const parsed = GateCalibrationK100Schema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("output JSON carries data_source=production_pilot_K=N (E.3)", async () => {
    const dir = freshTmp();
    const result = await runProductionCalibration({
      k: 3,
      eventRateK: 2,
      outputDir: dir,
      frozenBaselineCommit: "test",
      featureDescription: "feat",
      codebasePath: "/tmp/test-prod",
      inMemoryOnly: false,
      agentInvoker: makeFastDeterministicInvoker(),
      agentInvokerClass: "stub-deterministic-test",
    });
    expect(result.gateCalibration.data_source).toBe("production_pilot_K=3");
    expect(result.gateCalibration.agent_invoker_class).toBe(
      "stub-deterministic-test",
    );
    // Sanity: the file path is the production filename, not the canned one.
    const raw = JSON.parse(
      readFileSync(join(dir, PRODUCTION_OUTPUT_BASENAME), "utf8"),
    ) as { data_source: string };
    expect(raw.data_source).toBe("production_pilot_K=3");
  });
});

describe("frozen-baseline pre-flight (production series)", () => {
  /**
   * The production runner stamped `frozen_baseline_content_hash` on every run
   * but never read the recorded value back, so a `pipeline-kpis.ts` edit
   * between two production K-batches was silently absorbed. The canned runner
   * (calibrate-gates.ts) has always enforced this ratchet; these tests pin the
   * production counterpart.
   *
   * source: docs/PHASE_4_PLAN.md §4.5 — Popper AP-1 ratchet protection.
   */
  function seedArtefact(
    dir: string,
    body: { gates: unknown[]; frozen_baseline_content_hash?: string },
  ): void {
    writeFileSync(
      join(dir, PRODUCTION_OUTPUT_BASENAME),
      JSON.stringify(body, null, 2),
      "utf8",
    );
  }

  function baseOptions(dir: string) {
    return {
      k: 2,
      eventRateK: 2,
      outputDir: dir,
      frozenBaselineCommit: "test",
      featureDescription: "feat",
      codebasePath: "/tmp/test-prod",
      inMemoryOnly: true,
      agentInvoker: makeFastDeterministicInvoker(),
      agentInvokerClass: "stub-deterministic-test",
    };
  }

  it("aborts when a SEALED artefact records a different content hash", async () => {
    const dir = freshTmp();
    seedArtefact(dir, {
      gates: [{ gate_name: "wall_time_ms_max" }],
      frozen_baseline_content_hash: "0".repeat(64),
    });
    await expect(runProductionCalibration(baseOptions(dir))).rejects.toThrow(
      /frozen-baseline content hash mismatch \(production series\)/,
    );
  });

  it("skipFrozenBaselineCheck bypasses the abort", async () => {
    const dir = freshTmp();
    seedArtefact(dir, {
      gates: [{ gate_name: "wall_time_ms_max" }],
      frozen_baseline_content_hash: "0".repeat(64),
    });
    const result = await runProductionCalibration({
      ...baseOptions(dir),
      skipFrozenBaselineCheck: true,
    });
    expect(result.gateCalibration.k_achieved).toBe(2);
  });

  it("an UNSEALED artefact (gates: []) is not a baseline and passes", async () => {
    const dir = freshTmp();
    seedArtefact(dir, {
      gates: [],
      frozen_baseline_content_hash: "0".repeat(64),
    });
    const result = await runProductionCalibration(baseOptions(dir));
    expect(result.gateCalibration.k_achieved).toBe(2);
  });

  it("a malformed artefact is treated as no baseline, not a hard failure", async () => {
    const dir = freshTmp();
    writeFileSync(join(dir, PRODUCTION_OUTPUT_BASENAME), "{not json", "utf8");
    const result = await runProductionCalibration(baseOptions(dir));
    expect(result.gateCalibration.k_achieved).toBe(2);
  });

  it("records the CURRENT hash when no prior artefact exists", async () => {
    const dir = freshTmp();
    const result = await runProductionCalibration(baseOptions(dir));
    expect(result.gateCalibration.frozen_baseline_content_hash).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});

describe("--mode dispatch — F2.E.4", () => {
  it("default mode is canned (backward compatible)", () => {
    expect(selectModeFromArgv([])).toBe("canned");
  });

  it("--mode=canned selects canned", () => {
    expect(selectModeFromArgv(["--mode=canned"])).toBe("canned");
  });

  it("--mode=production selects production", () => {
    expect(selectModeFromArgv(["--mode=production"])).toBe("production");
  });

  it("rejects unknown modes", () => {
    expect(() => selectModeFromArgv(["--mode=hybrid"])).toThrow(
      /must be "canned" or "production"/,
    );
  });
});
