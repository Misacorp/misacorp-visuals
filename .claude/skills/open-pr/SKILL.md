---
name: open-pr
description: Open or update a pull request in this repo. Use when a task is done and changes must go to review, or when asked to create, update or describe a PR. Never merges.
---

# Open a PR

Agents never push to or merge `main`, `master` or `gh-pages`. The owner merges every PR.

## Steps

1. Check the branch: `git branch --show-current`. If it is `main`, `master` or `gh-pages`, run `git switch -c <short-kebab-name>` first.
2. Run `npm run check`. Fix failures. Do not open a PR with a failing check.
3. Update `docs/memory/` in the same PR: rewrite `status.md`, add decisions and learnings if any (see `docs/memory/README.md`).
4. Commit with a short imperative subject. Keep commits focused.
5. Push the feature branch: `git push -u origin <branch>`. Never use `--force`, `--no-verify` or a protected branch name.
6. Open the PR against the default branch with `mcp__github__create_pull_request` (`base` = default branch, `head` = your branch).
   To update an existing PR, push more commits and edit the body with `mcp__github__update_pull_request`.
7. Reply with the PR link. Do not merge, do not enable auto-merge, do not approve your own PR.

## Title

Imperative, under 70 characters, no trailing period. Example: `Add parallax hero with scroll-driven animation`.

## Body template

Concise, simple technical English. No marketing words, no emoji. Omit empty sections.

````markdown
## Summary
- <what changes and why, 1-3 bullets>

## Changes
- <concrete change, file or area>

## Verification
- `npm run check`: pass
- <manual check, e.g. viewed `npm run dev` at 375 px and 1440 px>

## Notes for owner
- <only if needed: decisions to confirm, risks, new dependency and why, follow-ups>

## Squash message
```
<Imperative 1-4 sentences. No title line.>
```
````

Rules for the squash message:
- Always the last section of the body, in a fenced code block, without the title (GitHub uses the PR title).
- Imperative mood: "Add ...", "Replace ...". Say what and why in 1-4 sentences.
- If the session requires attribution lines (for example a "Generated with" line or a session link), put them after the code block.

## Example

````markdown
## Summary
- Replace the 2017 scroll handler with CSS scroll-driven animations.
- Keep a small `requestAnimationFrame` fallback for browsers without support.

## Changes
- `src/styles/main.css`: add `animation-timeline: scroll()` layers.
- `src/scripts/parallax.js`: fallback loop, loaded only when `CSS.supports` fails.
- `docs/memory/status.md`: mark parallax as done.

## Verification
- `npm run check`: pass
- Checked in Firefox (fallback) and Chrome (CSS path). Reduced motion disables both.

## Squash message
```
Add parallax hero using CSS scroll-driven animations.
Fall back to a small requestAnimationFrame loop where unsupported. Disable motion with prefers-reduced-motion.
```
````
