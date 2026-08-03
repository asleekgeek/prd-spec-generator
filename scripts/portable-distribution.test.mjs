import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const text = (path) => readFileSync(join(ROOT, path), "utf8");

const EXPECTED_ARGS = ["--profile", "verifier"];
const SKILLS = ["audit-prd", "validate-spec"];

test("Codex and Gemini launch the same verifier profile", () => {
  const pkg = json("package.json");
  const codex = json(".codex-plugin/plugin.json");
  const gemini = json("gemini-extension.json");
  const marketplace = json(".agents/plugins/marketplace.json");
  const codexServer = codex.mcpServers["prd-spec-verifier"];
  const geminiServer = gemini.mcpServers["prd-spec-verifier"];
  const marketplaceEntry = marketplace.plugins.find(
    (entry) => entry.name === "prd-spec-generator",
  );

  assert.equal(codex.version, pkg.version);
  assert.equal(gemini.version, pkg.version);
  assert.equal(codex.skills, "./skills/");
  assert.equal(marketplace.name, "prd-spec-generator-marketplace");
  assert.deepEqual(marketplaceEntry.source, { source: "local", path: "./" });
  assert.equal(codexServer.command, "node");
  assert.equal(geminiServer.command, "node");
  assert.deepEqual(codexServer.args.slice(-2), EXPECTED_ARGS);
  assert.deepEqual(geminiServer.args.slice(-2), EXPECTED_ARGS);
  assert.equal(codexServer.args[0], "${PLUGIN_ROOT}/mcp-server/index.js");
  assert.equal(geminiServer.args[0], "${extensionPath}/mcp-server/index.js");
});

test("portable skill manifests contain only supported frontmatter", () => {
  for (const name of SKILLS) {
    const skill = text(`skills/${name}/SKILL.md`);
    const match = /^---\n([\s\S]*?)\n---\n/.exec(skill);
    assert.ok(match, `${name}: missing YAML frontmatter`);
    const keys = match[1]
      .split("\n")
      .filter((line) => /^[a-z]/.test(line))
      .map((line) => line.slice(0, line.indexOf(":")))
      .sort();
    assert.deepEqual(keys, ["description", "name"], `${name}: unsupported frontmatter`);
    assert.match(skill, /does not (establish|prove)/i);
  }
});

test("Claude remains on its existing full-profile launch path", () => {
  const claude = json(".mcp.json");
  const server = claude.mcpServers["prd-gen"];
  assert.equal(server.args.includes("--profile"), false);
  assert.match(server.args[0], /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(text("bin/ensure-deps.sh"), /exec node .*"\$@"/);
});
