#!/usr/bin/env bash
# scripts/check-public-tree.sh — Fails if the public tree (scripts/public-tree.sh) leaks anything:
#   1. real Cloudflare account / D1 / KV / R2 identifiers (checked by SHA-256, so this public
#      script does not itself contain them; when the private infra config is present its
#      current ids are checked too);
#   2. forbidden strings (demo admin password, service account key files, Google API keys);
#   3. gitleaks findings (default rules + .gitleaks.toml) over the public files only.
#
# Exit 0 = clean, 1 = findings, 2 = could not run (e.g. gitleaks missing).
# gitleaks: on PATH, or SECRET_SCAN_BIN=/path/to/gitleaks. SKIP_SECRET_SCAN=1 skips step 3 (CI
# must not set it).
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/check-public-tree.mjs "$@"
