# V1 Technical Plan

*Drafted 2026-07-13 from [APP_OVERVIEW.md](APP_OVERVIEW.md) and three real workouts used as the seed. For review before any code is written.*

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | **React + TypeScript + Vite** | Mature PWA tooling, fast dev loop, huge ecosystem when we add charts/AI later |
| PWA | **vite-plugin-pwa** | Installable, offline-capable service worker with minimal config |
| Storage | **Dexie.js (IndexedDB)** + `navigator.storage.persist()` | Structured, queryable, on-device source of truth; no backend needed for v1 |
| State | **Zustand** (lightweight) | Small surface; avoids over-architecture |
| Styling | **Tailwind CSS** | Fast iteration on a big-touch-target mobile UI |
| Tests | **Vitest** on core logic | Copy-forward, progression math, markdown generation are the bug-prone parts |
| Backend | **None in v1** | Sync/live-mode comes later; the data layer is built so it can be added without re-plumbing |

**Sync-readiness without sync:** every record gets a ULID id, `userId` (constant `"mike"` for now), and `updatedAt`. All writes go through one small data-layer module. A future sync engine (or multi-user) plugs in under that module without touching the UI.

## Data model

Everything the seed workouts demanded, and nothing more:

```
Exercise            — name (user-invented ok), category, unilateral?,
                      stickyTempo (4-digit E-P-C-P), stickyModifier ("pause at top"),
                      defaultIntensity (7), notes

Template            — name, kind (gym | micro), timeCapMin?, sections[]
Section             — kind (warmup | primary | secondary | cooldown),
                      logging (tracked | loose), groups[]
ExerciseGroup       — ordered members[]; 1 member = straight sets, 2+ = superset
GroupMember         — exerciseId, restAfterSec, prescription: PlannedSet[]
PlannedSet          — target (reps n | amrap | duration s | loose),
                      load (kg | bw | bw+kg | band | asNeeded), mainWork?

Session             — templateId, date, startingFatigue?, overallEffort?,
                      endingFatigue?, durationMin?, weekType (build | peak |
                      deload), notes, status (active | done)
SessionExercise     — exercise instance in a session; intensity (default/copied,
                      fractional ok), variationNote? ("decline push-ups")
LoggedSet           — actual reps/duration + load + optional per-set
                      intensity override + optional note
```

**Copy-forward (the core algorithm), revised 2026-09-06 — two sources, one workout:**

- The **template owns structure and prescription**: which exercises, in what order/pairing, how many sets, and the target reps/duration.
- The **last completed session owns your numbers**: the load actually lifted per set, plus intensity, rest, variation note and the per-set warm-up (w) flag.

Starting a session builds from the template and overlays the prior session's numbers, matching on `(section kind, exerciseId)` and, within an exercise, per side so L/R rows keep their own loads even when set counts differ. Template sets beyond what was logged last time inherit the last load actually used. AMRAP targets stay AMRAP.

