import Mathlib

/-!
# Stage-one practice target

Closed by hand and pushed through the door with the scripted provider,
which `crew/README.md` documents as the way a human hands the vault a
proof. The route is the obvious one: induction on `n`, peel the last
term off the range with `Finset.sum_range_succ`, and let `ring` finish
`k ^ 2 + (2 * k + 1) = (k + 1) ^ 2`.
-/

namespace Vault.Practice

/-- The sum of the first `n` odd numbers is `n ^ 2`. -/
theorem sum_first_odd (n : ℕ) : ∑ i ∈ Finset.range n, (2 * i + 1) = n ^ 2 := by
  induction n with
  | zero => simp
  | succ k ih => rw [Finset.sum_range_succ, ih]; ring

end Vault.Practice
