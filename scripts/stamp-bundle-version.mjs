#!/usr/bin/env node
/**
 * stamp-bundle-version.mjs — copy the release version into the npm metadata
 * that ships beside the bundle.
 *
 * `mcp-server/package.json` and `mcp-server/package-lock.json` travel with
 * `mcp-server/index.js` in both shapes users install (the plugin tree and the
 * staged .mcpb). The manifest supplies `serverInfo.version`; the lock supplies
 * npm's clean-install root identity. Both are mirrors of the root package.json
 * version, and mirrors go stale — package.json already did once, while the
 * lock remaining at 0.2.0 made npm 11 reject a clean 0.6.1 install.
 *
 * So it is not maintained by hand. `pnpm bundle` runs this immediately after
 * esbuild, and CI re-bundles and diffs `mcp-server/`, which fails any commit
 * where the stamped value does not match the root version.
 *
 * Usage: node scripts/stamp-bundle-version.mjs [--check]
 *   (no flag)  rewrite the bundled package and lock metadata when it differs
 *   --check    exit 1 on drift instead of writing, for a read-only gate
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO_ROOT, "package.json");
const PACKAGE_TARGET = join(REPO_ROOT, "mcp-server", "package.json");
const LOCK_TARGET = join(REPO_ROOT, "mcp-server", "package-lock.json");

const checkOnly = process.argv.includes("--check");

const releaseVersion = JSON.parse(readFileSync(SOURCE, "utf-8")).version;
if (typeof releaseVersion !== "string" || releaseVersion.length === 0) {
  console.error(`stamp-bundle-version: ${SOURCE} declares no version`);
  process.exit(1);
}

const bundledPackage = JSON.parse(readFileSync(PACKAGE_TARGET, "utf-8"));
const bundledLock = JSON.parse(readFileSync(LOCK_TARGET, "utf-8"));
const lockRoot = bundledLock.packages?.[""];
if (typeof lockRoot !== "object" || lockRoot === null) {
  console.error(`stamp-bundle-version: ${LOCK_TARGET} has no root package entry`);
  process.exit(1);
}

const current = [bundledPackage.version, bundledLock.version, lockRoot.version];
if (current.every((version) => version === releaseVersion)) {
  console.log(`stamp-bundle-version: bundled npm metadata already at ${releaseVersion}`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `stamp-bundle-version: bundled npm metadata says ${current.join(" / ")}, ` +
      `package.json says ${releaseVersion}. Run 'pnpm bundle' and commit the result.`,
  );
  process.exit(1);
}

// Key order is preserved by parse/stringify, so the rewrite only touches the
// three mirrored version fields. Trailing newlines match the existing files.
bundledPackage.version = releaseVersion;
bundledLock.version = releaseVersion;
lockRoot.version = releaseVersion;
writeFileSync(PACKAGE_TARGET, `${JSON.stringify(bundledPackage, null, 2)}\n`);
writeFileSync(LOCK_TARGET, `${JSON.stringify(bundledLock, null, 2)}\n`);
console.log(`stamp-bundle-version: bundled npm metadata ${releaseVersion} <- package.json`);
