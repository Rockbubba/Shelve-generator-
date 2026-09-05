#!/usr/bin/env bash
# The vault door. Builds everything, then audits every ledger claim.
# Exit 0 is the only acceptable outcome before a status changes hands.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.elan/bin:$PATH"

if [ ! -d .lake/packages/mathlib ]; then
  echo "first run: fetching Mathlib and its prebuilt cache (several GB)"
  lake exe cache get
fi

python3 scripts/audit.py --schema
lake build
python3 scripts/audit.py "$@"
