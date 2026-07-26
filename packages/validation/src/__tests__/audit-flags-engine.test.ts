/**
 * Contract tests for the audit-flag engine.
 *
 * Two halves, and the second is the point.
 *
 * The first half drives the engine over a temporary rules directory, so the
 * loader's tolerant paths — an unreadable directory, malformed YAML, a file
 * missing `family` or `rules`, a non-YAML filename — are exercised rather than
 * assumed. Every one of those returns quietly by design, which is precisely
 * why an unexercised loader can silently load nothing at all.
 *
 * The second half runs every SHIPPED rule against the `test_fixtures` it
 * declares in its own YAML. All 115 rules carry a `should_flag` and a
 * `should_pass` example, and until now nothing executed them: the corpus
 * asserted correctness that no test checked. A rule that stops matching — the
 * failure mode this repo has already shipped once, see regex-hardening.test.ts
 * — now fails here.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditFlagEngine } from "../audit-flags/engine.js";
import type { SectionType } from "@prd-gen/core";

// ── Half 1: the loader, over a directory we control ────────────────────────

const FAMILY = `family:
  code: TT
  name: testFamily
  display_name: Test Family
  description: d
  primary_persona: p
`;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "audit-rules-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, body: string) => writeFileSync(join(dir, name), body);

describe("AuditFlagEngine — rule loading", () => {
  it("returns no rules for a directory that does not exist", () => {
    const e = new AuditFlagEngine(join(tmpdir(), "definitely-not-here-" + Date.now()));
    expect(e.ruleCount).toBe(0);
    expect(e.familyCodes).toEqual([]);
  });

  it("loads rules from every .yaml and .yml file, ignoring other extensions", () => {
    const d = mkdtempSync(join(tmpdir(), "audit-rules-ext-"));
    const rule = (id: string) => `${FAMILY}
rules:
  - id: "${id}"
    name: n${id}
    display_name: D${id}
    description: desc
    type: pattern
    mode: presence
    sections: []
    detect:
      - pattern: 'NEEDLE'
        description: d
`;
    writeFileSync(join(d, "a.yaml"), rule("001"));
    writeFileSync(join(d, "b.yml"), rule("002"));
    writeFileSync(join(d, "c.txt"), rule("003"));
    writeFileSync(join(d, "README.md"), "not a rule file");
    const e = new AuditFlagEngine(d);
    expect(e.ruleCount).toBe(2);
    expect(e.familyCodes).toEqual(["TT"]);
    rmSync(d, { recursive: true, force: true });
  });

  it("skips a malformed YAML file instead of throwing", () => {
    const d = mkdtempSync(join(tmpdir(), "audit-rules-bad-"));
    writeFileSync(join(d, "broken.yaml"), "family: [unclosed\n  rules:");
    expect(() => new AuditFlagEngine(d)).not.toThrow();
    expect(new AuditFlagEngine(d).ruleCount).toBe(0);
    rmSync(d, { recursive: true, force: true });
  });

  it("skips a file that has no family or no rules", () => {
    const d = mkdtempSync(join(tmpdir(), "audit-rules-partial-"));
    writeFileSync(join(d, "nofamily.yaml"), "rules:\n  - id: '1'\n");
    writeFileSync(join(d, "norules.yaml"), FAMILY);
    expect(new AuditFlagEngine(d).ruleCount).toBe(0);
    rmSync(d, { recursive: true, force: true });
  });

  it("defaults absent optional fields rather than producing undefined", () => {
    const d = mkdtempSync(join(tmpdir(), "audit-rules-min-"));
    writeFileSync(join(d, "min.yaml"), `${FAMILY}
rules:
  - id: "001"
`);
    const e = new AuditFlagEngine(d);
    expect(e.ruleCount).toBe(1);
    // A rule with no detect patterns must evaluate without throwing.
    expect(() => e.evaluate([{ type: "requirements" as SectionType, content: "x" }])).not.toThrow();
    rmSync(d, { recursive: true, force: true });
  });
});

describe("AuditFlagEngine — evaluate", () => {
  const engineWith = (body: string) => {
    const d = mkdtempSync(join(tmpdir(), "audit-eval-"));
    writeFileSync(join(d, "r.yaml"), body);
    const e = new AuditFlagEngine(d);
    rmSync(d, { recursive: true, force: true });
    return e;
  };

  const presence = `${FAMILY}
rules:
  - id: "001"
    name: n
    display_name: Presence Rule
    description: found the needle
    type: pattern
    mode: presence
    sections: [requirements]
    detect:
      - pattern: 'NEEDLE'
        description: d
    suggested_action: fix it
`;

  it("flags a presence rule when the pattern occurs in a matching section", () => {
    const r = engineWith(presence).evaluate([
      { type: "requirements" as SectionType, content: "a NEEDLE here" },
    ]);
    expect(r.totalFlags).toBe(1);
    expect(r.findings[0].ruleId).toBe("001");
    expect(r.findings[0].matchCount).toBe(1);
    expect(r.familySummary).toEqual({ TT: 1 });
  });

  it("counts every occurrence in the finding", () => {
    const r = engineWith(presence).evaluate([
      { type: "requirements" as SectionType, content: "NEEDLE NEEDLE NEEDLE" },
    ]);
    expect(r.findings[0].matchCount).toBe(3);
    expect(r.findings[0].message).toContain("3 occurrences");
  });

  it("uses the singular form for one occurrence", () => {
    const r = engineWith(presence).evaluate([
      { type: "requirements" as SectionType, content: "NEEDLE" },
    ]);
    expect(r.findings[0].message).toContain("1 occurrence");
    expect(r.findings[0].message).not.toContain("occurrences");
  });

  it("does not flag when the pattern is absent", () => {
    const r = engineWith(presence).evaluate([
      { type: "requirements" as SectionType, content: "nothing here" },
    ]);
    expect(r.totalFlags).toBe(0);
    expect(r.familySummary).toEqual({});
  });

  it("ignores sections the rule does not apply to", () => {
    const r = engineWith(presence).evaluate([
      { type: "testing" as SectionType, content: "NEEDLE" },
    ]);
    expect(r.totalFlags).toBe(0);
  });

  it("honours a suppressor on the matching row", () => {
    const suppressed = presence.replace(
      "    suggested_action: fix it",
      `    suppress:
      - pattern: 'EXEMPT'
        scope: same_row
        description: d
    suggested_action: fix it`,
    );
    const r = engineWith(suppressed).evaluate([
      { type: "requirements" as SectionType, content: "NEEDLE but EXEMPT" },
    ]);
    expect(r.totalFlags).toBe(0);
  });

  it("returns an empty report for no sections", () => {
    const r = engineWith(presence).evaluate([]);
    expect(r).toMatchObject({ findings: [], totalFlags: 0, familySummary: {} });
  });
});

// ── Half 2: every shipped rule against its own declared fixtures ───────────

interface Fixture {
  readonly section: string;
  readonly content: string;
}
interface ShippedRule {
  readonly id: string;
  /**
   * Rule ids restart at 001 in every family file, so the id alone does not
   * identify a rule — `familyCode` + `id` does, which is exactly the pair an
   * AuditFinding carries.
   */
  readonly familyCode: string;
  readonly file: string;
  readonly display_name: string;
  readonly should_flag: readonly Fixture[];
  readonly should_pass: readonly Fixture[];
}

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "audit-flags", "rules");

