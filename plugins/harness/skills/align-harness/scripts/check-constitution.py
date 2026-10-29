"""Checks one repo's harness against the harness standard (references/standard.json). Read-only; prints one line per finding and a summary."""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(HERE, "..", "templates")
STANDARD = json.load(open(os.path.join(HERE, "..", "references", "standard.json"), encoding="utf-8"))
REPLACED = [f for scripts in STANDARD["replacedHooks"].values() for f in scripts]
PLUGIN_ID = STANDARD["plugin"]["id"]
OLD_IDS = set(STANDARD["plugin"]["oldIds"])
RENAMES = STANDARD["marketplaceRenames"]
SRC_NAME = re.compile(r"(^|[^/A-Za-z0-9._-])src/([A-Za-z0-9._-]+)", re.M)
INVENTORY = {"agentTable": "an agent/tool table", "mcpList": "an MCP server list", "devCommands": "dev commands"}
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
TEMPLATE_SECTIONS = ("Harness", "Working Method")


def template(name):
    return open(os.path.join(TEMPLATES, name), encoding="utf-8").read()


def compiled(spec):
    return re.compile(spec["pattern"], (re.I if "i" in spec["flags"] else 0) | (re.M if "m" in spec["flags"] else 0))


def normal(pid):
    """The id a plugin entry stands for today: an old harness id is the plugin id, a renamed marketplace its new name."""
    if pid in OLD_IDS:
        return PLUGIN_ID
    base, _, market = pid.partition("@")
    return f"{base}@{RENAMES[market]}" if market in RENAMES else pid


def load(path):
    try:
        s = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return s if isinstance(s, dict) else {}


def entries(s, key):
    v = s.get(key)
    return v if isinstance(v, dict) else {}


def find_line(path, needle):
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return None
    return next((i for i, l in enumerate(lines, 1) if needle in l), None)


def heading(line):
    """The name of a `## ` heading: the text up to the first `(`, trimmed. None for any other line."""
    return line[3:].split("(")[0].strip() if line.startswith("## ") else None


def headings(lines):
    """(index, name) of each `## ` line outside a ``` fence."""
    out, fence = [], False
    for i, l in enumerate(lines):
        if l.startswith("```"):
            fence = not fence
        elif not fence and heading(l) is not None:
            out.append((i, heading(l)))
    return out


def order(found, required, anywhere):
    at = 0
    for name in found:
        if at < len(required) and name == required[at]:
            at += 1
    if at < len(required):
        name = required[at]
        return name, f"section {name} out of order" if name in found else f"missing section {name}"
    name = next((n for n in anywhere if n not in found), None)
    return name, f"missing section {name}" if name else ""


def template_tokens():
    found = set()
    for name in ("harness-block.md", "working-method.md"):
        found.update(re.findall(r"`([^`\s]+)`", template(name)))
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


