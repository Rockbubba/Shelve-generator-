"""Provider for any OpenAI-compatible chat-completions endpoint.

Standard library only, so a second vendor costs no extra dependency.
Env: OPENAI_API_KEY (required), OPENAI_BASE_URL (default api.openai.com/v1).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


class OpenAICompatProvider:
    def __init__(self, model: str):
        self.model = model
        self.key = os.environ.get("OPENAI_API_KEY")
        if not self.key:
            raise SystemExit("OPENAI_API_KEY is not set")
        self.base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

    @property
    def name(self) -> str:
        return f"openai:{self.model}"

    def complete(self, system: str, user: str) -> str:
        body = json.dumps({
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }).encode()
        req = urllib.request.Request(
            f"{self.base}/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=1800) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"{self.name} HTTP {exc.code}: {exc.read()[:500]!r}") from exc
        choice = data["choices"][0]
        if choice.get("finish_reason") == "length":
            raise RuntimeError(f"{self.name} response truncated")
        return choice["message"]["content"] or ""
