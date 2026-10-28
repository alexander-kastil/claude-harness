"""Applies the standard's settings and hooks rules to one repo: drops plugin entries the global settings enable, the marketplace entry, wiring of replaced hooks and the replaced scripts. Dry run unless --apply."""
import argparse
import json
import os
import sys

REPLACED = ["claude-md-guard.sh", "skill-leaf-guard.sh", "kill-switch.sh", "steer.sh", "verification-gate.sh",
            "delegation-reminder.sh", "skill-reference-guard.sh"]
OLD, NEW = "@claude-mods", "@integrations-marketplace"
MARKETPLACES = ("claude-mods", "integrations-marketplace", "claude-harness")
HARNESS, HARNESS_NEW = "harness-plugin", "harness-plugin@claude-harness"


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
    glob = {k.split("@")[0] for k, v in json.load(open(a.global_settings, encoding="utf-8")).get("enabledPlugins", {}).items() if v}
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
                base, _, mkt = k.partition("@")
                if mkt in MARKETPLACES and base in glob and not a.keep_plugins:
                    log.append(f"{name}: drop {k} (enabled globally)")
                    continue
                if base == HARNESS and mkt in ("claude-mods", "integrations-marketplace"):
                    key = HARNESS_NEW
                else:
                    key = base + NEW if k.endswith(OLD) else k
                if key != k:
                    log.append(f"{name}: rename {k} -> {key}")
                new[key] = v
            if new:
                s["enabledPlugins"] = new
            else:
                s.pop("enabledPlugins")
        mk = s.get("extraKnownMarketplaces")
        if isinstance(mk, dict) and not a.keep_plugins:
            for m in MARKETPLACES:
                if m in mk:
                    log.append(f"{name}: drop marketplace {m}")
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
        for f in REPLACED:
            p = os.path.join(hooks_dir, f)
            if os.path.isfile(p):
                log.append(f"delete .claude/hooks/{f}")
                if a.apply:
                    os.remove(p)
        if a.apply and not os.listdir(hooks_dir):
            os.rmdir(hooks_dir)
            log.append("delete empty .claude/hooks/")
    for line in log:
        print(line)
    print(f"repo={os.path.basename(root)} changes={len(log)} {'applied' if a.apply else 'dry-run'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
