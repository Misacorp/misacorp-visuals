# Decisions

ADR-lite. Newest at the bottom. Never delete; mark `Superseded by ...`. See `README.md`.

### No framework, static HTML/CSS and vanilla ES modules
- Date: 2026-10-10. Status: accepted.
- Decision: no React/Vue/etc. and no runtime dependencies. Plain HTML pages, CSS, small ES modules.
- Why: a studio homepage is mostly static. Static HTML gives the best SEO, the smallest payload and the lowest upkeep.
- Alternatives: Astro or 11ty (more tooling than the content needs), React (hydration cost, no benefit).

### Build with esbuild and a tiny Node script
- Date: 2026-10-10. Status: accepted.
- Decision: `scripts/build.mjs` copies `public/`, processes `src/` with esbuild, writes `dist/`.
- Why: fast, one dev dependency, nothing hidden. Easy for agents and the owner to read.

### Biome, html-validate and node:test
- Date: 2026-10-10. Status: accepted.
- Decision: Biome for JS/CSS/JSON lint and format, html-validate for HTML, `node --test` for tests.
- Why: three small tools, no config sprawl, no test framework dependency. `npm run check` runs all of them.

### Deploy to GitHub Pages via Actions on `main`, gated on a merged PR
- Date: 2026-10-10. Status: accepted.
- Decision: `.github/workflows/deploy.yml` deploys on push to `main` only if the commit belongs to a merged PR. CI runs on PRs.
- Why: the owner cannot rely on server-side branch protection, so the workflow adds a server-side check that a PR existed.
- Note: depends on the default branch being named `main` (see `learnings.md`).

### Custom domain misacorp.dev, contact hello@misacorp.dev
- Date: 2026-10-10. Status: accepted.
- Decision: serve at https://misacorp.dev (`public/CNAME`). Contact address is hello@misacorp.dev, forwarded with Cloudflare Email Routing.
- Why: keeps a stable public address independent of the mailbox provider. No mail server to run.

### Agents never push to main/master/gh-pages; PR only, owner merges
- Date: 2026-10-10. Status: accepted.
- Decision: agents work on feature branches and open PRs. Agents never merge PRs or enable auto-merge.
- Enforced by: `.claude/hooks/guard.mjs` (PreToolUse), `.githooks/pre-push`, deny rules in `.claude/settings.json`, the deploy gate.
- Why: server-side branch protection is not configured. Several independent client-side guards make a mistake or an injected instruction less likely to reach production.
- Limits: these guards are defense in depth, not a sandbox. The owner's review of each PR is the real control.

### Parallax with CSS scroll-driven animations, rAF fallback
- Date: 2026-10-10. Status: accepted (implemented in `src/styles/main.css`, `src/scripts/parallax.js`).
- Decision: implement parallax with `animation-timeline: scroll(root block)` and an explicit length range equal to the hero height (a `view()` exit range would not start at scrollY 0). Fall back to a small `requestAnimationFrame` loop where unsupported. Respect `prefers-reduced-motion`.
- Why: off-main-thread animation, no scroll listeners in the common case, small JS.
- Replaces: the 2017 `parallax.js` scroll handler.

### Site language: English
- Date: 2026-10-10. Status: accepted.
- Decision: the site is English only. `lang="en"` on `<html>`, no `hreflang` alternates.
- Why: the owner chose English.
- Alternatives: Finnish only (rejected by owner), bilingual with `hreflang` (more copy and upkeep for a one-page site).
