"""Writes templates/harness-block.md into the `## Harness` section of the root CLAUDE.md of every repo the --roots globs match, so a changed block reaches every repo in one run. Repos without a Harness section are left alone (align-harness adds it). Writes for real unless --dry-run."""
import argparse
import glob
import json
import os
import sys

TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "templates", "harness-block.md")


def section(lines):
    """Start and end line index of the first `## Harness` section outside a code fence, or None."""
    fence, start = False, None
    for i, line in enumerate(lines):
        if line.startswith("```"):
            fence = not fence
            continue
        if fence or not line.startswith("## "):
            continue
        name = line[3:].split("(")[0].strip()
        if start is not None:
            return start, i
        if name == "Harness":
            start = i
    return (start, len(lines)) if start is not None else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roots", action="append", default=[], help="glob of repo folders, repeatable (default D:/git-*/*)")
    ap.add_argument("--dry-run", action="store_true", help="print each change as [dry-run] and write nothing")
    ap.add_argument("--json", action="store_true", help="end with one JSON result object")
    a = ap.parse_args()
    block = open(TEMPLATE, encoding="utf-8").read().replace("\r\n", "\n").strip("\n").split("\n")
    repos = sorted({os.path.normpath(p) for g in (a.roots or ["D:/git-*/*"]) for p in glob.glob(g) if os.path.isdir(p)})
    replaced, aligned, without = [], 0, 0
    for repo in repos:
        path = os.path.join(repo, "CLAUDE.md")
        if not os.path.isfile(path):
            continue
        raw = open(path, "rb").read().decode("utf-8")
        eol = "\r\n" if "\r\n" in raw else "\n"
        lines = raw.replace("\r\n", "\n").split("\n")
        span = section(lines)
        if not span:
            without += 1
            continue
        start, end = span
        current = lines[start:end]
        while current and not current[-1].strip():
            current.pop()
        if current == block:
            aligned += 1
            continue
        tail = [""] if end < len(lines) or lines[-1] == "" else []
        new = lines[:start] + block + tail + lines[end:]
        replaced.append(path.replace("\\", "/"))
        print(f"{'[dry-run] ' if a.dry_run else ''}replace {path}")
        if not a.dry_run:
            open(path, "wb").write(eol.join(new).encode("utf-8"))
    mode = "dry-run" if a.dry_run else "applied"
    print(f"repos={len(repos)} replaced={len(replaced)} aligned={aligned} without={without} {mode}")
    if a.json:
        print(json.dumps({"repos": len(repos), "replaced": replaced, "aligned": aligned, "without": without, "applied": not a.dry_run}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
