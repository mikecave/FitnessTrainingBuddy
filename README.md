# FitBuddy

A mobile-first, offline-capable gym log. Logging a set is one tap; every
workout is also written out as human-readable markdown, so your history is
never locked in the app.

- **Templates and sessions** — templates are the prescription; each workout is
  an instance that can diverge (add, skip, reorder, superset mid-workout).
- **Last time's numbers, this time's plan** — the template owns sets and target
  reps; loads, rest and intensity carry forward from your last workout.
- **Training cycles** — tag a week build / peak / deload. A deload starts at 60%
  load with half the sets, and the app suggests one when lifts stall.
- **Progression charts** per exercise, cardio/yoga logging, backdating.
- **Offline-first PWA** (IndexedDB), with optional sync through a tiny
  Cloudflare Pages Function + D1, and read-only markdown/backup exports.

Stack and every dependency: [STACK.md](STACK.md). Design and data model:
[docs/APP_OVERVIEW.md](docs/APP_OVERVIEW.md), [docs/TECH_PLAN.md](docs/TECH_PLAN.md).

## Run it

```sh
npm install
npm run dev      # http://localhost:5173 — works fully offline, no backend needed
npm test
```

Without sync configured the app keeps everything on the device.

## Self-host with sync (Cloudflare, free tier)

This repo holds **code only**. Each instance's config and data live in a
separate **private** repo checked out at `./private` (gitignored here):

```
private/
  wrangler.toml                 copied from wrangler.example.toml, filled in
  .env.development.local        VITE_SYNC_ENDPOINT=https://<you>.pages.dev/api/sync (dev server only)
  .github/workflows/…           optional nightly backup (docs/examples/data-backup.yml)
```

1. `npx wrangler d1 create fitbuddy-sync`, then put the id in `private/wrangler.toml`.
2. `npx wrangler pages project create fitbuddy`, and set `ALLOWED_ORIGINS` to its URL.
3. Secrets, long and random (`openssl rand -hex 32`):
   `npx wrangler pages secret put SYNC_TOKEN --project-name fitbuddy`
   (and `EXPORT_TOKEN` if you want the read-only exports).
4. `sh scripts/deploy.sh`
5. On each device: Backup → enter the sync key once.

Every API route requires its token; the deployed site on its own exposes no data.

## Licence

MIT — see [LICENSE](LICENSE).
