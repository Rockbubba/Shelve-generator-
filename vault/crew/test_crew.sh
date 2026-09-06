#!/usr/bin/env bash
# Regression test for the crew runner, using the scripted provider only
# (no API keys). Exercises the stage-one target through every outcome:
# statement tampering, axiom smuggling, a wrong proof, a proof that closes
# on the second round, and the circularity gate on the ledger. Restores the
# working tree when done.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.elan/bin:$PATH"

ID=practice.stage1_sum_first_odd
EX=crew/examples/stage1
TMP=$(mktemp -d)
trap 'cp "$TMP/ledger.json" ledger/ledger.json; cp "$TMP/Stage1.lean" Vault/Practice/Stage1.lean; \
      rm -rf "ledger/attempts/$ID" "$TMP"; lake build >/dev/null 2>&1 || true' EXIT
cp ledger/ledger.json "$TMP/ledger.json"
cp Vault/Practice/Stage1.lean "$TMP/Stage1.lean"

expect() {  # expect <exit-code> <label> <args...>
  local want=$1 label=$2; shift 2
  set +e; python3 crew/run.py "$ID" "$@" >"$TMP/out.txt" 2>&1; local got=$?; set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL $label: exit $got, wanted $want"; cat "$TMP/out.txt"; exit 1
  fi
  echo "ok   $label (exit $got)"
}

# The circularity gate. Neither case needs Lean: both fail before a build.
patch_ledger() {  # patch_ledger <python statements operating on the entry `e`>
  python3 - "$1" <<'PYPATCH'
import json, pathlib, sys
p = pathlib.Path("ledger/ledger.json")
led = json.loads(p.read_text())
for e in led["entries"]:
    if e["id"] == "practice.stage1_sum_first_odd":
        exec(sys.argv[1])
p.write_text(json.dumps(led, indent=2, ensure_ascii=False) + "\n")
PYPATCH
}

patch_ledger 'e["toward"] = "target.riemann"'
if python3 scripts/audit.py --schema >/dev/null 2>&1; then
  echo "FAIL: entry serving a target with no circularity assessment passed the schema"; exit 1
fi
echo "ok   missing circularity rejected by the schema"

patch_ledger 'e["toward"] = "target.riemann"; e["circularity"] = {"verdict": "unassessed"}'
expect 2 "unassessed circularity refused" --proposer scripted:$EX/good.lean --rounds 1
grep -q "sorry" Vault/Practice/Stage1.lean || { echo "FAIL: the gate let the proposer run anyway"; exit 1; }
cp "$TMP/ledger.json" ledger/ledger.json

lake build >/dev/null 2>&1
expect 1 "tampered statement rejected"  --proposer scripted:$EX/tampered.lean    --rounds 1
expect 1 "axiom cheat rejected"         --proposer scripted:$EX/axiom_cheat.lean --rounds 1
expect 1 "wrong proof fails in Lean"    --proposer scripted:$EX/bad_proof.lean   --rounds 1
grep -q "sorry" Vault/Practice/Stage1.lean || { echo "FAIL: target file not restored after failure"; exit 1; }

mkdir -p "$TMP/seq"; cp $EX/bad_proof.lean "$TMP/seq/01.lean"; cp $EX/good.lean "$TMP/seq/02.lean"
expect 0 "bad then good closes on round 2" --proposer scripted:"$TMP/seq" --rounds 2
grep -q '"result": "verified"' ledger/ledger.json || { echo "FAIL: ledger not marked verified"; exit 1; }
python3 scripts/audit.py >/dev/null || { echo "FAIL: audit after close"; exit 1; }
echo "all crew tests passed"
