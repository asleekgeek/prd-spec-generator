#!/usr/bin/env bash
# publish-mcp-registry.sh — Publish runbook for AI Architect MCP Spec.
#
# NOTE (#23): the release workflow patches server.json's
# packages[0].fileSha256 with the real .mcpb checksum on every tag push,
# pushes a dedicated release branch, and opens a PR because main is protected.
# Steps 3-4 below are a MANUAL FALLBACK when that automated PR is absent.
# Registry submission remains manual regardless.
#
# USAGE:
#   ./scripts/publish-mcp-registry.sh <tag>
#   ./scripts/publish-mcp-registry.sh v0.4.0
#
# WHAT THIS SCRIPT DOES:
#   1. Downloads the released ai-architect-mcp-spec.mcpb from GitHub Releases.
#   2. Computes its SHA-256 and writes it into server.json .packages[0].fileSha256.
#   3. Prints the mcp-publisher commands you must run manually to submit to all three
#      registries (MCP Registry, Glama, Anthropic MCP Directory).
#
# WHAT THIS SCRIPT DOES NOT DO:
#   - It does NOT run mcp-publisher itself.
#   - It does NOT git commit or push.
#   - It does NOT create a GitHub Release (that is done by the CI workflow).
#
# PRE-REQUISITES:
#   - jq installed (brew install jq / apt-get install jq)
#   - curl installed
#   - shasum available (macOS built-in; on Linux: sha256sum)
#   - mcp-publisher installed: npm install -g mcp-publisher  (or npx -y mcp-publisher)
#   - GitHub CLI authenticated: gh auth login
#
# FULL PUBLISH RUNBOOK
# ════════════════════
#
# Step 1  — Tag and push the release (triggers CI, which builds the .mcpb):
#             git tag v0.4.0
#             git push origin v0.4.0
#
# Step 2  — Wait for CI to create the GitHub release and checksum PR. Confirm
#             the .mcpb and .sha256 assets, then merge the green checksum PR.
#
# Step 3  — Run this script to patch server.json with the real SHA-256:
#             ./scripts/publish-mcp-registry.sh v0.4.0
#
# Step 4  — Commit the updated server.json through a PR (main is protected):
#             git switch -c release/v0.4.0-server-json
#             git add server.json
#             git commit -m "chore: update server.json sha256 for v0.4.0"
#             git push -u origin release/v0.4.0-server-json
#             gh pr create --base main --fill
#
# Step 5  — Authenticate with mcp-publisher (GitHub OAuth):
#             mcp-publisher login github
#
# Step 6  — Submit to MCP Registry (uses server.json):
#             mcp-publisher publish
#
# Step 7  — Deprecate every version of the former registry identity, but only
#             AFTER the new identity above is active:
#             mcp-publisher status --status deprecated --all-versions \
#               --message "Moved to io.github.cdeust/ai-architect-mcp-spec" \
#               io.github.cdeust/prd-spec-generator
#
# Step 8  — Submit to Glama (uses glama.json; may be automatic on registry merge):
#             # Glama crawls repos that have glama.json — typically no manual step needed.
#             # If Glama provides a CLI: mcp-publisher publish --registry glama
#
# Step 9  — Submit to Anthropic MCP Directory / Claude Desktop bundle:
#             # The Anthropic directory indexes servers listed in the MCP Registry.
#             # No separate submission is required once Step 6 is approved.
#
# ════════════════════

set -euo pipefail

TAG="${1:-}"
if [ -z "${TAG}" ]; then
  echo "Usage: $0 <tag>  (e.g. $0 v0.4.0)" >&2
  exit 1
fi

REPO="cdeust/ai-architect-mcp-spec"
BUNDLE_NAME="ai-architect-mcp-spec.mcpb"
RELEASE_URL="https://github.com/${REPO}/releases/download/${TAG}/${BUNDLE_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_JSON="${REPO_ROOT}/server.json"

echo "==> Downloading ${BUNDLE_NAME} from ${RELEASE_URL} ..."
TMP_FILE="$(mktemp /tmp/prd-spec-generator-XXXXXX.mcpb)"
curl -fSL "${RELEASE_URL}" -o "${TMP_FILE}"

echo "==> Computing SHA-256 ..."
if command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "${TMP_FILE}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "${TMP_FILE}" | awk '{print $1}')"
else
  echo "ERROR: neither shasum nor sha256sum found." >&2
  exit 1
fi
rm -f "${TMP_FILE}"

echo "==> SHA-256: ${SHA256}"

echo "==> Patching server.json ..."
PATCHED="$(jq --arg sha "${SHA256}" '.packages[0].fileSha256 = $sha' "${SERVER_JSON}")"
echo "${PATCHED}" > "${SERVER_JSON}"
echo "    server.json updated."

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  NEXT STEPS (run these commands manually after reviewing)"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "  # Commit the updated server.json through protected-main review:"
echo "  git switch -c release/${TAG}-server-json"
echo "  git add server.json"
echo "  git commit -m 'chore: update server.json sha256 for ${TAG}'"
echo "  git push -u origin release/${TAG}-server-json"
echo "  gh pr create --base main --fill"
echo ""
echo "  # Authenticate and publish to MCP Registry:"
echo "  mcp-publisher login github"
echo "  mcp-publisher publish"
echo "  # After the new identity is active, deprecate the former registry entries:"
echo "  mcp-publisher status --status deprecated --all-versions --message \"Moved to io.github.cdeust/ai-architect-mcp-spec\" io.github.cdeust/prd-spec-generator"
echo ""
echo "══════════════════════════════════════════════════════════"
