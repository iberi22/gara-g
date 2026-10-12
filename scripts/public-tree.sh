#!/usr/bin/env bash
# scripts/public-tree.sh — Files that go into the PUBLIC GARA-G repository.
#
# Public tree = every tracked file except the owner-only overlay under private/.
# (@swal/ui, @swal/vault and @swal/edge-mesh are npm dependencies, not part of the tree.)
#
# Usage:
#   bash scripts/public-tree.sh          # one path per line
#   bash scripts/public-tree.sh --top    # top-level entries only
#   bash scripts/public-tree.sh -z       # NUL-separated (for xargs -0 / tar --null)
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-}"
case "$mode" in
  -z)
    git ls-files -z | { grep -z -v '^private/' || true; }
    ;;
  --top)
    git ls-files | { grep -v '^private/' || true; } | cut -d/ -f1 | sort -u
    ;;
  "")
    git ls-files | { grep -v '^private/' || true; }
    ;;
  *)
    echo "usage: $0 [--top|-z]" >&2
    exit 2
    ;;
esac
