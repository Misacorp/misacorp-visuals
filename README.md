# Misacorp Visuals

Homepage for [Misacorp Visuals](https://misacorp.dev), a one-man creative studio with a passion for digital animation and web design.

A small static site: plain HTML, one CSS file, a few lines of fallback JS. No frameworks, no runtime dependencies. [esbuild](https://esbuild.github.io/) is the only build tool.

## Commands

Needs Node 22+ (see `.nvmrc`).

| Command          | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `npm ci`         | Install dev tooling (Biome, esbuild, html-validate)                 |
| `npm run dev`    | Build and serve at http://localhost:8080, rebuilding on change      |
| `npm run build`  | Build to `dist/` (hashed assets, sitemap, gzip size budget)         |
| `npm run lint`   | Biome + html-validate                                               |
| `npm run format` | Auto-fix formatting                                                 |
| `npm test`       | `node:test` suites in `tests/`                                      |
| `npm run check`  | lint + build + test, same as CI                                     |

## Layout

- `src/index.html`, `src/404.html`: pages. Use root-absolute URLs (`/assets/...`); the build hashes and rewrites them.
- `src/styles/main.css`: all styles. Inlined into `index.html` at build time.
- `src/scripts/`: `parallax.js` is only a fallback for browsers without CSS scroll-driven animations.
- `src/assets/`: hero art (SVG, optimised once with a pinned one-off `npx svgo@4.0.1 --multipass --precision=1`) and logo. Hashed on build.
- `public/`: copied as-is (favicons, `og-image.png`, `robots.txt`, `CNAME`). Put anything referenced from JSON-LD here.

The hero parallax is pure CSS (`animation-timeline: scroll()`), so it runs on the compositor with no JavaScript. Layers get a `--depth`; deeper layers lag more and look farther away. It is disabled under `prefers-reduced-motion`.

## Deploy

GitHub Pages, deployed by `.github/workflows/deploy.yml` on pushes to `main` (merged PRs only). Set the Pages source to "GitHub Actions" and the custom domain to `misacorp.dev` in the repository's Pages settings (Actions deployments ignore `public/CNAME`; it is kept for clarity). To preview under the project URL, build with `BASE_PATH=/misacorp-visuals/ npm run build`.
