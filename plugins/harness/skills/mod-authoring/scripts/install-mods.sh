#!/usr/bin/env bash
set -euo pipefail

source_path="${1:-D:\\git-projects\\integrations-marketplace}"
manifest="$(cygpath -u "$source_path" 2>/dev/null || echo "$source_path")/.claude-plugin/marketplace.json"
marketplace="$(node -p "require(process.argv[1]).name" "$manifest")"

claude plugin marketplace add "$source_path" --scope user || claude plugin marketplace update "$marketplace"

for plugin in $(node -p "require(process.argv[1]).plugins.map(p => p.name).join(' ')" "$manifest"); do
  claude plugin install "$plugin@$marketplace" --scope user
done
