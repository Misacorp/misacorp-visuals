# Learnings

Non-obvious facts. One per bullet, dated, with the reason or source. Delete when obsolete. See `README.md`.

- 2026-10-10: GitHub Pages deployed with Actions ignores the `gh-pages` branch. The repo setting Pages > Source must be "GitHub Actions", otherwise the old branch keeps being served or nothing is.
- 2026-10-10: The default branch is still `master` until the owner renames it to `main`. `deploy.yml` triggers on `main`, so nothing deploys before the rename. Do not rename it yourself; the rename is an owner action.
- 2026-10-10: The repo is public. Anything committed (including memory files and PR text) is world-readable. No secrets, no private contact details.
- 2026-10-10: `.claude/settings.json`, `.claude/hooks/`, `.githooks/` and any `mcp.json` are protected from agent edits by the guard hook. Changes there come from the owner.
