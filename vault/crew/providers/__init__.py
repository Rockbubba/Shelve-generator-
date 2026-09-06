"""Model providers for the crew runner.

A provider spec is a string `vendor:model` (or `scripted:path`). Every
provider exposes one method:

    complete(system: str, user: str) -> str

Vendors:
  claude:<model>      Anthropic API via the official SDK. Credentials from
                      ANTHROPIC_API_KEY or an `ant auth login` profile.
  openai:<model>      Any OpenAI-compatible chat-completions endpoint.
                      OPENAI_API_KEY, optional OPENAI_BASE_URL.
  scripted:<path>     Replays a file (or the files in a directory, in
                      order) as responses. For tests and for hand-written
                      proposals from a human safecracker.
  none                No provider (used to run without a critic).
"""
from __future__ import annotations


def get_provider(spec: str):
    if spec in ("none", "", None):
        return None
    vendor, _, arg = spec.partition(":")
    if vendor == "claude":
        from .claude import ClaudeProvider
        return ClaudeProvider(arg or "claude-opus-5")
    if vendor == "openai":
        from .openai_compat import OpenAICompatProvider
        if not arg:
            raise SystemExit("openai provider needs a model: openai:<model>")
        return OpenAICompatProvider(arg)
    if vendor == "scripted":
        from .scripted import ScriptedProvider
        if not arg:
            raise SystemExit("scripted provider needs a path: scripted:<file-or-dir>")
        return ScriptedProvider(arg)
    raise SystemExit(f"unknown provider vendor {vendor!r} in {spec!r}")
