# The crew

`crew/run.py` is the generate, critique, verify loop. It takes one `open`
ledger entry and tries to close it through the door.

```
crew/run.py <ledger-id> [--proposer SPEC] [--critic SPEC] [--rounds N]
```

Each round:

1. **Safecracker** (the proposer) gets the ledger entry, the current Lean
   file, and last round's feedback. It returns the whole file.
2. **Static gate.** The runner refuses the proposal before Lean runs if the
   target statement changed, an `axiom` appeared, or an import other than
   `Mathlib` was added.
3. **Inside man** (the critic, optional) attacks the proposal and returns
   `VERDICT: ACCEPT` or `REJECT` with objections. Lean runs either way; the
   objections go back to the proposer.
4. **The door.** `lake build`, then `#print axioms` on the target. Only
   `propext`, `Classical.choice`, `Quot.sound` are allowed.
5. On success the ledger flips to `verified` with `verified_at` and
   `verified_by`. On failure the file is restored and the errors become
   next round's feedback.

Every round is written to `ledger/attempts/<id>/` (the proposal and a JSON
record), and the entry's `attacked_by` list gets one line per run. Failed
runs are part of the record on purpose.

## Providers

| spec | needs | notes |
|---|---|---|
| `claude:<model>` | `ANTHROPIC_API_KEY` or `ant auth login` | official SDK, streaming, adaptive thinking, effort high |
| `openai:<model>` | `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` | any OpenAI-compatible chat endpoint, stdlib only |
| `scripted:<file-or-dir>` | nothing | replays canned responses; also how a human pushes a hand-written proof through the door |
| `none` | | no critic |

Default proposer is `claude:claude-opus-5`. Mixing vendors for proposer and
critic is the point: they share fewer blind spots.

```
pip install anthropic
crew/run.py practice.stage1_sum_first_odd --proposer claude:claude-opus-5 --critic openai:<model>
```

## Tests

`crew/test_crew.sh` runs the stage-one target through every outcome with
the scripted provider and restores the tree afterwards. No keys needed.
