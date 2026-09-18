import Mathlib

/-!
# Stage-one practice target

Provable from Mathlib in a few lines, shipped with `sorry` on purpose.
This is the first job the crew runner should close. Nothing about the
statement is interesting; what matters is that the loop can take an
`open` entry to `verified` through the door without a human touching
Lean. See `crew/README.md`.
-/

namespace Vault.Practice

/-- The sum of the first `n` odd numbers is `n ^ 2`. -/
theorem sum_first_odd (n : ℕ) : ∑ i ∈ Finset.range n, (2 * i + 1) = n ^ 2 := by
  sorry

end Vault.Practice
