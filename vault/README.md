# The Vault

A proof-checking harness for attacking hard open problems with a crew of
humans and language models. The premise: models generate plausible proofs
cheaply and are wrong often, so the whole project is only as good as the
thing that says no. That thing is Lean 4 with Mathlib. Nothing else counts.

## Layout

```
vault/
  lean-toolchain        pinned Lean version (matches the Mathlib tag below)
  lakefile.toml         Lake project, depends on Mathlib v4.33.1
  Vault.lean            root module; every source file must be imported here
  Vault/
    Practice/           closed results used to exercise the pipeline
    Targets/            formal statements of the open problems, proofs are `sorry`
  ledger/ledger.json    the blueprint on the wall: every claim and its status
  ledger/attempts/      one directory per entry: every proposal the crew made
  crew/run.py           the crew: generate, critique, verify loop (see crew/README.md)
  crew/test_crew.sh     regression test for the loop, no API keys needed
  scripts/check.sh      the door: build + audit, exit 0 or nothing changes hands
  scripts/audit.py      compares every ledger status against `#print axioms`
```

## Rules of the vault

1. **Lean is the only judge.** A status in the ledger is a claim. The audit
   checks every claim against compiled code and fails on any mismatch.
2. **Three statuses.**
   - `unformalized`: prose only, no Lean declaration. Cannot be verified.
   - `open`: the declaration compiles but the proof, or something it depends
     on, still uses `sorry`.
   - `verified`: compiles, and `#print axioms` shows nothing beyond
     `propext`, `Classical.choice`, `Quot.sound`.
3. **No `axiom` declarations** anywhere under `Vault/`. The audit rejects
   them statically, and `#print axioms` would catch them anyway.
4. **Every file is built.** A file not imported from `Vault.lean` is never
   checked, so the audit refuses to run until it is.
5. **The canary must stay green.** `practice.infinitely_many_primes` is
   always `verified`. If it is not, the door is broken, not the lemma.

## Running the door

```
cd vault
scripts/check.sh          # first run fetches Mathlib's prebuilt cache (~5 GB)
scripts/check.sh --sync   # same, but rewrite ledger statuses to Lean's verdict
scripts/audit.py --schema # ledger consistency only, no Lean needed
```

Requires [elan](https://github.com/leanprover/elan); the pinned toolchain
installs itself on first use.

## Adding a lemma

1. Add a declaration under `Vault/` with the statement and `sorry` as proof.
   Import the file from `Vault.lean`.
2. Add a ledger entry with `kind: "lemma"`, `status: "open"`, the full
   declaration name in `lean_decl`, the file in `lean_file`, who proposed it,
   its prerequisites in `depends_on` (other ledger ids it uses), and the
   target it serves in `toward`.
3. Run `scripts/check.sh`. It must pass with the entry reported `open`.
4. When a proof lands, run `scripts/check.sh --sync`. The entry flips to
   `verified` only if Lean agrees, and `verified_at` is stamped.

## The crew

`crew/run.py` drives models at an `open` entry through the door. See
`crew/README.md`. The stage-one practice target
`practice.stage1_sum_first_odd` ships `open` on purpose: closing it is the
first job, and `crew/test_crew.sh` proves the loop can.

## Current targets

Only the Riemann Hypothesis has a formal statement, because Mathlib already
defines `RiemannHypothesis`. The other five open problems, and the Poincare
dry run, are `unformalized`: their first lemma is stating them. See the
`notes` field of each ledger entry for what Mathlib is missing.

Two stage-two lemmas sit under the Riemann target in
`Vault/Lemmas/ZetaCriticalStrip.lean`: zeta has only trivial zeros for
`re s ≤ 0`, and every nontrivial zero lies in the open critical strip.
Classical results, absent from Mathlib, with a proof sketch in the ledger
notes. They are the first real jobs for the crew after the stage-one lemma.

## What this is not

It is not a proof search engine, not a model orchestrator, and not a claim
that any of these problems is within reach. It is the part of the heist you
build before you argue about who drives.
