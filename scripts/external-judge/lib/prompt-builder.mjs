/**
 * Claim-scoped judge prompt construction for the calibration harness.
 *
 * Deliberately NOT imported from packages/verification/src/judge-prompt.ts —
 * task scope forbids touching packages/, and scripts/external-judge must be
 * self-contained (zero new deps, zero cross-tree coupling at runtime). The
 * verdict taxonomy and response schema are duplicated from that file by
 * value; keep them in sync manually if the upstream taxonomy changes
 * (source noted below).
 *
 * Precondition: `claim` has {claim_id, claim_type, text, evidence}, where
 * `evidence` is a claim-scoped excerpt already assembled by whoever built
 * fixtures/ground-truth.json. AC-008's excerpt is the historical
 * pre-correction PRD text rather than the corrected fixtures/01-prd.md; see
 * that fixture's provenance.note_on_ac008 for why, and its `evidence_source`
 * field for the file the text was taken from (provenance only — nothing
 * reads it at run time). This function does not fetch or truncate from a
 * full PRD — it only formats what resolveClaimEvidence resolves.
 * Postcondition: returns a prompt string. Callers (calibrate.mjs) are
 * responsible for asserting the ≤8K-char budget against the *inputs*
 * (ground-truth.json evidence fields), not against this function's output,
 * because the fixed scaffolding text is deterministic and small.
 *
 * source (taxonomy + schema, verbatim short-form):
 * packages/verification/src/judge-prompt.ts VERDICT_TAXONOMY / RESPONSE_SCHEMA.
 */

/**
 * Resolve the evidence text for a claim.
 *
 * This module reads NOTHING from disk, deliberately. AC-008 used to carry a
 * `prompt_source` filename that was read at run time with `readFileSync` and
 * the bytes posted straight to a third-party LLM endpoint — a file named by
 * DATA whose contents leave the machine (CodeQL js/file-access-to-http). #37
 * guarded that read with a containment check; this removes the read instead,
 * which is the root cause rather than its blast radius: with no runtime path
 * there is no path to contain, no traversal to refuse, and no way to point
 * the harness at a file the corpus does not already contain.
 *
 * The historical pre-correction text now lives INLINE in
 * fixtures/ground-truth.json like every other claim's evidence, and the file
 * it came from is recorded in `evidence_source` as provenance only — nothing
 * reads it at run time. A test pins the two byte-for-byte, so the pointer
 * cannot drift from the text it documents.
 *
 * Precondition: `claim` carries a non-empty `evidence` string.
 * Postcondition: returns that string; throws (never returns undefined/empty)
 * when the field is absent or empty.
 *
 * @param {{claim_id: string, evidence?: string}} claim
 * @returns {string}
 */
export function resolveClaimEvidence(claim) {
  if (typeof claim.evidence === "string" && claim.evidence.length > 0) {
    return claim.evidence;
  }
  throw new Error(
    `resolveClaimEvidence: claim ${claim.claim_id} has no non-empty evidence field`,
  );
}

const VERDICT_TAXONOMY = `
| Verdict | Meaning | When to use |
|---------|---------|-------------|
| PASS | Claim is structurally complete AND verifiable from the document | FR traceability, AC completeness, SP arithmetic, structural checks |
| SPEC-COMPLETE | A test or measurement method is specified, but runtime data is needed to confirm | NFR performance targets (latency, fps, throughput), scalability limits |
| NEEDS-RUNTIME | Claim cannot be verified at design time at all | Load test results, p95 latency under prod traffic, real-world storage usage |
| INCONCLUSIVE | Claim depends on an unresolved open question or external factor | Claims referencing OQ-XXX, vendor SLA, regulatory interpretation |
| FAIL | Claim is structurally invalid or contradicts other claims | Arithmetic errors, orphan references, circular dependencies |
`.trim();

const RESPONSE_SCHEMA = `
{
  "verdict": "PASS" | "SPEC-COMPLETE" | "NEEDS-RUNTIME" | "INCONCLUSIVE" | "FAIL",
  "rationale": "<one paragraph: why you reached this verdict>",
  "caveats": ["<short caveat>", "..."],
  "confidence": <number in [0, 1]>
}
`.trim();

/**
 * @param {{claim_id: string, claim_type: string, text: string, evidence?: string, prompt_source?: string}} claim
 * @returns {string}
 */
export function buildClaimPrompt(claim) {
  const evidence = resolveClaimEvidence(claim);
  return [
    `You are acting as an independent verification judge for a PRD claim.`,
    `You are one cross-vendor judge slot in a mixed panel — your role is to`,
    `provide a genuinely independent second opinion, not to agree with an`,
    `assumed majority.`,
    "",
    `<claim>`,
    `id: ${claim.claim_id}`,
    `type: ${claim.claim_type}`,
    `text: ${claim.text}`,
    `</claim>`,
    "",
    `<evidence>`,
    evidence,
    `</evidence>`,
    "",
    `<verdict_taxonomy>`,
    VERDICT_TAXONOMY,
    `</verdict_taxonomy>`,
    "",
    `Return EXACTLY ONE JSON object matching this schema and nothing else (no prose before or after, no markdown fences):`,
    "",
    RESPONSE_SCHEMA,
    "",
    `Constraints:`,
    `- Do NOT default to PASS. If you would assign PASS to every claim of this type, you are not doing your job.`,
    `- NFR claims (latency, throughput, fps, storage) MUST NOT receive PASS. Use SPEC-COMPLETE or NEEDS-RUNTIME.`,
    `- "rationale" must be specific to THIS claim, not a generic rubric.`,
    `- "confidence" reflects how sure you are about the verdict, not how confident you are about the claim.`,
  ].join("\n");
}
