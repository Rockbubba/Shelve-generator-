#!/usr/bin/env python3
"""The crew runner: generate, critique, verify.

    crew/run.py <ledger-id> [--proposer SPEC] [--critic SPEC] [--rounds N]

One `open` ledger entry at a time. Each round: the proposer returns a
complete replacement for the entry's Lean file; the runner refuses it if
the target statement changed or an `axiom` appeared; the critic (if any)
attacks it; Lean builds it; the audit decides. `verified` is written to
the ledger only when Lean says so. Every attempt, pass or fail, is
recorded under ledger/attempts/<id>/ and summarised in the entry's
`attacked_by` list.

Provider specs: claude:<model> | openai:<model> | scripted:<path> | none
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "crew"))
import audit  # noqa: E402
from providers import get_provider  # noqa: E402

ATTEMPTS = ROOT / "ledger" / "attempts"
FENCE_RE = re.compile(r"```(?:lean4?|Lean)?\s*\n(.*?)```", re.DOTALL)
AXIOM_RE = re.compile(r"(^|-/)\s*(@\[[^\]]*\]\s*)?(private\s+|protected\s+)?axiom\s", re.MULTILINE)

PROPOSER_SYSTEM = """You are a safecracker on a formal-proof crew. The judge is Lean 4 with Mathlib {mathlib}. Nothing you say counts; only what Lean accepts.

