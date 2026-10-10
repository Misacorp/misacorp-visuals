#!/usr/bin/env bash
# SessionStart hook: wire up git hooks, install deps in cloud sessions, print orientation.
# Idempotent, fast, and must never fail the session (always exits 0).
# Stdout is added to the session context; keep it short.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

in_repo() { git rev-parse --is-inside-work-tree >/dev/null 2>&1; }

# 1. Client-side push guard (repo-local config only).
if in_repo && [ -d .githooks ]; then
  [ "$(git config --local --get core.hooksPath 2>/dev/null)" = ".githooks" ] \
    || git config --local core.hooksPath .githooks >/dev/null 2>&1 || true
fi

# 2. Cloud sessions: install dependencies when missing or stale.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ -f package-lock.json ]; then
  if [ ! -d node_modules ] || [ node_modules -ot package-lock.json ]; then
    if npm ci --ignore-scripts --no-audit --no-fund >/dev/null 2>&1; then
      echo "deps: npm ci done"
    else
      echo "deps: npm ci FAILED; run it manually and read the error"
    fi
  fi
fi

# 3. Orientation.
branch=""
if in_repo; then
  branch="$(git symbolic-ref --short -q HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)"
fi
echo "Misacorp Visuals: static site (vanilla HTML/CSS/JS, esbuild). Rules: see CLAUDE.md."
case "$branch" in
  main|master|gh-pages)
    echo "WARNING: you are on protected branch '$branch'. Create a feature branch before editing: git switch -c <name>. Never push or merge it; open a PR."
    ;;
  "")
    echo "Branch: unknown (not a git work tree?)."
    ;;
  *)
    echo "Branch: $branch (PR target is the default branch; the owner merges)."
    ;;
esac
echo "Start every task by reading docs/memory/status.md. Update memory in the same PR."
echo "Before pushing: npm run check."

exit 0
