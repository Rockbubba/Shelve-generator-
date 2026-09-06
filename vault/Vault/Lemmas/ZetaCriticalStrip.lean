import Mathlib

/-!
# Zeros of zeta outside the critical strip

Stage-two targets. Mathlib proves that `riemannZeta` has no zeros with
`1 ≤ re s` (`riemannZeta_ne_zero_of_one_le_re`) and has the functional
equation `riemannZeta_one_sub`, but does not yet record the classical
consequence that the only zeros with `re s ≤ 0` are the trivial ones,
nor the corollary that every nontrivial zero lies in the open strip
`0 < re s < 1`. Both are stated here with `sorry`.

The crew closes these through the door. Nothing here is new mathematics;
that is the point of a stage-two job.
-/

namespace Vault.Lemmas

/-- The only zeros of `riemannZeta` in the half-plane `re s ≤ 0` are the
trivial zeros `-2, -4, -6, …`. -/
theorem riemannZeta_ne_zero_of_re_le_zero {s : ℂ} (hs : s.re ≤ 0)
    (h : ¬∃ n : ℕ, s = -2 * (n + 1)) : riemannZeta s ≠ 0 := by
  sorry

/-- Every nontrivial zero of `riemannZeta` lies in the open critical strip. -/
theorem re_mem_Ioo_of_riemannZeta_eq_zero {s : ℂ} (hs : riemannZeta s = 0)
    (h : ¬∃ n : ℕ, s = -2 * (n + 1)) : 0 < s.re ∧ s.re < 1 := by
  sorry

end Vault.Lemmas
