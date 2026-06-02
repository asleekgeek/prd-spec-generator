/**
 * Calibration scripts (Phase 4 — pre-registered analysis only).
 *
 * Each script in this directory has a matching pre-registration block in
 * docs/PHASE_4_PLAN.md. Scripts are executed against committed JSONL data
 * under ./data/; the analysis is deterministic given a fixed dataset.
 */
export {
  analyze as analyzeMismatchFireRate,
  PRIMARY_K,
  PER_CONTEXT_FLOOR,
  XMR_BATCH_SIZE,
  XMR_BASELINE_BATCHES,
  FIRE_RATE_CEILING,
  PRE_REGISTERED_SEED,
  PRD_CONTEXT_DOMAIN,
  type CalibrationRun,
  type FireRateReport,
  type PerContextStats,
} from "./mismatch-fire-rate.js";

export {
  clopperPearson,
  betaiRegularized,
  type ClopperPearsonInterval,
} from "./clopper-pearson.js";

export {
  xmrAnalyze,
  computeLimits,
  scanSeries,
  type XmRLimits,
  type XmRReport,
  type XmRSignal,
} from "./xmr.js";

// Phase 4.2 — MAX_ATTEMPTS calibration math (Wave C1).
export {
  kmEstimate,
  kmMedianAttempts,
  logRankTest,
  schoenfeldRequiredEvents,
  type SurvivalEvent,
  type KmCurve,
  type KmMedian,
  type LogRankResult,
  type SchoenfeldInput,
  type SchoenfeldOutput,
} from "./kaplan-meier.js";

// Phase 4.2 — retry-ablation + closed-loop control-arm seams (Wave C1).
export {
  getRetryArmForRun,
  getMaxAttemptsForRun,
  MAX_ATTEMPTS_BASELINE,
  type RetryArm,
} from "./calibration-seams.js";

// Phase 4.5 — KPI gate tuning seams + machine-class detection (Wave C3).
export {
  detectMachineClass,
  getWallTimeMsGateForMachine,
  MACHINE_CLASSES,
  WALL_TIME_MS_GATE_BY_CLASS,
  WALL_TIME_MS_GATE_FALLBACK,
  GATE_BLOCKED_LOG_PATH,
  type MachineClass,
  type GateBlockedLogEntry,
} from "./machine-class.js";

export {
  appendGateBlockedEntry,
  getKpiGatesForRun,
} from "./gate-tuning-seams.js";

// Phase 4.1 / Wave D2 — ConsensusReliabilityProvider adapter.
// Layer: benchmark implements the port declared in @prd-gen/core.
// Consumed only by the composition root (@prd-gen/mcp-server).
export { BenchmarkConsensusReliabilityProvider } from "./consensus-reliability-adapter.js";

// Phase 4.5 — calibration outputs + constants (Wave D / D3).
// NOTE: the script-only runner `runCalibration` (and `selectModeFromArgv`) are
// intentionally NOT re-exported from this barrel — see the §2.2 boundary note
// at the foot of this file.
export {
  PRE_REGISTERED_SEED_45,
  PRE_REGISTERED_SEED_42,
  DEFAULT_K,
  DEFAULT_EVENT_RATE_K,
  EVENT_RATE_TOLERANCE,
  PROVISIONAL_EVENT_RATE,
} from "./calibrate-gates-constants.js";
export {
  GateCalibrationK100Schema,
  GateCalibrationEntrySchema,
  EventRateK50Schema,
  XmRRecordSchema,
  GATE_CALIBRATION_K100_PATH,
  GATE_CALIBRATION_XMR_DIR,
  EVENT_RATE_K50_PATH,
  readGateCalibrationK100,
  writeGateCalibrationK100,
  readEventRateK50,
  writeEventRateK50,
  type GateCalibrationK100,
  type GateCalibrationEntry,
  type EventRateK50,
  type XmRRecord,
} from "./calibration-outputs.js";
export {
  computeGateStats,
  percentile,
  type GateStats,
} from "./gate-stats.js";
export { measureEventRate, type EventRateMeasurement } from "./event-rate.js";
export {
  computePipelineKpisContentHash,
  resolveFrozenBaselineCommit,
} from "./frozen-baseline.js";

// Phase 4.1 — External oracle dispatch + error types (Wave E / B1 / B3).
export {
  invokeOracle,
  ORACLE_REGISTRY,
  type ExternalGroundingType,
  type OracleResult,
  type OracleInput,
} from "./external-oracle.js";
export { OracleUnavailableError } from "./oracle-errors.js";

// ─── §2.2 layer boundary: script-only runners are NOT re-exported here ───────
//
// `calibrate-gates.ts`, `calibrate-gates-production.ts`, and
// `calibrate-gates-production-cli.ts` are *script-only* modules (top-level
// await, FS writes, deterministic CLI side effects — see the layer-contract
// banner in calibrate-gates-production.ts §2.2). Re-exporting their runners
// (`runCalibration`, `selectModeFromArgv`, `runProductionCalibration`,
// `runProductionFromCli`) from this *library* barrel pulled the whole
// top-level-await script island into every static consumer of
// `@prd-gen/benchmark/calibration`.
//
// The composition root (@prd-gen/mcp-server) imports this barrel only for the
// library-safe oracle + stats seams above. esbuild, bundling the MCP server,
// must initialise every statically-reachable module — so the script island's
// top-level await was awaited at server startup and never settled, deadlocking
// `server.connect()` (the MCP `initialize` handshake never completed).
//
// The runners have no barrel consumers; the CLIs and their tests import them
// directly from their own modules (e.g. `./calibrate-gates.js`). Keeping them
// out of the library barrel is the fix.
//
// source: this PR — MCP startup deadlock root-cause; coding-standards.md §2.2.
