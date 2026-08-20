#!/usr/bin/env python3
"""Rewrite the agent-preset id pinned in DeepSeek Harness session logs.

A session records the preset id it was started with. Renaming a preset leaves
older sessions pointing at an id that no longer exists, and they fail to resume:

    agent-presets: preset "file-canvas" not found (available: ... artifacts ...)

This rewrites that one field, in place, for every affected session.

    python3 scripts/rename-session-preset.py file-canvas artifacts           # preview
    python3 scripts/rename-session-preset.py file-canvas artifacts --apply   # write

Stop the harness before running with --apply, so nothing has a log open.

Safety:
  * every file it touches is copied to <file>.bak-<old-id> first, unless that
    backup already exists (so re-running never overwrites the original);
  * a record is only rewritten when the parsed JSON really has an `agentPreset`
    key holding the old id — a session whose TRANSCRIPT merely mentions the id
    in prose is left alone;
  * the rewrite is a string replacement on that one line, so every other byte
    of the log is preserved exactly.
"""

import json
import pathlib
import shutil
import subprocess
import sys


def find_key(node, key, value):
    """True when `node` contains `key` mapped to `value`, at any depth."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key and v == value:
                return True
            if find_key(v, key, value):
                return True
    elif isinstance(node, list):
        return any(find_key(v, key, value) for v in node)
    return False


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    apply = "--apply" in sys.argv
    if len(args) != 2:
        print(__doc__)
        return 2
    old, new = args

    root = pathlib.Path.home() / ".dsh" / "sessions"
    if not root.is_dir():
        print(f"no session directory at {root}")
        return 1

    # Both spacings, because the writer's formatting is not guaranteed.
    pairs = [(f'"agentPreset": "{old}"', f'"agentPreset": "{new}"'),
             (f'"agentPreset":"{old}"', f'"agentPreset":"{new}"')]

    touched = 0
    for log in sorted(root.rglob("session.jsonl.zstd")):
        raw = subprocess.run(["zstd", "-dc", str(log)], capture_output=True)
        if raw.returncode != 0:
            print(f"  skip (unreadable): {log.parent.name}")
            continue
        text = raw.stdout.decode("utf8", "surrogateescape")
        lines = text.split("\n")

        hits = 0
        for i, line in enumerate(lines):
            if not line or old not in line:
                continue
            try:
                record = json.loads(line)
            except Exception:
                continue
            if not find_key(record, "agentPreset", old):
                continue
            for a, b in pairs:
                if a in lines[i]:
                    lines[i] = lines[i].replace(a, b)
                    hits += 1

        if hits == 0:
            continue
        touched += 1
        print(f"  {log.parent.name}: {hits} field(s)")
        if not apply:
            continue

        backup = log.with_suffix(log.suffix + f".bak-{old}")
        if not backup.exists():
            shutil.copy2(log, backup)
        out = "\n".join(lines).encode("utf8", "surrogateescape")
        write = subprocess.run(["zstd", "-q", "-f", "-o", str(log)],
                               input=out, capture_output=True)
        if write.returncode != 0:
            shutil.copy2(backup, log)
            print(f"  ! recompress failed, restored from backup: {write.stderr.decode()}")
            return 1

    if touched == 0:
        print(f"no session pins the preset id {old!r}")
    elif apply:
        print(f"\nrewrote {touched} session(s): {old} -> {new}")
        print("backups are alongside each log as *.bak-" + old)
    else:
        print(f"\n{touched} session(s) would change. Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
