#!/bin/bash

set -u

hook=${1:?usage: hook-cases.sh <hook-script> <cases-file> [tool-name]}
cases=${2:?usage: hook-cases.sh <hook-script> <cases-file> [tool-name]}
tool=${3:-Bash}

[ -f "$hook" ] || { echo "no such hook: $hook" >&2; exit 2; }
[ -f "$cases" ] || { echo "no such cases file: $cases" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }

total=0
mismatched=0
declare -A counts=([allow]=0 [deny]=0 [ask]=0)

while IFS= read -r raw || [ -n "$raw" ]; do
  line=${raw%$'\r'}
  [ -n "$line" ] || continue
  case "$line" in \#*) continue ;; esac

  expected=""
  cmd="$line"
  case "$line" in
    allow\|*|deny\|*|ask\|*) expected=${line%%|*}; cmd=${line#*|} ;;
    allow$'\t'*|deny$'\t'*|ask$'\t'*) expected=${line%%$'\t'*}; cmd=${line#*$'\t'} ;;
  esac

  decision=$(printf '{"tool_name":"%s","tool_input":{"command":%s}}' "$tool" "$(printf '%s' "$cmd" | jq -Rs .)" \
    | bash "$hook" 2>/dev/null \
    | jq -r '.hookSpecificOutput.permissionDecision // empty')
  decision=${decision:-allow}

  total=$((total + 1))
  counts[$decision]=$(( ${counts[$decision]:-0} + 1 ))

  if [ -n "$expected" ] && [ "$expected" != "$decision" ]; then
    mismatched=$((mismatched + 1))
    printf '%-6s %-6s MISMATCH  %s\n' "$decision" "(want $expected)" "$cmd"
  else
    printf '%-6s %s\n' "$decision" "$cmd"
  fi
done < "$cases"

printf '\n%s cases: %s allow, %s deny, %s ask' \
  "$total" "${counts[allow]:-0}" "${counts[deny]:-0}" "${counts[ask]:-0}"

if [ "$mismatched" -gt 0 ]; then
  printf ', %s MISMATCHED\n' "$mismatched"
  exit 1
fi

printf '\n'
exit 0