You will be given one Lean file containing a declaration whose proof is `sorry`, plus the ledger entry describing it and any feedback from earlier rounds. Return the COMPLETE new contents of that file inside a single ```lean fenced block, and nothing else outside the block.

Rules, enforced mechanically before Lean even runs:
- The statement of `{decl}` (everything from the `theorem` keyword to `:=`) must stay exactly as given, up to whitespace. Do not weaken, restate, or rename it.
- No `axiom` declarations. No `sorry`. No `native_decide` tricks that hide work in unchecked code.
- Keep `import Mathlib` as the only import. Do not reference files that do not exist.
- You may add helper lemmas above the target in the same file, fully proved. A helper must be genuinely smaller than the target; if the only route you see is to assume something as strong as what this entry serves, say so in a comment instead of dressing it up as a lemma.

If you cannot finish, still return your best complete file; Lean's errors come back to you next round. Prefer short proofs that lean on Mathlib lemmas over long tactic scripts."""

CRITIC_SYSTEM = """You are the inside man on a formal-proof crew. Your only job is to find why a proposed Lean proof is wrong, a cheat, or not what was asked. You are not here to be encouraging.

Check, in order:
1. Has the target statement been altered, weakened, or had hypotheses added compared with the original?
2. Is anything smuggled in: an `axiom`, an unsound `instance`, `sorry` hidden in a helper, `native_decide`, `decide` on a goal too large to actually run, or `unsafe` code?
3. Is the mathematics sound? Point at the specific step that fails and say why.
4. Is the difficulty merely relocated? Lean cannot catch this one, so it is yours. If a helper lemma, a definition, or a hypothesis carries the real content and is itself as hard as the entry's target, the proposal is not progress even when it compiles. Name the step and say what it is equivalent to.
5. Would a Mathlib maintainer accept this as a proof of the stated theorem?

First line of your reply must be exactly `VERDICT: ACCEPT` or `VERDICT: REJECT`. Then list objections, most serious first, each pointing at a line or a name. Lean will run regardless of your verdict; your objections are fed back to the proposer."""


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def mathlib_rev() -> str:
    try:
        man = json.loads((ROOT / "lake-manifest.json").read_text())
        for pkg in man.get("packages", []):
            if pkg.get("name") == "mathlib":
                return pkg.get("inputRev") or pkg.get("rev", "?")[:12]
    except Exception:
        pass
    return "?"


def signature(text: str, short: str) -> str | None:
    m = re.search(r"\b(theorem|lemma)\s+" + re.escape(short) + r"\b(.*?):=", text, re.DOTALL)
    if not m:
        return None
    return " ".join(m.group(0).split())


def extract_file(reply: str) -> str:
    blocks = FENCE_RE.findall(reply)
    return (blocks[-1] if blocks else reply).strip() + "\n"


def static_reject(original: str, proposal: str, short: str) -> str | None:
    if AXIOM_RE.search(proposal):
        return "proposal declares an `axiom`; that is a cheat, not a proof"
    orig_sig, new_sig = signature(original, short), signature(proposal, short)
    if new_sig is None:
        return f"declaration `{short}` is missing from the proposal"
    if orig_sig != new_sig:
        return f"statement of `{short}` was changed.\n  original: {orig_sig}\n  proposal: {new_sig}"
    for line in proposal.splitlines():
        if re.match(r"^\s*import\s+", line) and line.split()[1] != "Mathlib":
            return f"only `import Mathlib` is allowed, found: {line.strip()}"
    return None


def lake_build() -> tuple[bool, str]:
    proc = subprocess.run(["lake", "build"], cwd=ROOT, capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    return proc.returncode == 0, out


def lean_feedback(build_out: str) -> str:
    keep = [l for l in build_out.splitlines() if re.search(r"error|warning: .*sorry|unsolved goals|⊢", l)]
    text = "\n".join(keep) if keep else build_out
    return text[-6000:]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entry_id")
    ap.add_argument("--proposer", default="claude:claude-opus-5")
    ap.add_argument("--critic", default="none")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--allow-circular", action="store_true",
                    help="attack an entry whose circularity verdict is not `independent`")
    args = ap.parse_args(argv)

    elan = Path.home() / ".elan" / "bin"
    if elan.is_dir():
        os.environ["PATH"] = f"{elan}{os.pathsep}{os.environ.get('PATH', '')}"

    ledger = audit.load_ledger()
    entry = next((e for e in ledger["entries"] if e["id"] == args.entry_id), None)
    if entry is None:
        print(f"no ledger entry {args.entry_id!r}")
        return 2
    if entry["status"] != "open":
        print(f"{entry['id']} is {entry['status']}, not open; nothing to do")
        return 2

    problems = audit.check_schema(ledger) + audit.check_sources()
    if problems:
        print("ledger invalid, refusing to start:\n  " + "\n  ".join(problems))
        return 2

    circ = entry.get("circularity") or {}
    circ_verdict = circ.get("verdict", "unassessed") if entry.get("toward") else None
    if circ_verdict is not None and circ_verdict != "independent":
        if not args.allow_circular:
            print(
                f"{entry['id']} serves {entry['toward']} and its circularity verdict is "
                f"{circ_verdict!r}. Assess it before spending rounds on it: a lemma that is "
                f"the target in disguise compiles like any other and proves nothing new, and "
                f"Lean will not tell you. Override with --allow-circular."
            )
            return 2
        print(f"WARNING: circularity verdict is {circ_verdict!r}; running anyway (--allow-circular)")

    proposer = get_provider(args.proposer)
    critic = get_provider(args.critic)
    if proposer is None:
        print("a proposer is required")
        return 2

    target = ROOT / entry["lean_file"]
    original = target.read_text()
    short = entry["lean_decl"].rsplit(".", 1)[-1]
    if signature(original, short) is None:
        print(f"cannot find `{short}` in {entry['lean_file']}")
        return 2

    attempts_dir = ATTEMPTS / entry["id"]
    attempts_dir.mkdir(parents=True, exist_ok=True)
    stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    system = PROPOSER_SYSTEM.format(mathlib=mathlib_rev(), decl=entry["lean_decl"])
    brief = (
        f"Ledger entry: {entry['id']}\nTitle: {entry['title']}\n"
        f"Statement: {entry['statement']}\nNotes: {entry.get('notes', '')}\n"
    )
    toward = next((e for e in ledger["entries"] if e["id"] == entry.get("toward")), None)
    if toward is not None:
        brief += (
            f"\nThis entry serves the target {toward['id']} ({toward['title']}): {toward['statement']}\n"
            f"Its circularity verdict against that target is {circ_verdict!r}"
            + (f": {circ['argument']}\n" if circ.get("argument") else ".\n")
            + "A proof of this entry that quietly assumes something as strong as that target "
            "is not a proof of this entry.\n"
        )
    feedback = ""
    outcome = "failed"
    rounds_run = 0

    print(f"target   {entry['id']}  ({entry['lean_decl']})")
    print(f"proposer {proposer.name}\ncritic   {critic.name if critic else 'none'}\n")

    for rnd in range(1, args.rounds + 1):
        rounds_run = rnd
        print(f"--- round {rnd}/{args.rounds} ---")
        user = brief + f"\nCurrent file ({entry['lean_file']}):\n```lean\n{original}```\n"
        if feedback:
            user += f"\nFeedback from the previous round:\n{feedback}\n"
        try:
            reply = proposer.complete(system, user)
        except Exception as exc:  # provider failure is not a proof failure
            print(f"proposer error: {exc}")
            return 3
        proposal = extract_file(reply)
        record = {
            "entry": entry["id"], "round": rnd, "at": now(),
            "proposer": proposer.name, "critic": critic.name if critic else None,
            **({"circularity": circ_verdict} if circ_verdict is not None else {}),
        }
        (attempts_dir / f"{stamp}_r{rnd}.lean").write_text(proposal)

        reason = static_reject(original, proposal, short)
        if reason:
            print(f"rejected before Lean: {reason}")
            record.update(result="rejected", reason=reason)
            (attempts_dir / f"{stamp}_r{rnd}.json").write_text(json.dumps(record, indent=2) + "\n")
            feedback = f"Rejected before Lean ran: {reason}"
            continue

        critic_text, critic_verdict = "", None
        if critic:
            try:
                critic_text = critic.complete(
                    CRITIC_SYSTEM,
                    brief + f"\nOriginal file:\n```lean\n{original}```\n\nProposal:\n```lean\n{proposal}```\n",
                )
                first = critic_text.strip().splitlines()[0] if critic_text.strip() else ""
                critic_verdict = "accept" if "ACCEPT" in first.upper() else "reject"
                print(f"critic: {critic_verdict}")
            except Exception as exc:
                critic_text, critic_verdict = f"critic error: {exc}", None
                print(critic_text)
        record.update(critic_verdict=critic_verdict, critic_text=critic_text)

        target.write_text(proposal)
        ok, build_out = lake_build()
        if not ok:
            target.write_text(original)
            fb = lean_feedback(build_out)
            print("lean: build failed")
            print("\n".join("  " + l for l in fb.splitlines()[:12]))
            record.update(result="failed", lean="build failed", lean_output=fb)
            (attempts_dir / f"{stamp}_r{rnd}.json").write_text(json.dumps(record, indent=2) + "\n")
            feedback = f"Lean build failed:\n{fb}"
            if critic_text:
                feedback += f"\n\nCritic's objections:\n{critic_text}"
            continue

        try:
            ax = audit.lean_axioms([entry["lean_decl"]])[entry["lean_decl"]]
        except audit.AuditError as exc:
            target.write_text(original)
            print(f"audit error: {exc}")
            return 3
        verdict = audit.verdict(ax)
        print(f"lean: builds; axioms {sorted(ax or [])}; verdict {verdict}")
        record.update(lean="built", axioms=sorted(ax or []), verdict=verdict)

        if verdict == "verified":
            record["result"] = "verified"
            (attempts_dir / f"{stamp}_r{rnd}.json").write_text(json.dumps(record, indent=2) + "\n")
            outcome = "verified"
            break

        target.write_text(original)
        extra = sorted((ax or set()) - audit.ALLOWED_AXIOMS)
        why = "proof still depends on sorry" if "sorryAx" in (ax or set()) else f"disallowed axioms {extra}"
        record.update(result="failed", reason=why)
        (attempts_dir / f"{stamp}_r{rnd}.json").write_text(json.dumps(record, indent=2) + "\n")
        feedback = f"Lean built the file but the proof is not accepted: {why}.\n{lean_feedback(build_out)}"
        if critic_text:
            feedback += f"\n\nCritic's objections:\n{critic_text}"

    # Record the attempt on the ledger entry, whatever happened.
    entry.setdefault("attacked_by", []).append({
        "by": proposer.name, "critic": critic.name if critic else None,
        "at": now(), "rounds": rounds_run, "result": outcome, "log": f"ledger/attempts/{entry['id']}/{stamp}_*",
        **({"circularity": circ_verdict} if circ_verdict is not None else {}),
    })
    if outcome == "verified":
        entry["status"] = "verified"
        entry["verified_at"] = now()
        entry["verified_by"] = proposer.name
    audit.save_ledger(ledger)

    if outcome != "verified":
        # The target file was restored; make sure the build state matches it.
        lake_build()
        print(f"\nNOT CLOSED after {rounds_run} round(s). Ledger unchanged except attacked_by.")
        return 1

    print("\nclosed. Running the full audit to confirm the ledger is consistent...")
    return audit.main([])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
