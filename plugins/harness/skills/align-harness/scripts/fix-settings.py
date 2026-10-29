"""Applies the standard's settings and hooks rules (references/standard.json) to one repo: repoints old plugin ids, drops enabled plugin and marketplace entries the global settings already carry (a `false` opt-out stays), wiring of replaced hooks and the replaced scripts. Dry run unless --apply."""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STANDARD = json.load(open(os.path.join(HERE, "..", "references", "standard.json"), encoding="utf-8"))
REPLACED = [f for scripts in STANDARD["replacedHooks"].values() for f in scripts]
PLUGIN_ID = STANDARD["plugin"]["id"]
OLD_IDS = set(STANDARD["plugin"]["oldIds"])
RENAMES = STANDARD["marketplaceRenames"]


def normal(pid):
    """The id a plugin entry stands for today: an old harness id is the plugin id, a renamed marketplace its new name."""
    if pid in OLD_IDS:
        return PLUGIN_ID
    base, _, market = pid.partition("@")
    return f"{base}@{RENAMES[market]}" if market in RENAMES else pid


def load_global(path):
    """A missing or invalid global settings file counts as empty."""
    try:
        s = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return s if isinstance(s, dict) else {}


def entries(s, key):
    v = s.get(key)
    return v if isinstance(v, dict) else {}


def strip_hooks(hooks, log):
    out = {}
    for event, groups in hooks.items():
        kept_groups = []
        for g in groups:
            kept = [h for h in g.get("hooks", []) if not any(r in json.dumps(h) for r in REPLACED)]
            for h in g.get("hooks", []):
                if h not in kept:
                    log.append(f"unwire {event} {h.get('command', '')}")
            if kept:
                kept_groups.append({**g, "hooks": kept})
        if kept_groups:
            out[event] = kept_groups
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--keep-plugins", action="store_true", help="leave enabledPlugins and extraKnownMarketplaces exactly as they are (a repo shared with people who lack the global settings)")
    ap.add_argument("--global-settings", default=os.path.expanduser("~/.claude/settings.json"))
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    g = load_global(a.global_settings)
    glob_enabled = {normal(k) for k, v in entries(g, "enabledPlugins").items() if v}
    glob_markets = set(entries(g, "extraKnownMarketplaces"))
    log = []
    for name in ("settings.json", "settings.local.json"):
        path = os.path.join(root, ".claude", name)
        if not os.path.isfile(path):
            continue
        s = json.load(open(path, encoding="utf-8"))
        before = json.dumps(s, sort_keys=True)
        plugins = s.get("enabledPlugins")
        if isinstance(plugins, dict) and not a.keep_plugins:
            new = {}
            for k, v in plugins.items():
                key = normal(k)
                if v is not False and key in glob_enabled:
                    log.append(f"{name}: drop {k} (enabled globally)")
                    continue
                if key != k:
                    log.append(f"{name}: {'repoint' if k in OLD_IDS else 'rename'} {k} -> {key}")
                new[key] = v
            if new:
                s["enabledPlugins"] = new
            else:
                s.pop("enabledPlugins")
        mk = s.get("extraKnownMarketplaces")
        if isinstance(mk, dict) and not a.keep_plugins:
            for m in [m for m in mk if m in glob_markets]:
                log.append(f"{name}: drop marketplace {m} (known globally)")
                mk.pop(m)
            if not mk:
                s.pop("extraKnownMarketplaces")
        if isinstance(s.get("hooks"), dict):
            hooks = strip_hooks(s["hooks"], log)
            if hooks:
                s["hooks"] = hooks
            else:
                s.pop("hooks")
        if json.dumps(s, sort_keys=True) == before:
            continue
        if not s:
            log.append(f"{name}: delete (empty)")
            if a.apply:
                os.remove(path)
        elif a.apply:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(s, f, indent=2, ensure_ascii=False)
                f.write("\n")
    hooks_dir = os.path.join(root, ".claude", "hooks")
    if os.path.isdir(hooks_dir):
        files = os.listdir(hooks_dir)
        for f in REPLACED:
            if f in files and os.path.isfile(os.path.join(hooks_dir, f)):
                log.append(f"delete .claude/hooks/{f}")
                if a.apply:
                    os.remove(os.path.join(hooks_dir, f))
        if all(f in REPLACED for f in files):
            log.append("delete empty .claude/hooks/")
            if a.apply:
                os.rmdir(hooks_dir)
    for line in log:
        print(line)
    print(f"repo={os.path.basename(root)} changes={len(log)} {'applied' if a.apply else 'dry-run'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
