#!/usr/bin/env node
/**
 * stamp-bundle-version.mjs — copy the release version into the package.json
 * that ships beside the bundle.
 *
 * `mcp-server/package.json` travels with `mcp-server/index.js` in both shapes
 * users install (the plugin tree and the staged .mcpb), and since the server
 * stopped hardcoding its version it is what `serverInfo.version` is read from
 * at startup. That makes it a mirror of the root package.json version, and
 * mirrors go stale — this one already had, at 0.2.0 against a 0.6.1 release.
 *
 * So it is not maintained by hand. `pnpm bundle` runs this immediately after
 * esbuild, and CI re-bundles and diffs `mcp-server/`, which fails any commit
 * where the stamped value does not match the root version.
 *
 * Usage: node scripts/stamp-bundle-version.mjs [--check]
 *   (no flag)  rewrite mcp-server/package.json if the version differs
 *   --check    exit 1 on drift instead of writing, for a read-only gate
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO_ROOT, "package.json");
const TARGET = join(REPO_ROOT, "mcp-server", "package.json");

const checkOnly = process.argv.includes("--check");

const releaseVersion = JSON.parse(readFileSync(SOURCE, "utf-8")).version;
if (typeof releaseVersion !== "string" || releaseVersion.length === 0) {
  console.error(`stamp-bundle-version: ${SOURCE} declares no version`);
  process.exit(1);
}

const targetRaw = readFileSync(TARGET, "utf-8");
const target = JSON.parse(targetRaw);

if (target.version === releaseVersion) {
  console.log(`stamp-bundle-version: mcp-server/package.json already at ${releaseVersion}`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `stamp-bundle-version: mcp-server/package.json says ${target.version}, ` +
      `package.json says ${releaseVersion}. Run 'pnpm bundle' and commit the result.`,
  );
  process.exit(1);
}

// Key order is preserved by parse/stringify, so the rewrite touches one line.
// The trailing newline matches what the file already carries.
target.version = releaseVersion;
writeFileSync(TARGET, `${JSON.stringify(target, null, 2)}\n`);
console.log(`stamp-bundle-version: mcp-server/package.json ${target.version} <- package.json`);
