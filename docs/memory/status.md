# Status

Rewritten at the end of every task (not appended). Last updated: 2026-10-10.

## Current state

- Toolchain: static build (esbuild + `scripts/build.mjs`), Biome, html-validate, `node --test`, CI and Pages deploy workflow are in the repo.
- Agent harness: `CLAUDE.md`, memory (`docs/memory/`), guard hook, pre-push hook, `open-pr` skill, `reviewer` agent. The owner installs `.claude/settings.proposed.json` as `.claude/settings.json`.
- Site: migration of the 2017 legacy site into `src/` is handled in a separate PR. Check `git log` and `src/` for how far it got.

## Next steps

1. Owner installs `.claude/settings.json` from `.claude/settings.proposed.json` and reviews the harness PR.
2. Finish the legacy site migration into `src/` (content, parallax with CSS scroll-driven animations, fonts, images).
3. Add the footer with business details, `robots.txt`, sitemap, Open Graph tags, favicons check.
4. Measure the performance budget in CI or by script (see `CLAUDE.md`).

## Open questions for the owner

- Site language: Finnish, English, or both (with `hreflang`)?
- Business details for the footer: Y-tunnus (business ID), name, address or municipality, contact. Finnish law requires service provider identification on commercial sites.
- Rename default branch `master` to `main`? The deploy workflow expects `main`.
- Set repo Pages source to "GitHub Actions".
- DNS for `misacorp.dev` (GitHub Pages A/AAAA or CNAME records) and Cloudflare Email Routing for hello@misacorp.dev.
