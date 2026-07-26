/**
 * Shared helpers for audit-flags engine + pipeline-ops.
 *
 * source: cross-audit code-reviewer Blocking-#1 (Phase 3+4 follow-up,
 * 2026-04). Extracted from engine.ts to break the §4.1 (>500 lines)
 * violation while keeping pipeline-ops.ts independent of engine.ts.
 */

import type { AuditRule, AuditFinding, SectionInput } from "./types.js";
import type { SectionType } from "@prd-gen/core";

// ─── Pattern helpers ─────────────────────────────────────────────────────────

/**
 * Leading PCRE/Python inline-flag group, e.g. `(?mi)` or `(?i)`.
 *
 * The rule YAML is written in that dialect, but JavaScript has no such
 * construct: `new RegExp("(?mi)^x")` throws `SyntaxError: Invalid group`.
 * Restricted to the flag letters JavaScript can actually honour, so an
 * unsupported dialect flag falls through to the compile attempt and is
 * reported rather than silently mistranslated.
 */
const INLINE_FLAGS = /^\(\?([imsu]+)\)/;

/** Patterns already reported, so a rule evaluated per-section warns once. */
const reportedBadPatterns = new Set<string>();

/**
 * Compile a rule pattern, translating a leading inline-flag group into real
 * RegExp flags.
 *
 * Returns null when the pattern cannot compile, and says so on stderr the
 * first time it sees that pattern. The silence this replaces was expensive:
 * 142 of the 217 patterns in the shipped rule corpus used `(?i)` or `(?mi)`,
 * every one of them threw on construction, and both callers swallowed the
 * throw and returned "no match". The engine loaded those rules, evaluated
 * them, found nothing, and reported a clean document — so roughly two thirds
 * of the audit rules were inert while looking healthy. A failure this quiet is
 * indistinguishable from a passing document, which is the whole reason it
 * survived (§13 F1: every failure mode emits an actionable signal).
 */
export function compilePattern(pattern: string, baseFlags = "gm"): RegExp | null {
  let source = pattern;
  let flags = baseFlags;

  const inline = INLINE_FLAGS.exec(pattern);
  if (inline) {
    source = pattern.slice(inline[0].length);
    for (const f of inline[1]) {
      if (!flags.includes(f)) flags += f;
    }
  }

  try {
    return new RegExp(source, flags);
  } catch (err) {
    if (!reportedBadPatterns.has(pattern)) {
      reportedBadPatterns.add(pattern);
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[audit-flags] rule pattern did not compile and will never match: ${pattern}\n` +
          `[audit-flags]   ${reason}\n`,
      );
    }
    return null;
  }
}

export function testRegex(pattern: string, text: string): RegExpMatchArray[] {
  const re = compilePattern(pattern);
  if (re === null) return [];
  return [...text.matchAll(re)];
}

export function hasMatch(pattern: string, text: string): boolean {
  const re = compilePattern(pattern);
  if (re === null) return false;
  return re.test(text);
}

// ─── Section helpers ─────────────────────────────────────────────────────────

export function sectionMatchesRule(
  sectionType: SectionType,
  ruleSections: readonly string[],
): boolean {
  return ruleSections.length === 0 || ruleSections.includes(sectionType);
}

export function combineSections(
  sections: readonly SectionInput[],
  filter: readonly string[],
): string {
  return sections
    .filter((s) => filter.length === 0 || filter.includes(s.type))
    .map((s) => s.content)
    .join("\n\n");
}

// ─── Suppress scope evaluation ───────────────────────────────────────────────

export function getLineIndex(text: string, charIndex: number): number {
  let line = 0;
  for (let i = 0; i < charIndex && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

export function getRowAtIndex(
  lines: readonly string[],
  lineIdx: number,
): string {
  return lines[lineIdx] ?? "";
}

export function getNearbyLines(
  lines: readonly string[],
  lineIdx: number,
  radius: number,
): string {
  const start = Math.max(0, lineIdx - radius);
  const end = Math.min(lines.length, lineIdx + radius + 1);
  return lines.slice(start, end).join("\n");
}

export function isSuppressedAtMatch(
  suppressors: readonly AuditRule["suppress"][number][],
  sectionContent: string,
  matchIndex: number,
  allContent: string,
): boolean {
  if (suppressors.length === 0) return false;

  const lines = sectionContent.split("\n");
  const lineIdx = getLineIndex(sectionContent, matchIndex);

  for (const sup of suppressors) {
    let searchText: string;
    if (sup.scope === "same_row") {
      searchText = getRowAtIndex(lines, lineIdx);
    } else if (sup.scope === "same_section") {
      searchText = sectionContent;
    } else if (sup.scope === "any_section") {
      searchText = allContent;
    } else if (sup.scope.startsWith("nearby_lines_")) {
      const radius = parseInt(sup.scope.slice("nearby_lines_".length), 10);
      searchText = getNearbyLines(lines, lineIdx, radius);
    } else {
      searchText = sectionContent;
    }
    if (hasMatch(sup.pattern, searchText)) return true;
  }
  return false;
}

// ─── Finding constructor ─────────────────────────────────────────────────────

export function makeFinding(
  rule: AuditRule,
  matchCount: number,
  message: string,
): AuditFinding {
  return {
    ruleId: rule.id,
    familyCode: rule.family.code,
    familyName: rule.family.display_name,
    ruleName: rule.display_name,
    message,
    suggestedAction: rule.suggested_action,
    severity: rule.severity ?? "warning",
    matchCount,
  };
}
