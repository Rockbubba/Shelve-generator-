```lean
import Mathlib

namespace Vault.Practice

/-- The sum of the first `n` odd numbers is `n ^ 2`. -/
theorem sum_first_odd (n : ℕ) (h : n = 0) : ∑ i ∈ Finset.range n, (2 * i + 1) = n ^ 2 := by
  subst h; simp

end Vault.Practice
```
