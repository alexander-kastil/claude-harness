"""Checks one repo's harness against the harness standard. Read-only; prints one line per finding and a summary."""
import argparse
import json
import os
import re
import sys

PRODUCT = ["Project", "Where the detail lives", "Harness", "Hard Rules", "Working Method"]
CLASS = ["Layout", "Harness", "Hard Rules", "Working Method"]
REPLACED = ["claude-md-guard.sh", "skill-leaf-guard.sh", "kill-switch.sh", "steer.sh", "verification-gate.sh",
            "delegation-reminder.sh", "skill-reference-guard.sh"]
MARKETPLACES = ("@integrations-marketplace", "@claude-mods", "@claude-harness")
HARNESS = "harness-plugin"
RESTATED = [
    (r"\b(commit|push)\b.*\b(request|asked|told|unless)\b", "commit or push"),
    (r"shared (package|library)", "shared package"),
    (r"(no |never ).*(documentation|docs)\b.*(unless|asked)", "no docs"),
    (r"delete files? unless", "delete files"),
    (r"em dash", "em dashes"),
    (r"\bparalleli[sz]e\b", "parallelize"),
    (r"both skill roots|skill roots before", "skill search"),
    (r"general-purpose", "named agent"),
    (r"\bSendMessage\b", "SendMessage"),
    (r"delegation is the default|default working mode", "delegation"),
    (r"override the history", "commit or push"),
    (r"owning agent's file|gated agents?\b.*\b(request|asked|explicit)", "delegation"),
    (r"never copy a global skill", "skill search"),
    (r"learnings go to|auto-?memory", "lessons"),
    (r"answer with the essentials|\bno recap\b", "essentials"),
    (r"close the session with|session close", "session close"),
    (r"status updates? on long", "status updates"),
]
BOILERPLATE = ["Workflow Orchestration", "Subagent Strategy", "Self-Improvement Loop", "Task Management", "Core Principles",
               "Token Efficiency", "Delegation", "Agent Delegation", "Skill Routing"]
TEMPLATE_SECTIONS = ("Harness", "Working Method")


def finding_code(line):
    for pat, code in ((r"restates house rule", "restated"), (r"boilerplate section", "boilerplate"), (r"pointer not found", "pointer"),
                      (r"em dashes", "em-dash"), (r"^FAIL lines=", "lines"), (r"section", "sections"), (r"hook", "hook"), (r"\.claude/settings", "settings")):
        if re.search(pat, line):
            return code
    return "standard"


def find_line(path, needle):
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return None
    return next((i for i, l in enumerate(lines, 1) if needle in l), None)


def sections(text):
    return [m.group(1).strip() for m in re.finditer(r"^## (.+)$", text, re.M)]


def in_order(found, required):
    pos = []
    for name in required:
        if name not in found:
            return False, f"missing section {name}"
        pos.append(found.index(name))
    return (pos == sorted(pos)), "sections out of order"


def template_tokens():
    here = os.path.join(os.path.dirname(__file__), "..", "templates")
    found = set()
    for name in ("harness-block.md", "working-method.md"):
        found.update(re.findall(r"`([^`\s]+)`", open(os.path.join(here, name), encoding="utf-8").read()))
    return found


