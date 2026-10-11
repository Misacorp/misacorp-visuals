# Status

Rewritten at the end of every task (not appended). Last updated: 2026-10-11.

## Current state

- Site: vanilla HTML/CSS/JS in `src/`. The 2017 jQuery page exists only in git history.
  Hero parallax uses CSS scroll-driven animations, rAF fallback in `src/scripts/parallax.js`.
- Language: English only, `lang="en"`, no `hreflang` (see `decisions.md`).
- Copy is a minimal placeholder (About, Services, Contact).
- Footer: business name, Business ID 2549090-7, Tampere, contact email. JSON-LD has the Tampere/FI address and `taxID`.
- Domain: owner renamed `master` to `main`, set custom domain `misacorp.dev` with HTTPS. DNS: apex A/AAAA records to GitHub Pages, DNS only (no proxy).
  `tasks.misacorp.dev` is a separate Cloudflare Worker. Never touch it.
  Cloudflare Email Routing (MX + SPF) forwards hello@misacorp.dev; keep those records.
- PR #3 is not merged yet, so the live site still shows the legacy page.
- Toolchain: esbuild + `scripts/build.mjs`, Biome, html-validate, `node --test`. CI on PRs, Pages deploy on `main`.
- Harness: `CLAUDE.md`, `.claude/settings.json`, guard hook, pre-push hook, `open-pr` skill, `reviewer` agent, this memory.

## Next steps

1. Merge PR #3 (owner) so the new site goes live.
2. Real copy from the owner.
3. Check parallax smoothness on real devices (headless software compositing showed dropped frames with 6 moving layers).

## Open questions for the owner

- Pages source set to "GitHub Actions"? Not confirmed.
- Repo is public, so a free branch ruleset on `main` is possible and would add server-side enforcement.