def src_drift(root, text):
    """The same test as srcDrift in hooks/harness-guard.mjs: folders of src/ the text never names, and src/<name> it names that is gone."""
    src = os.path.join(root, "src")
    if not os.path.isdir(src):
        return [], []
    unlisted = sorted(e.name for e in os.scandir(src) if e.is_dir() and e.name not in text)
    named = dict.fromkeys(m.group(2).rstrip(".") for m in SRC_NAME.finditer(text))
    return unlisted, [n for n in named if n and not os.path.exists(os.path.join(src, n))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--global-settings", default=os.path.expanduser("~/.claude/settings.json"))
    ap.add_argument("--json", action="store_true", help="print one JSON object with file and line per finding instead of text lines")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    out = []

    def add(line, code, *where):
        out.append((line, code, [{"file": f, "line": n, **({"token": t} if t else {})} for f, n, t in where]))
    cls = all(os.path.isdir(os.path.join(root, d)) for d in STANDARD["sections"]["classMarkers"])
    kind = "class" if cls else "product"
    md = os.path.join(root, "CLAUDE.md")
    heads = []
    if os.path.isfile(md):
        own = open(md, encoding="utf-8", errors="replace").read()
        lines = own.count("\n") + (0 if own.endswith("\n") else 1)
        sources = []
        for i, l in enumerate(own.splitlines(), 1):
            m = re.match(r"^@(\S+)\s*$", l)
            inc = os.path.join(root, m.group(1)) if m else ""
            if inc and os.path.isfile(inc):
                body = open(inc, encoding="utf-8", errors="replace").read()
                rel = os.path.relpath(inc, root).replace("\\", "/")
                sources.extend((rel, j, s) for j, s in enumerate(body.splitlines(), 1))
            else:
                sources.append(("CLAUDE.md", i, l))
        text = "\n".join(s for _, _, s in sources) + "\n"
        heads = headings([s for _, _, s in sources])
        found = [n for _, n in heads]

        def at(name):
            i = next((i for i, n in heads if n == name), None)
            return sources[i][:2] if i is not None else ("CLAUDE.md", None)
        cap = STANDARD["lineCap"]
        if lines > cap:
            add(f"FAIL lines={lines} cap={cap}", "lines", ("CLAUDE.md", None, None))
        sec = STANDARD["sections"]
        name, why = order(found, sec["class"], sec["classAnywhere"]) if cls else order(found, sec["product"], [])
        if why:
            add(f"FAIL {why}", "sections", (*at(name), None))
        if template("harness-block.md").strip() not in text:
            add("FAIL Harness section differs from templates/harness-block.md", "sections", (*at("Harness"), None))
        start = next((i for i, n in heads if n == "Working Method"), None)
        if start is not None:
            end = next((i for i, _ in heads if i > start), len(sources))
            body = iter(s.strip() for _, _, s in sources[start + 1:end])
            bullets = [l.strip() for l in template("working-method.md").splitlines() if l.startswith("- ")]
            gone = next((b for b in bullets if b not in body), None)
            if gone:
                add(f"FAIL Working Method differs from templates/working-method.md: missing or out of order: {gone[:60].rstrip()}", "sections",
                    (*at("Working Method"), None))
        dashes = [i for i, (_, _, s) in enumerate(sources, 1) if "—" in s]
        if dashes:
            add(f"FAIL em dashes on lines {dashes[:12]}{'...' if len(dashes) > 12 else ''}", "em-dash", *((f, n, "—") for f, n, s in sources if "—" in s))
        unlisted, phantom = src_drift(root, text)
        if unlisted:
            add(f"REVIEW src drift: on disk but not named in CLAUDE.md: {' '.join(unlisted)}", "src-drift", ("CLAUDE.md", None, None))
        if phantom:
            add(f"REVIEW src drift: named in CLAUDE.md but not on disk: {' '.join('src/' + n for n in phantom)}", "src-drift",
                *(next(((f, n, f"src/{p}") for f, n, s in sources if f"src/{p}" in s), ("CLAUDE.md", None, f"src/{p}")) for p in phantom))
        for key, label in INVENTORY.items():
            m = compiled(STANDARD["inventory"][key]).search(own)
            if m:
                n = own.count("\n", 0, m.start()) + 1
                add(f"REVIEW line {n} carries an inventory: {label}", "inventory", ("CLAUDE.md", n, None))
        templates = set()
        for name in ("harness-block.md", "working-method.md"):
            templates.update(l.strip() for l in template(name).splitlines() if l.strip())
        own_lines = own.splitlines()
        own_heads = dict(headings(own_lines))
        section, fence = None, False
        for i, l in enumerate(own_lines):
            if l.startswith("```"):
                fence = not fence
                continue
            if i in own_heads:
                section = own_heads[i]
                if section in STANDARD["boilerplate"]:
                    add(f"REVIEW line {i + 1} boilerplate section '{section}'", "boilerplate", ("CLAUDE.md", i + 1, None))
                continue
            if fence or section in TEMPLATE_SECTIONS or l.strip() in templates:
                continue
            for pat, rule in RESTATED:
                if re.search(pat, l, re.I):
                    add(f"REVIEW line {i + 1} restates house rule '{rule}'", "restated", ("CLAUDE.md", i + 1, None))
                    break
        for p in pointers(text, root):
            hit = next(((f, n) for f, n, s in sources if "`" in s and p in s), ("CLAUDE.md", None))
            add(f"FAIL pointer not found: {p}", "pointer", (hit[0], hit[1], p))
    else:
        add("INFO no root CLAUDE.md", "standard")
    hooks = os.path.join(root, ".claude", "hooks")
    if os.path.isdir(hooks):
        for f in sorted(os.listdir(hooks)):
            if f in REPLACED:
                add(f"FAIL replaced hook still present: .claude/hooks/{f}", "hook", (f".claude/hooks/{f}", None, None))
    g = load(a.global_settings)
    glob_enabled = {normal(k) for k, v in entries(g, "enabledPlugins").items() if v}
    glob_markets = set(entries(g, "extraKnownMarketplaces"))
    for name in ("settings.json", "settings.local.json"):
        sp = os.path.join(root, ".claude", name)
        if not os.path.isfile(sp):
            continue
        rel = f".claude/{name}"
        try:
            s = json.load(open(sp, encoding="utf-8"))
        except Exception as e:
            add(f"FAIL .claude/{name} is not valid JSON: {e}", "settings", (rel, getattr(e, "lineno", None), None))
            continue
        if not isinstance(s, dict):
            continue
        for k, v in entries(s, "enabledPlugins").items():
            where = (rel, find_line(sp, f'"{k}"'), k)
            if k in OLD_IDS:
                add(f"FAIL .claude/{name} names old plugin id {k}, use {PLUGIN_ID}", "settings", where)
            elif v is not False and normal(k) in glob_enabled:
                add(f"FAIL .claude/{name} enables {k}, already enabled globally", "settings", where)
            elif normal(k) != k:
                add(f"FAIL .claude/{name} names old marketplace: {k}, use {normal(k)}", "settings", where)
        for k in entries(s, "extraKnownMarketplaces"):
            if k in glob_markets:
                add(f"FAIL .claude/{name} repeats marketplace {k}, already known globally", "settings", (rel, find_line(sp, f'"{k}"'), k))
        hooktext = json.dumps(s.get("hooks") or {})
        for r in REPLACED:
            if r in hooktext:
                add(f"FAIL .claude/{name} still wires {r}", "settings", (rel, find_line(sp, r), r))
    fails = sum(1 for l, _, _ in out if l.startswith("FAIL"))
    reviews = sum(1 for l, _, _ in out if l.startswith("REVIEW"))
    if a.json:
        findings = [{"level": l.split(" ", 1)[0], "code": code, "text": l, "locations": w} for l, code, w in out]
        metrics, layout = {"lines": 0, "emDashes": 0}, "none"
        if os.path.isfile(md):
            names = [n for _, n in heads]
            metrics = {"lines": len(own_lines), "emDashes": sum(1 for l in own_lines if "—" in l)}
            layout = "router" if "Harness" in names else "class boilerplate" if cls else "old template" if any(h in STANDARD["boilerplate"] for h in names) else "other"
        print(json.dumps({"repo": os.path.basename(root), "kind": kind, "layout": layout, "metrics": metrics, "fail": fails, "review": reviews, "findings": findings}))
        return 1 if fails else 0
    for line, _, _ in out:
        print(line)
    print(f"repo={os.path.basename(root)} kind={kind} fail={fails} review={reviews}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
