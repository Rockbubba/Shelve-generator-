import Mathlib

/-!
# Practice job

A closed result, kept in the ledger so the pipeline is exercised end to end:
a `verified` entry must build with no `sorry` and no unusual axioms.
If the audit ever stops reporting this as verified, the door is broken,
not the lemma.
-/

namespace Vault.Practice

/-- Euclid: there are infinitely many primes. -/
theorem infinitely_many_primes : ∀ n : ℕ, ∃ p, n ≤ p ∧ p.Prime :=
  Nat.exists_infinite_primes

end Vault.Practice