**Week types (added 2026-09-06):** the load source above is qualified by the session's `weekType`. Build/peak take the previous session's loads as-is; a deload takes 60% (`DELOAD_LOAD_FACTOR`), rounded to 2.5kg, with half the sets (or the last deload's set count), and takes its *targets* from the last deload session. `setSessionWeekType` re-derives un-logged sets when the type changes mid-workout. No schema/index change — `weekType` lives inside the session JSON, so D1 sync needs nothing.

*Before this, a session was cloned from the prior session wholesale and the template was never read again once history existed — so template edits silently did nothing, and target reps could only ratchet upward (a hard week became the new prescription, permanently). Splitting the sources is what makes a programme a programme, and is the precondition for deload weeks (see BACKLOG: training cycles).*

**Progression queries** run over `LoggedSet` filtered to `mainWork` sets, understanding that `bw+15kg > bw+10kg > bw`.

## Markdown mirror

Format = exactly the seed-workout files (tables for tracked sections, bullets for loose ones — already user-approved). Generated deterministically from the store:

- One file per completed session: `sessions/2026-07-13-upper-body-1.md`
- One file per template reflecting current working numbers
- Plus an `index.md` history log

**V1 mechanics (honest limitation):** a phone PWA cannot silently write files into this repo. V1 ships an **Export button** producing a zip of the full mirror (share/save anywhere), plus auto-write to a chosen folder where the browser supports it (File System Access API — Android/Chrome yes, iPhone Safari no). The *continuous* mirror lands with the Phase-2 sync server, which can write markdown straight into this repo. The export is always complete-from-scratch, so nothing is ever lost by exporting late.

## Screens (v1, in build order)

1. **Home** — big buttons: one per template ("Upper Body 1", "Lower Body 1", "Micro Upper 1") + resume-active-session banner.
2. **Session** — the heart of the app. Sections in order; **supersets show all their member exercises together** (not a strict enforced rotation) — same layout as the read-only Template view, since that's how the user actually trains and lets him log whichever movement he's about to do. Each set row shows copied-forward load × reps: **tap ✓ to explicitly confirm each set as done** (no auto-confirm — deliberate logging is preferred over speed here), tap to edit first if it differed. `restAfterSec` is shown as text guidance ("rest 90s") only — **no in-app rest timer in v1**; the user times rest with his watch (see Backlog). Effort/fatigue/intensity (1–10, halves allowed) use a **+/− stepper** nudging 0.5 from the current sticky value. Tempo shown with legend. AMRAP and timed sets get their own input styles. Loose sections = checklist + optional notes. **Flexing:** an "add exercise" action (library search + create-new) asks which section, then immediately offers *session-only / add to this template / add to another template*; a skip action marks any exercise skipped-for-today with no template prompt. `SessionExercise` gains `addedAdHoc?` and `skipped?` flags.
3. **Session close** — overall effort + ending fatigue (1–10 stepper), optional note.
4. **History** — session list; tap into a past session (rendered like the markdown).
5. **Exercise progression** — per exercise: main-work load/reps over time, simple chart + PR markers.
6. **Templates** — view/edit templates, reorder groups, edit prescriptions.
7. **Settings/Export** — markdown export, storage-persist status.

## Build milestones

| # | Milestone | You get | Status |
|---|---|---|---|
| 1 | Scaffold: PWA shell, Dexie schema, seed-workout import | App installs on your phone with your 3 real workouts in it | ✅ Done (2026-07-13, verified in browser, 6 tests) |
| 2 | Session flow: copy-forward, set logging, add/skip flexing, session close (no rest timer — deferred) | **Usable at the gym** — the notebook retires | ✅ Done (2026-07-24, full flow incl. flexing verified in browser) |
| 3 | History + progression views | The "actually reviewable" payoff | ✅ History tree shipped (2026-08-10): Home → History, Year→Month→Week(Mon–Sun) expandable tree. **Progression charts shipped (2026-09-23)**: History → 📈 Progress → exercise → top working set per workout over time (warm-up sets excluded; load, else longest hold, else most reps), deload/peak points coloured, "same weight, +2 reps" when the load held but reps rose. `src/lib/progression.ts`, hand-rolled SVG. PR markers not done |
| 4 | Markdown export | Your portable history | 🟡 Per-session markdown mirror shipped (2026-08-10): generator in src/lib/markdown.ts (seed format), view/copy/download from History. Continuous auto-write to Obsidian folder in backlog |
| 5 | Template editing | Change programmes without my help | ✅ Done (2026-08-10) — create new (blank or copy); Edit mode on template view (via Edit on Home cards): add/remove exercises, edit in place (exercise rename fixes typos everywhere, per-set reps/secs/kg, rest, intensity, variation note, warm-up flag), drag ⠿ to reorder within a section, pair/unpair supersets on any exercise. Open ✎ editors auto-save dirty drafts every 60s and on app-background (gym-proof: phone lock mid-edit loses nothing). Remaining niceties in backlog |
| 6 | Polish: install prompts, icons, offline hardening | Feels like a real app | |

Milestone 2 is the point of first real value; everything after is additive.

## Deployment

Cloudflare Pages (free tier, HTTPS → installable PWA, root domain so no `base` path config). Chosen over GitHub Pages, which needs a paid plan for private repos.

- Instance config (`wrangler.toml`: D1 id, `ALLOWED_ORIGINS`, `LOG_TIME_ZONE`) lives outside this repo — see `wrangler.example.toml` and the README.
- **Deploy:** `sh scripts/deploy.sh` — builds, then deploys with `private/wrangler.toml` using the pinned local wrangler.

## Data resilience

Three independent copies, so no single account or device can lose the data:

1. **Each device's IndexedDB** — the working copy.
2. **Cloudflare D1** (`fitbuddy-sync`) — the canonical copy every device syncs to. Has Time Travel point-in-time restore, which covers bad writes but *not* loss of the Cloudflare account.
3. **A snapshot committed to the instance's private GitHub repo** at `data-backup/fitbuddy-data.json` (checked out here as `private/`) — the copy that survives losing Cloudflare entirely.

The snapshot is written in the **app's own import format**, so recovery is "open the app → Backup → Import & merge", with no SQL and no Cloudflare access needed. `src/data/snapshot.test.ts` asserts the committed file actually imports (a backup nobody has restored is a guess, not a backup).

- **Nightly, from the cloud, no laptop** (since 2026-09-23): a workflow in the private repo (template: `docs/examples/data-backup.yml`) fetches `/api/export?format=backup` (read-only `EXPORT_TOKEN`) and commits the file only if the data changed. Take one now: GitHub → Actions → "Data backup" → Run workflow.
- It refuses to write a backup with no sessions or templates, so a failed fetch can't silently overwrite a good one.
- History: until 2026-09-23 a Monday launchd job on the user's laptop did this. It silently stopped after 1 Sep (a broken npx wrangler cache), leaving the backup three weeks stale — the reason it moved off the laptop.

## Open questions

1. ~~What phone/browser?~~ **Resolved: Android Chrome.** One-tap PWA install, and the File System Access API lets v1 auto-write the markdown mirror to a chosen folder continuously (Export button remains as backup).
2. ~~Deploy target for the PWA?~~ **Resolved: Cloudflare Pages** (see Deployment above).
3. **Data portability across devices** (surfaced 2026-08-17): data is per-device *and* per-origin (IndexedDB), with no sync yet. Templates created on laptop `localhost:5173` do **not** appear on the phone at the production URL. **Near-term fix shipped 2026-08-17: Backup / Sync** — Home → Backup: export the whole DB → JSON file, move it to another device, Import (merge = last-write-wins by `updatedAt`, so it doubles as a manual sync; or Replace all). `exportAllData` / `importData` in `src/data/repo.ts`, UI in `src/screens/Backup.tsx`. Long-term fix remains the Phase-2 sync server.
