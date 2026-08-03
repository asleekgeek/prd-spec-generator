import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const text = (path) => readFileSync(join(root, path), "utf8");

const product = "prd-spec-generator";
const distribution = "ai-architect-mcp-spec";
const registryId = `io.github.cdeust/${distribution}`;
const pkg = json("package.json");
const version = pkg.version;

assert.equal(pkg.name, product);
for (const path of [
  "manifest.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "gemini-extension.json",
  "mcp-server/package.json",
]) {
  assert.equal(json(path).version, version, `${path} version must be ${version}`);
}

const marketplace = json(".claude-plugin/marketplace.json");
assert.equal(marketplace.metadata.version, version);
assert.equal(marketplace.plugins.find(({ name }) => name === product)?.version, version);

const server = json("server.json");
assert.equal(server.name, registryId);
assert.equal(server.version, version);
assert.equal(server.packages[0].version, version);
assert.equal(
  server.packages[0].identifier,
  `https://github.com/cdeust/${product}/releases/download/v${version}/${distribution}.mcpb`,
);
assert.match(server.packages[0].fileSha256, /^[a-f0-9]{64}$/);

assert.match(text("README.md"), new RegExp(`<!-- mcp-name: ${registryId} -->`));
assert.match(text("CHANGELOG.md"), new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\]`, "m"));
const release = text(".github/workflows/release.yml");
assert.match(release, new RegExp(`${distribution}\\.mcpb`));
assert.match(release, new RegExp(`${product}\\.mcpb`));

console.log(`Distribution identity is consistent at ${distribution} v${version}.`);
