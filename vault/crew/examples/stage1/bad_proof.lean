```lean
import Mathlib

namespace Vault.Practice

/-- The sum of the first `n` odd numbers is `n ^ 2`. -/
theorem sum_first_odd (n : ℕ) : ∑ i ∈ Finset.range n, (2 * i + 1) = n ^ 2 := by
  induction n with
  | zero => simp
  | succ k ih => simp [Finset.sum_range_succ, ih]

end Vault.Practice
```
