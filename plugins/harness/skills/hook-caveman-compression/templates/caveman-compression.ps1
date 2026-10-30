# UserPromptSubmit hook: put the turn in caveman mode to cut output tokens.
# Stays silent when the prompt asks for finished prose, where wording must be exact.
# stdout (exit 0) is added to the model context. Must never block the prompt.

# Terms that switch caveman mode off. Case-insensitive substring match, tuned per repo.
$exclude = 'teaching|tutorial|\blab\b|\bdemo\b|slide|deck|handout|readme|\bdocs?\b|documentation|changelog|release notes|brand.voice|marketing|copywrit|blog|article|newsletter|\bemail\b|announcement|commit message|(pull request|pr) description|verbatim|prose|no caveman|full prose'

$payload = [Console]::In.ReadToEnd()

# .prompt holds the raw user text
$prompt = ($payload | ConvertFrom-Json).prompt

# -imatch is the case-insensitive regex operator; a match leaves the turn uncompressed
if ($prompt -imatch $exclude) {
    exit 0
}

@'
[Caveman mode: token discipline for this turn]
- Drop articles (a, an, the) and every copula that can go.
- Drop hedging: please, kindly, generally, usually, it would be good to, I think.
- Imperatives only. "Do X", not "You should probably do X".
- No preamble, no restating the request, no closing summary, no next-steps list.
- Compression removes wrapper words only. Rules, paths, identifiers, numbers, flags,
  quotes and code fences stay byte-exact. A sentence that cannot lose words without
  losing a rule stays as it is.
'@

exit 0
