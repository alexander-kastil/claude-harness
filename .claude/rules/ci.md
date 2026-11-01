---
paths:
  - "media/icon.png"
  - "media/harness*.svg"
  - "assets/images/marketplace/**"
  - "assets/films/**"
  - "docs/images/harness-demo.mp4"
---

# CI of the product

- The product's CI is also stored in `E:\Onedrive\OneDrive - Integrations IT Solutions\Business\CI\claude-harness` (owner, 2026-11-01: "the ci of this product should also be stored in ...", "like logos, final films"): after a logo changes or a film gets a new cut, run `npm run sync:ci`. `scripts/sync-ci.mjs` copies the extension icon, the two harness marks, the Marketplace header, the highest `-v<N>` cut of each film with its silent twin and the README's demo film, named by the CI folder's convention (`01-logo/`, `06-motion/`), and never removes a file there.
