# Hand-written proposals

A proof written by a human (or by a model outside the runner) is handed to
the door through the scripted provider:

```
crew/run.py <ledger-id> --proposer scripted:crew/proposals/<file>.lean
```

The door treats it exactly like a proposal from a model: the same static
gate, the same `lake build`, the same `#print axioms`. Keeping the file in
the repository rather than in a temporary directory means the ledger's
`verified_by` points at something anyone can re-run.

These are not test fixtures. Those live in `crew/examples/`, are replayed
by `crew/test_crew.sh`, and include deliberately broken proposals.
