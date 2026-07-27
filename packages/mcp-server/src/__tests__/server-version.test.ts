/**
 * Unit tests for the advertised-version resolver.
 *
 * The regression being pinned: `serverInfo.version` was a literal that said
 * 0.4.0 while the released artifact was 0.6.1. These cover each distribution
 * shape the resolver has to serve, plus the case where none of them is
 * readable — the one that must not invent a plausible number.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveServerVersion, UNRESOLVED_VERSION } from "../server-version.js";

let root: string;

/** Writes a package.json under `dir`, creating it. Returns the directory. */
function writePackageJson(dir: string, contents: unknown): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(contents, null, 2));
  return dir;
}

beforeEach(() => {
  // Unique temp root per test: two of these running in the same directory
  // would make the fallback order untestable.
  root = mkdtempSync(join(tmpdir(), "server-version-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveServerVersion", () => {
  it("reads the package.json shipped beside the bundle (plugin and .mcpb shape)", () => {
    const runtimeDir = writePackageJson(join(root, "mcp-server"), { version: "0.6.1" });
    expect(resolveServerVersion(runtimeDir, root)).toBe("0.6.1");
  });

  it("falls back to the root package.json when none ships beside the entry point", () => {
    // The workspace run: packages/mcp-server/dist/index.js, nothing beside it.
    writePackageJson(root, { version: "1.2.3" });
    const runtimeDir = join(root, "packages", "mcp-server", "dist");
    mkdirSync(runtimeDir, { recursive: true });
    expect(resolveServerVersion(runtimeDir, root)).toBe("1.2.3");
  });

  it("prefers the bundle-adjacent version over the root one", () => {
    writePackageJson(root, { version: "9.9.9" });
    const runtimeDir = writePackageJson(join(root, "mcp-server"), { version: "0.6.1" });
    expect(resolveServerVersion(runtimeDir, root)).toBe("0.6.1");
  });

  it("returns the unresolved sentinel rather than a plausible number", () => {
    expect(resolveServerVersion(join(root, "absent"), join(root, "also-absent"))).toBe(
      UNRESOLVED_VERSION,
    );
    expect(UNRESOLVED_VERSION).not.toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("skips a candidate whose package.json is malformed", () => {
    const runtimeDir = join(root, "mcp-server");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, "package.json"), "{ not json");
    writePackageJson(root, { version: "4.5.6" });
    expect(resolveServerVersion(runtimeDir, root)).toBe("4.5.6");
  });

  it("skips a candidate that declares no usable version", () => {
    const runtimeDir = writePackageJson(join(root, "mcp-server"), { name: "no-version" });
    writePackageJson(root, { version: "4.5.6" });
    expect(resolveServerVersion(runtimeDir, root)).toBe("4.5.6");

    const emptyVersion = writePackageJson(join(root, "empty"), { version: "" });
    expect(resolveServerVersion(emptyVersion, root)).toBe("4.5.6");
  });
});
