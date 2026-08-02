#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOSTS = [
  {
    name: "codex",
    manifest: ".codex-plugin/plugin.json",
    placeholder: "${PLUGIN_ROOT}",
  },
  {
    name: "gemini-cli",
    manifest: "gemini-extension.json",
    placeholder: "${extensionPath}",
  },
];

const readJson = (relative) =>
  JSON.parse(readFileSync(join(ROOT, relative), "utf8"));

function responseById(stdout, id) {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.id === id) return parsed;
    } catch {
      // Server diagnostics belong on stderr; include non-JSON stdout in the
      // final transcript only if an expected response is missing.
    }
  }
  return null;
}

for (const host of HOSTS) {
  const manifest = readJson(host.manifest);
  const server = manifest.mcpServers["prd-spec-verifier"];
  assert.ok(server, `${host.name}: missing prd-spec-verifier declaration`);

  // This is the command the host consumes. Neither the launcher nor its
  // profile arguments are restated in this smoke test.
  const command = server.command.replaceAll(host.placeholder, ROOT);
  const args = server.args.map((arg) => arg.replaceAll(host.placeholder, ROOT));
  const isolatedHome = mkdtempSync(join(tmpdir(), `prd-verifier-${host.name}-`));
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: host.name, version: "ci" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "validate_prd_section",
        arguments: {
          section_type: "overview",
          content: "# Overview\nA portable verifier smoke test.",
        },
      },
    },
  ];

  try {
    const run = spawnSync(command, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: isolatedHome,
        PRD_GEN_SMOKE_HOST: host.name,
      },
      input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    assert.equal(run.error, undefined, `${host.name}: ${run.error?.message}`);
    assert.equal(
      run.status,
      0,
      `${host.name}: shipped command exited ${run.status}\n${run.stderr}\n${run.stdout}`,
    );

    const initialize = responseById(run.stdout, 1);
    assert.ok(initialize?.result?.serverInfo, `${host.name}: initialize failed\n${run.stdout}`);
    assert.equal(initialize.result.serverInfo.version, manifest.version);
    assert.match(initialize.result.instructions, /verifier/i);

    const list = responseById(run.stdout, 2);
    assert.deepEqual(
      list?.result?.tools?.map((tool) => tool.name).sort(),
      ["validate_prd_document", "validate_prd_section"],
      `${host.name}: verifier profile exposed the wrong tools`,
    );

    const call = responseById(run.stdout, 3);
    assert.equal(call?.error, undefined, `${host.name}: verifier call failed`);
    assert.equal(call?.result?.isError, undefined, `${host.name}: tool returned isError`);
    const report = JSON.parse(call.result.content[0].text);
    assert.equal(typeof report, "object", `${host.name}: verifier returned no report`);

    console.log(
      `PORTABLE HOST SMOKE OK: ${host.name}, ${initialize.result.serverInfo.version}, ` +
        `${list.result.tools.length} tools, validate_prd_section completed`,
    );
  } finally {
    rmSync(isolatedHome, { recursive: true, force: true });
  }
}
