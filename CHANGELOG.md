# Changelog

All notable changes to Claude Harness are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions with no version change in the package.json history (0.1.3, 0.1.5 to 0.1.18, 0.1.20 to 0.1.24 and 0.1.27) have no entry.

## [0.1.30] - 2026-10-20

### Added

- Harness standard check for each repo. FAIL and REVIEW lines show in the Problems panel on the file and line they concern. See [Harness standard](docs/harness-standard.md).
- Repositories node in the activity bar, with a check badge for each repo. See [Repositories](docs/repositories.md#activity-bar-node).
- CodeLens and quick fixes on `CLAUDE.md` and `.claude/rules/*.md` for restated house rules, boilerplate headings and dead pointers. See [CLAUDE.md lenses](docs/claude-md-lenses.md).
- Effective harness section on each repo page, listing the memory, rules, plugins and hooks that a session loads. See [Effective harness](docs/effective-harness.md).
- Duplicate finder covers hook scripts, and marks a copy as nearly identical when only whitespace or version lines differ. See [Duplicates](docs/duplicates.md).
- Retire Copy and Retire Clean Copies back up a repo copy that matches a global or plugin copy, then delete it. See [Duplicates](docs/duplicates.md#retire-a-copy).
- Fleet overview: one table of every repo. See [Fleet overview](docs/fleet-overview.md).
- Fix Settings and Hooks runs `fix-settings.py` as a preview, shows diffs, and applies after a confirmation. See [Fix settings and hooks](docs/fix-settings.md).
- Init Product Repo form with a preview. It creates only missing files. See [Init product repo](docs/init-product-repo.md).
- Rules editor shows the files each rule path matches, and checks the owner agent on disk. See [Rules editor](docs/rules-editor.md).
- Marketplace health page, and Rename Marketplace for directory marketplaces. See [Marketplace health](docs/marketplace-health.md).
- Bulk-edit guard: a pick list before Fix Settings, Retire Clean Copies and Rename Marketplace. It unticks repos with uncommitted harness files, a busy Claude session or stale worktree copies. See [Bulk-edit guard](docs/bulk-edits.md).
- Hook Scripts kind, for the files in the `hooks` folder. There are now twelve kinds. See [Harness kinds](docs/harness-kinds.md).
- Commands: Check Harness Standard, Open the Harness Standard, Fleet Overview, Marketplace Health, Fix Settings and Hooks, Init Product Repo, Retire Clean Copies, Rename Marketplace, Retire Copy, Open Repo, Remove Line and Repoint. See [Commands](docs/commands.md).

### Changed

- The main window sidebar header has two new buttons: Fleet overview and Marketplace health. See [Main window](docs/main-window.md#sidebar).
- Repo pages show the Harness standard and Effective harness sections, and buttons to check, fix settings and init a product repo.
- Copy labels read identical, nearly identical or differs.

## [0.1.29] - 2026-10-13

### Added

- Compare with Copy command opens the diff editor for an item and its copy in another scope.
- The frontmatter version shows next to the name.

### Changed

- Same-name assets across scopes are marked identical or differs. The check uses SHA-256 and ignores line ending differences.

## [0.1.28] - 2026-10-13

### Added

- Search box on the overview page.
- Animated demo of the main window in the README.

### Changed

- The README shows the demo in place of the footer logo.

## [0.1.26] - 2026-10-12

### Changed

- Version bump. The commit has no other change.

## [0.1.25] - 2026-10-12

### Changed

- Documentation for MCP servers and plugins is updated.

## [0.1.19] - 2026-10-12

### Changed

- The repo adopts conventional commit messages. The commit has no change to the extension.

## [0.1.4] - 2026-10-12

### Changed

- The Claude orange mark shows on the panel tab, the sidebar head and the overview header.
- The status bar entry reads Claude Harness.
- The `.time` ledger is left out of the package.

## [0.1.2] - 2026-10-12

### Fixed

- Workspace folders are listed even when they live under the temp folder.
- The editor header title stays on one line.

## [0.1.1] - 2026-10-12

### Added

- Repo harnesses in the main window, below the global harness.
- Create, rename, duplicate and plugin toggle work per scope.

### Changed

- Sections are collapsed by default.

## [0.1.0] - 2026-10-12

### Added

- First release: a VS Code extension to visualize and edit the global Claude Code harness and the repo harnesses below it. It has an activity bar tree and an editor panel.
