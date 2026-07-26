import type {
  HardOutputRuleViolation,
  SectionType,
} from "@prd-gen/core";
import { findPatternViolations, makeViolation } from "./helpers.js";

// Rule 8: SP Not In FR Table
export function checkSPNotInFRTable(
  content: string,
  sectionType: SectionType,
): HardOutputRuleViolation[] {
  return findPatternViolations(
    /^\s*\|(?:[^|]*\|)*[^|]*(?:Story\s*Points?)[^|]*\|/gim,
    content,
    "sp_not_in_fr_table",
    sectionType,
    "FR table contains Story Points column — SP belongs only in Implementation Roadmap",
  );
}

// Rule 9: Uneven SP Distribution
export function checkUnevenSPDistribution(
  content: string,
  sectionType: SectionType,
): HardOutputRuleViolation[] {
  // Matched per LINE rather than across the whole document. The previous
  // single regex used `\d+[^|]*?\|`, where the digit run and the lazy any-run
  // compete for the same characters — polynomial backtracking on a row of many
  // digits (js/polynomial-redos). Since a sprint and its SP always live in one
  // table row, scanning line by line is both linear and closer to the rule's
  // actual meaning.
  //
  // Semantics preserved exactly: a line still has to name sprint/iteration
  // FOLLOWED BY A NUMBER (so "Sprint planning | 5 SP" is not a sprint row),
  // and the SP cell is still `| <digits> SP|story points`.
  const sprintLabel = /(?:sprint|iteration)\s*\d+/i;
  const spCell = /\|\s*(\d+)\s*(?:SP|story\s*points?)/i;

  const spValues: number[] = [];
  for (const line of content.split("\n")) {
    if (!sprintLabel.test(line)) continue;
    const match = spCell.exec(line);
    if (!match) continue;
    const val = parseInt(match[1], 10);
    if (!isNaN(val)) spValues.push(val);
  }

  if (spValues.length < 3) return [];

  const allSame = new Set(spValues).size === 1;
  if (allSame) {
    return [
      makeViolation(
        "uneven_sp_distribution",
        sectionType,
        `All ${spValues.length} sprints have identical SP (${spValues[0]}) — real projects have uneven complexity`,
        `Sprint SP values: ${spValues.join(", ")}`,
      ),
    ];
  }

  return [];
}

/**
 * Every run of digits in a table cell.
 *
 * Module scope is safe ONLY because the sole consumer is `matchAll`, which
 * per spec clones the regex before iterating and so never advances this
 * object's `lastIndex`. The row-matching patterns below are deliberately NOT
 * hoisted: they are driven by `.exec` in a loop, which does mutate
 * `lastIndex`, so each call must get a fresh object.
 */
const NUMBER_PATTERN = /(\d+)/g;

/**
 * The SP value a table row contributes = the LAST number in its cell text
 * (earlier numbers are sprint indices, dates, or ID fragments; the estimate
 * is conventionally the rightmost numeric column).
 *
 * Precondition: `cellsText` is the captured cell run of one table row.
 * Postcondition: returns that trailing number, or null when the row carries
 *   no digits at all (caller skips such rows).
 */
function trailingNumberIn(cellsText: string): number | null {
  const numbers = [...cellsText.matchAll(NUMBER_PATTERN)].map((m) =>
    parseInt(m[1], 10),
  );
  return numbers.length > 0 ? numbers[numbers.length - 1] : null;
}

// Rule 1: SP Arithmetic
export function checkSPArithmetic(
  content: string,
  sectionType: SectionType,
): HardOutputRuleViolation[] {
  const totalRowPattern =
    /^\s*\|\s*(?:\*{0,2})(?:Total|Sum|Grand\s+Total)(?:\*{0,2})\s*\|(.+)\|/gim;
  const dataRowPattern =
    /^\s*\|\s*(?!\s*(?:-|(?:\*{0,2})(?:Total|Sum|Grand\s+Total)))([^|]+)\|(.+)\|/gim;

  // Collect individual SP values from data rows
  const individualSPs: number[] = [];
  let dataMatch: RegExpExecArray | null;
  while ((dataMatch = dataRowPattern.exec(content)) !== null) {
    const rowSP = trailingNumberIn(dataMatch[2]);
    if (rowSP !== null) {
      individualSPs.push(rowSP);
    }
  }

  // Check total rows
  const violations: HardOutputRuleViolation[] = [];
  let totalMatch: RegExpExecArray | null;
  while ((totalMatch = totalRowPattern.exec(content)) !== null) {
    const totalValue = trailingNumberIn(totalMatch[1]);
    if (totalValue === null) continue;

    const computedSum = individualSPs.reduce((sum, v) => sum + v, 0);

    if (computedSum > 0 && computedSum !== totalValue) {
      violations.push(
        makeViolation(
          "sp_arithmetic",
          sectionType,
          `SP total row shows ${totalValue} but individual rows sum to ${computedSum}`,
          `Total: ${totalValue}, Computed: ${computedSum}`,
        ),
      );
    }
  }

  return violations;
}

// Document-Level SP Arithmetic
export function checkDocumentSPArithmetic(
  sections: ReadonlyArray<{ type: SectionType; content: string }>,
): HardOutputRuleViolation[] {
  const spSections = sections.filter(
    (s) =>
      s.type === "timeline" ||
      s.type === "deployment" ||
      s.type === "requirements",
  );

  if (spSections.length === 0) return [];

  const combinedContent = spSections.map((s) => s.content).join("\n\n");
  return checkSPArithmetic(combinedContent, "timeline");
}
