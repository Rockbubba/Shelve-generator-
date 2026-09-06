"""Replays canned responses. One file = one response; a directory is
replayed in sorted order, one file per call. Used by the tests and by a
human who wants to push a hand-written proposal through the door."""
from __future__ import annotations

from pathlib import Path


class ScriptedProvider:
    def __init__(self, path: str):
        p = Path(path)
        if p.is_dir():
            self.files = sorted(f for f in p.iterdir() if f.is_file())
        elif p.is_file():
            self.files = [p]
        else:
            raise SystemExit(f"scripted provider: {path} does not exist")
        self.path = path
        self.i = 0

    @property
    def name(self) -> str:
        return f"scripted:{self.path}"

    def complete(self, system: str, user: str) -> str:
        if self.i >= len(self.files):
            raise RuntimeError(f"{self.name}: no scripted response left for call {self.i + 1}")
        text = self.files[self.i].read_text()
        self.i += 1
        return text
