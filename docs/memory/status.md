# Status

Rewritten at the end of every task (not appended). Last updated: 2026-10-10.

## Current state

- Site: migrated to vanilla HTML/CSS/JS in `src/`. The 2017 jQuery page exists only in git history.
  Hero parallax uses CSS scroll-driven animations, rAF fallback in `src/scripts/parallax.js`.
- Copy is a minimal placeholder (About, Services, Contact). English, `lang="en"`.
- Toolchain: esbuild + `scripts/build.mjs`, Biome, html-validate, `node --test`. CI on PRs, Pages deploy on `main`.
- Harness: `CLAUDE.md`, `.claude/settings.json`, guard hook, pre-push hook, `open-pr` skill, `reviewer` agent, this memory.

## Next steps

1. Owner setup (see open questions). Nothing deploys until `main` exists and Pages source is "GitHub Actions".
2. Real copy from the owner; add business details to the footer.
3. Check parallax smoothness on real devices (headless software compositing showed dropped frames with 6 moving layers).
4. Optional: measure JS (<= 15 KB) and hero art (<= 150 KB) budgets in the build; only HTML+CSS+JS is enforced now.

## Open questions for the owner

- Site language: Finnish, English, or both (with `hreflang`)?
- Footer business details: toiminimi name, Y-tunnus, municipality. Finnish law requires service provider identification.
- Rename default branch `master` to `main` (deploy triggers on `main`).
- Pages source "GitHub Actions"; custom domain `misacorp.dev` + enforce HTTPS in Pages settings.
- DNS at Cloudflare for `misacorp.dev` and Email Routing for hello@misacorp.dev.
- Repo is public, so a free branch ruleset on `main` is possible and would add server-side enforcement.
