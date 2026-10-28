---
paths:
  - "assets/films/**"
---

# Films of the extension

- Film width (owner, 2026-10-26): the extension is filmed in a VS Code window 1024 px wide and the film is delivered 1024 px wide, 1024x704 like the film-product-page-v2 cut; no device-scale frame that comes out wider.
- Version history (owner, 2026-10-27: "this would allow us to bring old good effects back because we have a history"): each cut that matters gets `assets/films/<film>/changelog/<version>.md` with its outputs, storyline, reflection, every effect with how to restore it, and the owner's corrections; earlier cuts stay reproducible through an env switch (Plugin Hunter: `INTRO_BACK=v10|v9|v8`). Method: video-creation leaf `film-versions`.
