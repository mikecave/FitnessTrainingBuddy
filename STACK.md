# Stack

What FitBuddy is built from, and why. Kept deliberately small: every dependency
is something that would otherwise have to be hand-written and maintained.

*Last updated: 2026-09-15.*

## Languages

| Language | Where |
|---|---|
| **TypeScript** (strict) | Everything shipped — app, data layer, sync worker. ~6,400 lines of app code, ~2,600 lines of tests. |
| **SQL** (SQLite dialect) | The D1 sync database: one table, plus the upsert in `functions/api/sync.ts`. |
| **Shell** | `scripts/dev.sh` (dev server) and `scripts/deploy.sh` (build + Pages deploy using `private/wrangler.toml`). |
| **CSS** | Only Tailwind utility classes in JSX; no stylesheets of our own beyond the base import. |

No build-time codegen, no JS files — `tsc` runs over everything before every
production build, so a type error fails the deploy rather than reaching the phone.

## Runtime dependencies

Eight packages, all load-bearing:

| Package | What it does | Why not hand-rolled |
|---|---|---|
| `react`, `react-dom` | UI | — |
| `dexie` | IndexedDB wrapper — the on-device database, and the source of truth while offline | Raw IndexedDB is famously awkward; Dexie gives typed tables, transactions and versioned schema upgrades |
| `ulid` | Record ids | Sortable by creation time, unlike UUIDs — which is what makes last-write-wins sync and "newest first" ordering work. Uses the **monotonic** factory so two records created in the same millisecond still order correctly |
| `@dnd-kit/core`, `/sortable`, `/utilities` | Drag to reorder exercises | Touch drag-and-drop with a pointer sensor is genuinely hard to get right on a phone |

`zustand` was in the original plan and removed on 2026-09-15 — it was never
imported. State is local `useState` plus the repo layer, which has been enough.

## Build, test and deploy tooling

| Package | Role |
|---|---|
| `vite` | Dev server and production bundler |
| `vite-plugin-pwa` | Service worker + manifest; `registerType: 'autoUpdate'` so a new build activates itself |
| `@vitejs/plugin-react` | React fast refresh and JSX transform |
| `tailwindcss`, `@tailwindcss/vite` | Styling |
| `typescript` | Strict type checking; `npm run build` is `tsc && vite build` |
| `vitest` | Test runner |
| `@testing-library/react`, `jsdom` | Component tests |
| `fake-indexeddb` | Lets the data layer be tested in Node with no browser |
| `wrangler` | Cloudflare deploys and D1 queries. **Pinned as a devDependency** — `npx wrangler` resolves a shared cache that broke once and silently skipped a scheduled backup |
| `@types/node` | Needed by `vite.config.ts` (git sha for the build stamp) and the snapshot test |

Playwright is used for UI verification via the `run-fitness-training-buddy`
skill in `.claude/skills/`, not as a project dependency.

## Infrastructure

| Piece | Service |
|---|---|
| Hosting | **Cloudflare Pages** (free tier, HTTPS, installable PWA) |
| Sync API | **Cloudflare Pages Function** at `/api/sync` (`functions/api/sync.ts`) |
| Sync database | **Cloudflare D1** (SQLite), database `fitbuddy-sync` |
| Code | **GitHub** — this repo holds code only; each instance's config and data live in a separate private repo checked out at `./private` (see README) |
| Data backup | Optional: `/api/export?format=backup` (read-only key) returns every record in the app's import format, for a scheduled job in your private repo to commit |

## What is deliberately absent

- **No UI kit** — components are hand-written Tailwind, sized for gym use (big tap targets, readable at arm's length).
- **No router** — a route union in `App.tsx`. The app has ~8 screens and no URLs to share.
- **No state library** — see `zustand` above.
- **No charting library** — the progression chart is a hand-rolled SVG line (`src/screens/Progress.tsx`). One chart type didn't justify a dependency; revisit if more arrive.
- **No backend framework** — the sync endpoint is one function against one table.
- **No auth** — single user, one shared bearer token held per device.

The bundle is ~400 KB (~120 KB gzipped), which is what keeps the whole app
precacheable and genuinely usable offline in a gym basement.

## Architecture in one paragraph

React PWA, offline-first. All reads and writes go through `src/data/repo.ts`
into Dexie/IndexedDB, so the UI never touches storage directly — which is what
allowed cloud sync to be added underneath without changing a single screen.
Every record carries a ULID id, `userId` and `updatedAt`; sync pushes the full
local state to D1, the server keeps whichever copy of each record is newer, and
returns the merged result for the client to merge back under the same rule.
Markdown mirrors of every session are generated deterministically from the
store, so the training history is readable without the app.
