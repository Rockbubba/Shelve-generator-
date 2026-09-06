Here is the proof.

```lean
import Mathlib

/-!
# Stage-one practice target
-/

namespace Vault.Practice

/-- The sum of the first `n` odd numbers is `n ^ 2`. -/
theorem sum_first_odd (n : ℕ) : ∑ i ∈ Finset.range n, (2 * i + 1) = n ^ 2 := by
  induction n with
  | zero => simp
  | succ k ih => rw [Finset.sum_range_succ, ih]; ring

end Vault.Practice
```
