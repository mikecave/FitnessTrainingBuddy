# FitBuddy

A mobile-first, offline-capable PWA for gym logging that is near-zero effort, with every workout mirrored to human-readable markdown. See [README.md](README.md).

## Read these first

- [STACK.md](STACK.md): languages, every dependency and why it's there, infrastructure, and what is deliberately absent.
- [docs/APP_OVERVIEW.md](docs/APP_OVERVIEW.md): the product model, foundational decisions, and data-model notes learned from real workouts. Keep it current.
- [docs/TECH_PLAN.md](docs/TECH_PLAN.md): stack, data model, screens, and **build milestones with status**.

## Public code, private instance

This repo is **public and holds code only**. An instance's config, data and personal docs (backlog, feedback, backups) live in a separate private repo checked out at `./private/`, which is gitignored. Rules:

- Never commit instance config or personal data here: no real `wrangler.toml`, no `.env*.local`, no backups, no user feedback, no deployment URLs. `wrangler.example.toml` shows the shape.
- Instance-specific values come from config, not code: `ALLOWED_ORIGINS` / `LOG_TIME_ZONE` (wrangler `[vars]`), and `VITE_SYNC_ENDPOINT` (dev only).
- Write comments about "the user", not a named person.

## Working agreements

- **Defaults everywhere:** never block logging on an empty field (intensity defaults to 7/10; sticky tempo/rest/modifiers copy forward).
- Units are **kg**. Tempo is 4-digit **Eccentric–Pause–Concentric–Pause** (always show a legend).
- Templates are prescriptions; **sessions are instances** that may diverge (ad-hoc adds with a promote prompt, skip-for-today).
- The template owns structure and targets; the last workout owns loads (see TECH_PLAN).
- All storage access goes through `src/data/repo.ts`. Every record carries userId/ULID/updatedAt.
- Commit style: imperative subject; the body explains the why.

## Environment

- Dev server: `sh scripts/dev.sh` (port 5173). Tests: `npm test`. Build: `npm run build`. Deploy: `sh scripts/deploy.sh` (needs `private/wrangler.toml`). Use the **pinned local wrangler** (`./node_modules/.bin/wrangler`), not `npx wrangler`.
- **Verify UI work in a real browser at phone width** before claiming it works: use the `run-fitness-training-buddy` skill's driver with `VIEWPORT=390x844` (also try 360). Check the **exit code** of `tsc`/`npm run build` rather than reading piped output.

@private/CLAUDE.md
