import Mathlib

/-!
# Riemann Hypothesis

Mathlib already states the conjecture as `RiemannHypothesis`
(`Mathlib/NumberTheory/LSeries/RiemannZeta.lean`):

    ∀ (s : ℂ), riemannZeta s = 0 → (¬∃ n : ℕ, s = -2 * (n + 1)) → s ≠ 1 → s.re = 1 / 2

This file holds the ledger's target declaration. The proof is `sorry`
until Lean says otherwise. Replacing `sorry` with anything that builds
without `sorryAx` is the only way this entry becomes `verified`.
-/

namespace Vault.Targets

theorem riemann_hypothesis : RiemannHypothesis := by
  sorry

end Vault.Targets