function loadShippedRules(): ShippedRule[] {
  const out: ShippedRule[] = [];
  for (const file of readdirSync(RULES_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const doc = yaml.load(readFileSync(join(RULES_DIR, file), "utf8")) as {
      family?: { code?: string };
      rules?: Array<Record<string, any>>;
    };
    const familyCode = String(doc?.family?.code ?? "");
    for (const r of doc?.rules ?? []) {
      const tf = r.test_fixtures;
      if (!tf) continue;
      out.push({
        id: String(r.id),
        familyCode,
        file,
        display_name: String(r.display_name ?? r.name ?? r.id),
        should_flag: tf.should_flag ?? [],
        should_pass: tf.should_pass ?? [],
      });
    }
  }
  return out;
}

const shipped = loadShippedRules();
const shippedEngine = new AuditFlagEngine();

/** Keys are `familyCode/ruleId`, the pair that actually identifies a rule. */
const firedKeys = (fixtures: readonly Fixture[]): Set<string> => {
  const report = shippedEngine.evaluate(
    fixtures.map((f) => ({ type: f.section as SectionType, content: f.content })),
  );
  return new Set(report.findings.map((f) => `${f.familyCode}/${f.ruleId}`));
};

describe("shipped rule corpus", () => {
  it("loads every rule file from the packaged directory", () => {
    expect(shippedEngine.ruleCount).toBeGreaterThan(0);
    expect(shippedEngine.familyCodes.length).toBeGreaterThan(1);
  });

  it("declares fixtures for every rule it loads", () => {
    expect(shipped.length).toBe(shippedEngine.ruleCount);
  });
});

describe.each(shipped.map((r) => [`${r.file}#${r.id} ${r.display_name}`, r] as const))(
  "%s",
  (_label, rule) => {
    const key = `${rule.familyCode}/${rule.id}`;

    it("flags its should_flag fixture", () => {
      if (rule.should_flag.length === 0) return;
      expect([...firedKeys(rule.should_flag)]).toContain(key);
    });

    it("does not flag its should_pass fixture", () => {
      if (rule.should_pass.length === 0) return;
      expect([...firedKeys(rule.should_pass)]).not.toContain(key);
    });
  },
);
