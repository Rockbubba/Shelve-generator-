#!/usr/bin/env bash
# Regression test for the crew runner, using the scripted provider only
# (no API keys). Exercises the stage-one target through every outcome:
# statement tampering, axiom smuggling, a wrong proof, and a proof that
# closes on the second round. Restores the working tree when done.
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
