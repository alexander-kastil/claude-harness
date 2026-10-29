"""Writes the harness base of a new product repo from the align-harness templates. Creates a file only when it is missing, never overwrites. Dry run unless --apply."""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(HERE, "..", "..", "align-harness", "templates")
TASKS_ROW = "| Plan and corrections | `tasks/todo.md`, `tasks/lessons.md` |"
GITIGNORE = """[Bb]in/
[Oo]bj/
node_modules/
dist/
.angular/
coverage/
.venv/
__pycache__/
*.pyc
.vs/
*.user
.env
local.settings.json
.azure/
.idea/
.DS_Store
Thumbs.db
# Claude Code session files: time ledger, personal settings, scheduler lock
.time/
.claude/settings.local.json
.claude/scheduled_tasks.lock
"""


def read(name):
    return open(os.path.join(TEMPLATES, name), encoding="utf-8").read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--summary", required=True, help="one to three sentences: what the product is and its stack")
    ap.add_argument("--area", action="append", default=[], help="name=glob[,glob]:owner-agent, e.g. api=src/api/**:dotnet-conventions:dotnet-expert or site=src/site/**:hugo-expert")
    ap.add_argument("--rule", action="append", default=[], help="one repo-only hard rule")
    ap.add_argument("--fact", action="append", default=[], help="area=one fact for that area's rules file")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    root = os.path.abspath(a.root)

    areas = []
    for spec in a.area:
        name, rest = spec.split("=", 1)
        globs, owner = rest.split(":", 1)
        areas.append((name.strip(), [g.strip() for g in globs.split(",") if g.strip()], owner.strip()))

    bases = [(g.split("*")[0] or g, n) for n, globs, _ in areas for g in globs]
    tree = "\n".join([f"{b:<24}{n}" for b, n in sorted(bases)] + [f"{'tasks/':<24}todo.md, lessons.md"])
    rows = "\n".join([f"| {n} | `.claude/rules/{n}.md` |" for n, _, _ in areas] + [TASKS_ROW])
    rules = "\n".join(f"- {r}" for r in a.rule) or "- None yet."

    files = {
        "CLAUDE.md": read("CLAUDE.product.md")
        .replace("{{summary}}", a.summary.strip())
        .replace("{{tree}}", tree)
        .replace("{{detail_rows}}", rows)
        .replace("{{harness_block}}", read("harness-block.md").strip())
        .replace("{{hard_rules}}", rules)
        .replace("{{working_method}}", read("working-method.md").strip()),
        "tasks/todo.md": "# Plan\n",
        "tasks/lessons.md": "# Lessons\n",
        ".gitignore": GITIGNORE,
    }
    facts = {}
    for spec in a.fact:
        name, text = spec.split("=", 1)
        facts.setdefault(name.strip(), []).append(text.strip())
    for n, globs, owner in areas:
        body = (read("rules-area.md")
                .replace("{{paths}}", "\n".join(f'  - "{g}"' for g in globs))
                .replace("{{area_title}}", n)
                .replace("{{owner}}", owner))
        files[f".claude/rules/{n}.md"] = body + "".join(f"- {t}\n" for t in facts.get(n, []))

    created = skipped = 0
    for rel, body in files.items():
        path = os.path.join(root, rel)
        if os.path.exists(path):
            print(f"skip   {rel}")
            skipped += 1
            continue
        print(f"create {rel}")
        created += 1
        if a.apply:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(body)
    print(f"created={created} skipped={skipped} {'applied' if a.apply else 'dry-run'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
