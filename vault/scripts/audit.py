#!/usr/bin/env python3
"""Ledger audit: check every claim in ledger/ledger.json against Lean.

Exit code 0 means every entry's status matches what Lean reports.
Anything else is a failure and the reason is printed.

Usage:
  scripts/audit.py            # full audit (needs a built project)
  scripts/audit.py --schema   # ledger consistency only, no Lean
  scripts/audit.py --sync     # rewrite statuses to Lean's verdict, then audit
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "ledger" / "ledger.json"
AUDIT_LEAN = ROOT / "ledger" / ".audit.lean"
SRC = ROOT / "Vault"
ROOT_MODULE = ROOT / "Vault.lean"

STATUSES = {"unformalized", "open", "verified"}
KINDS = {"practice", "target", "lemma"}
ALLOWED_AXIOMS = {"propext", "Classical.choice", "Quot.sound"}

AXIOMS_RE = re.compile(r"^'(?P<name>[^']+)' depends on axioms: \[(?P<axioms>[^\]]*)\]")
NO_AXIOMS_RE = re.compile(r"^'(?P<name>[^']+)' does not depend on any axioms")


class AuditError(Exception):
    pass


def load_ledger() -> dict:
    with LEDGER.open() as fh:
        return json.load(fh)


def save_ledger(ledger: dict) -> None:
    with LEDGER.open("w") as fh:
        json.dump(ledger, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def check_schema(ledger: dict) -> list[str]:
    problems: list[str] = []
    entries = ledger.get("entries", [])
    ids = [e.get("id") for e in entries]
    for dup in {i for i in ids if ids.count(i) > 1}:
        problems.append(f"duplicate id {dup!r}")
    known = set(ids)
    for e in entries:
        eid = e.get("id", "<no id>")
        if e.get("kind") not in KINDS:
            problems.append(f"{eid}: kind must be one of {sorted(KINDS)}")
        status = e.get("status")
        if status not in STATUSES:
            problems.append(f"{eid}: status must be one of {sorted(STATUSES)}")
        decl, lfile = e.get("lean_decl"), e.get("lean_file")
        if status == "unformalized":
            if decl or lfile:
                problems.append(f"{eid}: unformalized entries must not name a Lean declaration")
        else:
            if not decl or not lfile:
                problems.append(f"{eid}: status {status} requires lean_decl and lean_file")
            elif not (ROOT / lfile).is_file():
                problems.append(f"{eid}: lean_file {lfile} does not exist")
        for dep in e.get("depends_on", []):
            if dep not in known:
                problems.append(f"{eid}: depends_on unknown id {dep!r}")
            elif dep == eid:
                problems.append(f"{eid}: depends on itself")
    return problems


def check_sources() -> list[str]:
    """Static checks on Lean sources: no axioms, every file imported."""
    problems: list[str] = []
    imported = set()
    for line in ROOT_MODULE.read_text().splitlines():
        m = re.match(r"^\s*import\s+(\S+)", line)
        if m:
            imported.add(m.group(1))
    for path in sorted(SRC.rglob("*.lean")):
        module = ".".join(path.relative_to(ROOT).with_suffix("").parts)
        if module not in imported:
            problems.append(f"{path.relative_to(ROOT)} is not imported from Vault.lean, so it is never built")
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if re.search(r"(^|-/)\s*(@\[[^\]]*\]\s*)?(private\s+|protected\s+)?axiom\s", line):
                problems.append(f"{path.relative_to(ROOT)}:{lineno}: `axiom` declarations are not allowed")
    return problems


def lean_axioms(decls: list[str]) -> dict[str, set[str] | None]:
    """Return {decl: set(axioms)} via #print axioms, None if the decl is unknown."""
    if not decls:
        return {}
    lines = ["import Vault", ""]
    lines += [f"#print axioms {d}" for d in decls]
    AUDIT_LEAN.write_text("\n".join(lines) + "\n")
    proc = subprocess.run(
        ["lake", "env", "lean", str(AUDIT_LEAN)],
        cwd=ROOT, capture_output=True, text=True,
    )
    out = proc.stdout + proc.stderr
    result: dict[str, set[str] | None] = {d: None for d in decls}
    for line in out.splitlines():
        m = AXIOMS_RE.match(line)
        if m:
            axioms = {a.strip() for a in m.group("axioms").split(",") if a.strip()}
            result[m.group("name")] = axioms
            continue
        m = NO_AXIOMS_RE.match(line)
        if m:
            result[m.group("name")] = set()
    missing = [d for d, v in result.items() if v is None]
    if missing or proc.returncode != 0:
        # Only fatal if something other than "unknown constant" went wrong.
        unexplained = [
            l for l in out.splitlines()
            if "error" in l and "unknown constant" not in l and "unknown identifier" not in l
        ]
        if unexplained:
            raise AuditError("lean failed:\n" + "\n".join(unexplained))
    return result


def verdict(axioms: set[str] | None) -> str:
    if axioms is None:
        return "missing"
    if "sorryAx" in axioms:
        return "open"
    if axioms <= ALLOWED_AXIOMS:
        return "verified"
    return "tainted"


def main(argv: list[str]) -> int:
    schema_only = "--schema" in argv
    sync = "--sync" in argv

    ledger = load_ledger()
    problems = check_schema(ledger) + check_sources()
    if problems:
        print("LEDGER INVALID")
        for p in problems:
            print("  -", p)
        return 2
    if schema_only:
        print(f"schema ok: {len(ledger['entries'])} entries")
        return 0

    formal = [e for e in ledger["entries"] if e["lean_decl"]]
    try:
        axioms = lean_axioms([e["lean_decl"] for e in formal])
    except AuditError as exc:
        print("AUDIT FAILED:", exc)
        return 3

    mismatches: list[str] = []
    rows: list[tuple[str, str, str, str]] = []
    now = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    for e in ledger["entries"]:
        claimed = e["status"]
        if not e["lean_decl"]:
            rows.append((e["id"], claimed, "-", "ok"))
            continue
        ax = axioms[e["lean_decl"]]
        actual = verdict(ax)
        if actual == "missing":
            mismatches.append(f"{e['id']}: declaration {e['lean_decl']} not found (did the build fail?)")
            rows.append((e["id"], claimed, actual, "FAIL"))
        elif actual == "tainted":
            extra = sorted((ax or set()) - ALLOWED_AXIOMS)
            mismatches.append(f"{e['id']}: proof depends on disallowed axioms {extra}")
            rows.append((e["id"], claimed, actual, "FAIL"))
        elif actual != claimed:
            if sync:
                e["status"] = actual
                if actual == "verified":
                    e["verified_at"] = now
                else:
                    e.pop("verified_at", None)
                rows.append((e["id"], claimed, actual, "synced"))
            else:
                mismatches.append(f"{e['id']}: ledger says {claimed}, Lean says {actual}")
                rows.append((e["id"], claimed, actual, "FAIL"))
        else:
            rows.append((e["id"], claimed, actual, "ok"))

    width = max(len(r[0]) for r in rows)
    print(f"{'entry'.ljust(width)}  {'ledger':<13}{'lean':<10}result")
    for eid, claimed, actual, res in rows:
        print(f"{eid.ljust(width)}  {claimed:<13}{actual:<10}{res}")

    if sync:
        save_ledger(ledger)
        problems = check_schema(ledger)
        if problems:
            print("ledger became invalid after sync:", problems)
            return 2

    if mismatches:
        print("\nAUDIT FAILED")
        for m in mismatches:
            print("  -", m)
        return 1
    print("\naudit ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
