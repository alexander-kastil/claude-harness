#!/bin/bash
# UserPromptSubmit hook: put the turn in caveman mode to cut output tokens.
# Stays silent when the prompt asks for finished prose, where wording must be exact.
# stdout (exit 0) is added to the model context. Must never block the prompt.

# Terms that switch caveman mode off. Case-insensitive substring match, tuned per repo.
EXCLUDE='teaching|tutorial|\blab\b|\bdemo\b|slide|deck|handout|readme|\bdocs?\b|documentation|changelog|release notes|brand.voice|marketing|copywrit|blog|article|newsletter|\bemail\b|announcement|commit message|(pull request|pr) description|verbatim|prose|no caveman|full prose'

payload=$(cat)

# .prompt holds the raw user text; the sed fallback covers hosts without jq
prompt=$(printf '%s' "$payload" | jq -r '.prompt // empty' 2>/dev/null)
[ -n "$prompt" ] || prompt=$(printf '%s' "$payload" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p')

# A match means the deliverable is prose: leave the turn uncompressed
if printf '%s' "$prompt" | grep -qiE "$EXCLUDE"; then
  exit 0
fi

cat <<'EOF'
[Caveman mode: token discipline for this turn]
- Drop articles (a, an, the) and every copula that can go.
- Drop hedging: please, kindly, generally, usually, it would be good to, I think.
- Imperatives only. "Do X", not "You should probably do X".
- No preamble, no restating the request, no closing summary, no next-steps list.
- Compression removes wrapper words only. Rules, paths, identifiers, numbers, flags,
  quotes and code fences stay byte-exact. A sentence that cannot lose words without
  losing a rule stays as it is.
EOF

exit 0
