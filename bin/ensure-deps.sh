#!/usr/bin/env bash
#
# ensure-deps.sh — provision the MCP server bundle's externalised runtime
# dependencies on first launch, then exec the server.
#
# The committed bundle (mcp-server/index.js) is produced by `pnpm bundle`
# (esbuild). Three runtime dependencies are intentionally *external* to that
# bundle and must resolve from node_modules at launch:
#
#   - ajv, ajv-formats — ajv's runtime-compiled validators `require()` their
#     helpers (ajv/dist/runtime/*) via specifiers esbuild cannot statically
#     inline, so ajv must exist on disk. Static require => needed at load.
#   - better-sqlite3   — native addon; the platform-specific binary cannot be
#     bundled or committed cross-platform. Loaded via dynamic import() and
#     guarded by tryCreateEvidenceRepository => OPTIONAL: its absence only
#     disables the evidence-DB cache, it does not block startup. Declared as
#     an optionalDependency so a failed native build is non-fatal.
#
# `claude plugin install` clones repository files but runs no install step, so
# this launcher provisions `mcp-server/node_modules` next to the bundle on the
# first run, then hands off to node. Idempotent: it no-ops once the deps are
# present, so steady-state launch cost is a single directory check.
#
# Mirrors automatised-pipeline's bin/ensure-binary.sh ensure-then-exec launcher.
# source: coding-standards.md §2.2 (composition-root provisioning); follow-up to
# the MCP-startup-deadlock fix (PR #2).
#
set -euo pipefail

ROOT="${1:?usage: ensure-deps.sh <plugin-root> [server-args...]}"
shift
SERVER_DIR="${ROOT}/mcp-server"

# The portable Codex/Gemini manifests select the two-tool verifier profile.
# That profile cannot reach the evidence repository, so compiling its optional
# better-sqlite3 dependency on first launch adds cost without adding a usable
# capability. Keep the existing full-profile path unchanged, while installing
# only the verifier's required JavaScript dependencies for the narrow profile.
PROFILE="${PRD_GEN_PROFILE:-}"
EXPECT_PROFILE_VALUE=0
for ARG in "$@"; do
  if [[ "$EXPECT_PROFILE_VALUE" -eq 1 ]]; then
    PROFILE="$ARG"
    EXPECT_PROFILE_VALUE=0
    continue
  fi
  case "$ARG" in
    --profile)
      EXPECT_PROFILE_VALUE=1
      ;;
    --profile=*)
      PROFILE="${ARG#--profile=}"
      ;;
  esac
done

NPM_OMIT=(--omit=dev)
if [[ "$PROFILE" == "verifier" ]]; then
  NPM_OMIT+=(--omit=optional)
fi

# ajv is a hard (static) dependency of the bundle; its presence is the
# provisioning sentinel. Full/agent profiles install better-sqlite3 in the
# same pass and, being an optionalDependency, tolerate an unavailable native
# build; the verifier profile omits it because none of its tools can use it.
if [[ ! -d "${SERVER_DIR}/node_modules/ajv" ]]; then
  echo "prd-gen: first launch — installing MCP server runtime deps…" >&2
  # `npm ci` against the COMMITTED mcp-server/package-lock.json, not
  # `npm install`. This step runs on the user's machine at first launch, so
  # `npm install` re-resolved the tree there: whatever `^8.17.1` meant on that
  # day is what shipped, with no integrity check. `npm ci` installs the exact
  # locked tree and verifies every `integrity` hash in the lockfile (44 of its
  # 45 entries carry one; the root project entry has no tarball).
  #
  # The lockfile is committed for the same reason the bundle is: `claude plugin
  # install` clones repository files and runs no install step, so anything not
  # in the repo does not exist at launch.
  #
  # source: Scorecard PinnedDependenciesID (issue #36). Its shell checker
  # accepts exactly one npm form — checks/raw/shell_download_validate.go
  # `isNpmUnpinnedDownload` treats a command as pinned only when it contains
  # `ci`. Pinning versions inside `npm install pkg@1.2.3` does NOT satisfy it,
  # and would not verify hashes either.
  # Run from the package directory instead of relying on `npm --prefix`.
  # npm 11 interprets an out-of-tree prefix as a local package reference and
  # rejects the otherwise-valid lock as missing `mcp-server@<version>`.
  (
    cd "${SERVER_DIR}"
    npm ci "${NPM_OMIT[@]}" --no-audit --no-fund --loglevel=error >&2
  )
fi

# Forward optional server arguments so host-specific manifests can select a
# narrow profile. Existing Claude launches pass no extra arguments and retain
# the default `full` surface byte-for-byte.
exec node "${SERVER_DIR}/index.js" "$@"
