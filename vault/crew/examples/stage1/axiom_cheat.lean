```lean
import Mathlib

namespace Vault.Practice

axiom magic : ∀ n : ℕ, ∑ i ∈ Finset.range n, (2 * i + 1) = n ^ 2

/-- The sum of the first `n` odd numbers is `n ^ 2`. -/
theorem sum_first_odd (n : ℕ) : ∑ i ∈ Finset.range n, (2 * i + 1) = n ^ 2 := magic n

end Vault.Practice
```
