"""Anthropic provider. Uses the official SDK; nothing else."""
from __future__ import annotations

import anthropic


class ClaudeProvider:
    name_prefix = "claude"

    def __init__(self, model: str, effort: str = "high"):
        self.model = model
        self.effort = effort
        # Credentials resolve from ANTHROPIC_API_KEY or an `ant auth login` profile.
        self.client = anthropic.Anthropic()

    @property
    def name(self) -> str:
        return f"claude:{self.model}"

    def complete(self, system: str, user: str) -> str:
        # Streaming keeps long proofs clear of request timeouts. Thinking is
        # adaptive by default on current models; effort sets how hard it tries.
        # Server-side fallbacks re-run a policy-declined request on another
        # model inside the same call instead of returning nothing.
        with self.client.beta.messages.stream(
            model=self.model,
            max_tokens=64000,
            system=system,
            messages=[{"role": "user", "content": user}],
            thinking={"type": "adaptive"},
            output_config={"effort": self.effort},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            msg = stream.get_final_message()
        if msg.stop_reason == "refusal":
            detail = getattr(msg, "stop_details", None)
            why = getattr(detail, "explanation", None) or "no explanation"
            raise RuntimeError(f"{self.name} refused: {why}")
        if msg.stop_reason == "max_tokens":
            raise RuntimeError(f"{self.name} hit max_tokens; response truncated")
        return "".join(b.text for b in msg.content if b.type == "text")