def pointers(text, root):
    missing = []
    skip = template_tokens()
    for raw in re.findall(r"`([^`\s]+)`", text):
        if raw in skip:
            continue
        p = raw.rstrip(".,:;)")
        if p.startswith(("~", "http", "$", "-", "@", "<", "{", "/")) or any(c in p for c in "*<>{}|"):
            continue
        if re.match(r"^[A-Za-z]:[\\/]", p):
            if not os.path.exists(p):
                missing.append(p)
            continue
        if "/" not in p or p.endswith("-") or p in ("tasks/todo.md", "tasks/lessons.md"):
            continue
        rel = p[2:] if p.startswith("./") else p
        if not os.path.exists(os.path.join(root, rel)):
            missing.append(p)
    return sorted(set(missing))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--global-settings", default=os.path.expanduser("~/.claude/settings.json"))
    ap.add_argument("--json", action="store_true", help="print one JSON object with file and line per finding instead of text lines")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    out = []
    locs = []

    def add(line, *where):
        out.append(line)
        locs.append([{"file": f, "line": n, **({"token": t} if t else {})} for f, n, t in where])
    cls = os.path.isdir(os.path.join(root, "demos")) and os.path.isdir(os.path.join(root, "labs"))
    kind = "class" if cls else "product"
    md = os.path.join(root, "CLAUDE.md")
    if os.path.isfile(md):
        text = open(md, encoding="utf-8", errors="replace").read()
        lines = text.count("\n") + (0 if text.endswith("\n") else 1)
        expanded = []
        sources = []
        for i, l in enumerate(text.splitlines(), 1):
            m = re.match(r"^@(\S+)\s*$", l)
            inc = os.path.join(root, m.group(1)) if m else ""
            if inc and os.path.isfile(inc):
                body = open(inc, encoding="utf-8", errors="replace").read()
                expanded.append(body)
                rel = os.path.relpath(inc, root).replace("\\", "/")
                sources.extend((rel, j, s) for j, s in enumerate(body.splitlines(), 1))
            else:
                expanded.append(l)
                sources.append(("CLAUDE.md", i, l))
        text = "\n".join(expanded) + "\n"
        own = open(md, encoding="utf-8", errors="replace").read()
        heading = lambda name: next((i for i, l in enumerate(own.splitlines(), 1) if l.strip() == f"## {name}"), None)
        if lines > 120:
            add(f"FAIL lines={lines} cap=120", ("CLAUDE.md", None, None))
        found = sections(text)
        if cls:
            ok, why = in_order(found, [s for s in CLASS if s != "Harness"])
            if ok and "Harness" not in found:
                ok, why = False, "missing section Harness"
        else:
            ok, why = in_order(found, PRODUCT)
        if not ok:
            add(f"FAIL {why}", ("CLAUDE.md", heading(why[len("missing section "):]) if why.startswith("missing") else None, None))
        harness = open(os.path.join(os.path.dirname(__file__), "..", "templates", "harness-block.md"), encoding="utf-8").read().strip()
        if harness not in text.replace("\r\n", "\n"):
            add("FAIL Harness section differs from templates/harness-block.md", ("CLAUDE.md", heading("Harness"), None))
        dashes = [i for i, l in enumerate(text.splitlines(), 1) if "—" in l]
        if dashes:
            add(f"FAIL em dashes on lines {dashes[:12]}{'...' if len(dashes) > 12 else ''}", *((f, n, "—") for f, n, s in sources if "—" in s))
        templates = set()
        for name in ("harness-block.md", "working-method.md"):
            templates.update(l.strip() for l in open(os.path.join(os.path.dirname(__file__), "..", "templates", name), encoding="utf-8").read().splitlines() if l.strip())
        section, fence = None, False
        for i, l in enumerate(own.splitlines(), 1):
            if l.startswith("```"):
                fence = not fence
                continue
            h = re.match(r"^##\s+(.+?)\s*$", l)
            if h and not fence:
                section = h.group(1)
                if section in BOILERPLATE:
                    add(f"REVIEW line {i} boilerplate section '{section}'", ("CLAUDE.md", i, None))
                continue
            if fence or section in TEMPLATE_SECTIONS or l.strip() in templates:
                continue
            for pat, name in RESTATED:
                if re.search(pat, l, re.I):
                    add(f"REVIEW line {i} restates house rule '{name}'", ("CLAUDE.md", i, None))
                    break
        for p in pointers(text, root):
            hit = next(((f, n) for f, n, s in sources if "`" in s and p in s), ("CLAUDE.md", None))
            add(f"FAIL pointer not found: {p}", (hit[0], hit[1], p))
    else:
        add("INFO no root CLAUDE.md")
    hooks = os.path.join(root, ".claude", "hooks")
    if os.path.isdir(hooks):
        for f in sorted(os.listdir(hooks)):
            if f in REPLACED:
                add(f"FAIL replaced hook still present: .claude/hooks/{f}", (f".claude/hooks/{f}", None, None))
    glob_enabled = set()
    try:
        glob_enabled = {k for k, v in json.load(open(a.global_settings, encoding="utf-8")).get("enabledPlugins", {}).items() if v}
    except Exception:
        pass
    for name in ("settings.json", "settings.local.json"):
        sp = os.path.join(root, ".claude", name)
        if not os.path.isfile(sp):
            continue
        rel = f".claude/{name}"
        try:
            s = json.load(open(sp, encoding="utf-8"))
        except Exception as e:
            add(f"FAIL .claude/{name} is not valid JSON: {e}", (rel, getattr(e, "lineno", None), None))
            continue
        for k, v in (s.get("enabledPlugins") or {}).items():
            base = k.split("@")[0]
            if k.endswith(MARKETPLACES) and any(g.split("@")[0] == base for g in glob_enabled):
                add(f"FAIL .claude/{name} enables {k}, already enabled globally", (rel, find_line(sp, f'"{k}"'), k))
            elif base == HARNESS and k != HARNESS + "@claude-harness" and k.endswith(("@claude-mods", "@integrations-marketplace")):
                add(f"FAIL .claude/{name} names old marketplace: {k}, use {HARNESS}@claude-harness", (rel, find_line(sp, f'"{k}"'), k))
            elif k.endswith("@claude-mods"):
                add(f"FAIL .claude/{name} names old marketplace: {k}", (rel, find_line(sp, f'"{k}"'), k))
        for k in (s.get("extraKnownMarketplaces") or {}):
            if k in ("claude-mods", "integrations-marketplace", "claude-harness"):
                add(f"FAIL .claude/{name} repeats marketplace {k}", (rel, find_line(sp, f'"{k}"'), k))
        hooktext = json.dumps(s.get("hooks") or {})
        for r in REPLACED:
            if r in hooktext:
                add(f"FAIL .claude/{name} still wires {r}", (rel, find_line(sp, r), r))
    fails = sum(1 for l in out if l.startswith("FAIL"))
    reviews = sum(1 for l in out if l.startswith("REVIEW"))
    if a.json:
        findings = [{"level": l.split(" ", 1)[0], "code": finding_code(l), "text": l, "locations": w} for l, w in zip(out, locs)]
        metrics, layout = {"lines": 0, "emDashes": 0}, "none"
        if os.path.isfile(md):
            own_lines = open(md, encoding="utf-8", errors="replace").read().splitlines()
            heads = sections(text)
            metrics = {"lines": len(own_lines), "emDashes": sum(1 for l in own_lines if "—" in l)}
            layout = "router" if "Harness" in heads else "class boilerplate" if cls else "old template" if any(h in BOILERPLATE for h in heads) else "other"
        print(json.dumps({"repo": os.path.basename(root), "kind": kind, "layout": layout, "metrics": metrics, "fail": fails, "review": reviews, "findings": findings}))
        return 1 if fails else 0
    for line in out:
        print(line)
    print(f"repo={os.path.basename(root)} kind={kind} fail={fails} review={reviews}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
