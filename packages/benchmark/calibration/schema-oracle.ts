/**
 * schemaOracle — JSON Schema validation via Ajv.
 *
 * Precondition:  payload.schema is a valid JSON Schema draft-07 object;
 *                payload.instance is the value to validate;
 *                payload.expected_valid is the claim being made.
 * Postcondition: truth = (Ajv.validate(schema, instance) === expected_valid).
 *                oracle_evidence is non-empty and human-readable.
 * Invariant:     No LLM call is made. Truth is determined solely by Ajv's
 *                deterministic rule engine.
 *
 * Layer: benchmark/calibration (infrastructure-adjacent; used by
 *   computeReliabilityComparison in Wave-D held-out subset path).
 */

// Keep this as a static import so the portable MCP bundle includes Ajv. A
// createRequire("ajv") call survives esbuild as a runtime package lookup,
// which makes a plugin cloned into Codex's read-only cache depend on a
// first-launch `npm ci` that the host cannot perform.
import { Ajv as AjvConstructor } from "ajv";

import type { SchemaPayload, OracleResult } from "./oracle-types.js";

// A single Ajv instance is safe to reuse across calls (Ajv is stateless
// between validate() calls when schemas are compiled per-call via validate()).
// source: Ajv docs §"Caching"; compile() caches compiled schemas; here we use
// validate() which compiles + validates in one step, acceptable at low call
// frequency (calibration path, not hot path).
const ajv = new AjvConstructor({ allErrors: true });

/**
 * Validate that a JSON instance conforms (or does not conform) to a JSON Schema,
 * and compare that result against the caller's claim (expected_valid).
 *
 * Precondition:  payload is a valid SchemaPayload.
 * Postcondition: OracleResult.truth = (validation_result === expected_valid).
 */
export async function schemaOracle(payload: SchemaPayload): Promise<OracleResult> {
  const { schema, instance, expected_valid } = payload;

  const schemaTitle =
    typeof schema === "object" &&
    schema !== null &&
    "title" in schema &&
    typeof (schema as Record<string, unknown>).title === "string"
      ? (schema as Record<string, unknown>).title
      : "(untitled)";

  const instanceSummary = summariseInstance(instance);

  let validateResult: boolean;
  let validationErrors: string;

  try {
    validateResult = ajv.validate(schema, instance) as boolean;
    const errList = ajv.errors;
    validationErrors =
      errList && errList.length > 0
        ? errList
            .map((e: { instancePath?: string; message?: string }) =>
              `${e.instancePath || "/"} ${e.message ?? "error"}`)
            .join("; ")
        : "none";
  } catch (err: unknown) {
    // Schema itself is malformed — Ajv throws on compile errors.
    const msg = err instanceof Error ? err.message : String(err);
    const evidence =
      `schemaOracle: schema "${schemaTitle}" failed to compile in Ajv: ${msg}. ` +
      `Cannot validate instance. Treating claim as false (truth=false).`;
    return { truth: false, oracle_evidence: evidence };
  }

  const truth = validateResult === expected_valid;

  const evidence =
    `schemaOracle: schema="${schemaTitle}"; ` +
    `instance=${instanceSummary}; ` +
    `Ajv.validate=${String(validateResult)}; ` +
    `expected_valid=${String(expected_valid)}; ` +
    `errors=${validationErrors}; ` +
    `truth=${String(truth)}.`;

  return { truth, oracle_evidence: evidence };
}

/** Returns a short, non-sensitive summary of any value for evidence strings. */
function summariseInstance(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const type = typeof value;
  if (type === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{object; keys=[${keys.slice(0, 5).join(",")}]${keys.length > 5 ? "..." : ""}}`;
  }
  if (type === "string") {
    const s = value as string;
    return `"${s.length > 40 ? s.slice(0, 40) + "..." : s}"`;
  }
  return String(value);
}
