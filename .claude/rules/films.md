---
paths:
  - "assets/films/**"
---

# Films of the extension

- Film width (owner, 2026-10-26): the extension is filmed in a VS Code window 1024 px wide and the film is delivered 1024 px wide, 1024x704 like the film-product-page-v2 cut; no device-scale frame that comes out wider.
- Version history (owner, 2026-10-27: "this would allow us to bring old good effects back because we have a history"): each cut that matters gets `assets/films/<film>/changelog/<version>.md` with its outputs, storyline, reflection, every effect with how to restore it, and the owner's corrections; earlier cuts stay reproducible through an env switch (Plugin Hunter: `INTRO_BACK=v10|v9|v8`). Method: video-creation leaf `film-versions`.
- Features of a release film (2026-10-28): while the next version lives in `.claude/worktrees/<version>`, every fact brief and the film agent read that worktree's `CHANGELOG.md`, `docs/` and `src/`; the main checkout holds the release before it. A commit subject is not evidence of a command: check `harness --help` of that build.
- A release film is its own film (owner, 2026-10-28: "the film title is harness-terminal .... it is a new film!!!", "create it here D:\git-projects\claude-harness\assets\films"): a new folder `assets/films/<title>/` with its own v1, never a next cut of Plugin Hunter; it copies the series' scripts it needs and leaves Plugin Hunter untouched.
- Start screen (owner, 2026-10-28: "we dont want ther version number on start but this", "move the label to top - it hides the saluki"): no version number in the opening lockup; the VS Code Marketplace card from Plugin Hunter's `scripts/intro.py` `marketplace_header()`, placed where it covers no character (harness-terminal v3: card top left, lockup under it).
