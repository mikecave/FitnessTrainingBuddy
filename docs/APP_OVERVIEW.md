# FitnessTrainingBuddy — App Overview

*A succinct summary of what this app is and why. Review this every now and again. Last updated: 2026-07-12.*

## Purpose

A personal fitness training tracker built for one job: **make logging near-zero-effort at the gym, make training history actually reviewable, and eventually recommend what to do and when to back off.**

Replaces a pen-and-paper notebook (captured but never reviewed) and scattered Notion pages (workouts that get lost). The real problems being solved are **visibility** (what have I actually been doing?) and **time** (fitting frequent, small rehab work into a full schedule).

## Who it's for

The user, single user — but architected so multi-user is an extension, not a rewrite (all data scoped under an implicit user from day one).

## Foundational decisions

| Decision | Choice |
|---|---|
| Platform | Mobile-first installable PWA, one-handed use at the gym |
| Storage | Local-first on-device structured store (source of truth) |
| Sync | Best-effort/irregular; future "live mode" layerable for AI features |
| Export | **All history mirrored to human-readable markdown continuously** — portable data the user owns |
| Accounts | None for now; user-scoped data model keeps the door open |
| Units | Kilograms |

## Core concepts

- **Exercise** — name, category (strength / rehab / flexibility / accessory / movement), *suggested tempo*, notes. **Tempo** is tracked for all exercises as the standard 4-digit notation — **Eccentric–Pause(bottom)–Concentric–Pause(top)**, e.g. `3-1-1-0`, `X` = explosive — a sticky per-exercise default shown with an in-app legend, edited occasionally, not logged per set.
- **Workout Template** — one of ~2–5 defaults (e.g. "Upper Body", "Lower Body", plus 15–30 min home *micro workouts*). Sections:
  - **Warm-up** *(optional)* — movement/joint articulation; light or no logging. Includes the **starting energy/fatigue check-in (1–10)**.
  - **Primary** — 2–5 mandatory exercises done with intention, organized as **exercise groups**: a group is either one exercise (straight sets) or a **superset pair** (e.g. bench press + pull-up, alternated). Each group carries a **prescribed rest** (e.g. 90s after each movement within the group) — a sticky programme value with a simple tap timer, not manually logged. Rest *between* groups is deliberately untracked (equipment availability makes it noise). Full tracking per set: reps × weight, suggested tempo, **per-set effort (1–10)**. Highly consistent week to week. ~30–40 min.
  - **Secondary** — rehab, weighted flexibility, accessories (calves, biceps…). Deliberately loose: quality/feel-based, sets/reps optional, low-friction logging. More exploratory, less consistent.
  - **Cool-down** *(optional)* — breathing, stretching; tick-box level.
- **Session** — an instance of a template. **Pre-filled from two sources ("copy-forward")**: the template supplies structure and target reps, the last session supplies your loads, intensity and rest; the user only adjusts what changed. Closes with **overall session effort (1–10)**, **ending fatigue (1–10)** and **workout length in minutes** (prefilled from the clock, editable).
- **Flexing a session** — sessions are instances, so they can diverge from their template:
  - **Add an exercise mid-session** (from the library, or brand new): user picks which section it lands in, then is immediately asked — *just this session / add to this template / add to another template*. Default is session-only; the template is never silently changed.
  - **Skip an exercise** — one tap marks it skipped for today; history records the skip; the template is untouched (no prompt).
  - **Remove an exercise** (added 2026-09-06) — deletes it from today's workout rather than marking it skipped, behind a confirm since logged sets go with it. The confirm asks *just today* or *also remove it from the template*, and only offers the template option when the exercise is in there. Skip and remove answer different questions: "not today" vs "not any more".
  - Ad-hoc exercises **always join the exercise library**, so progression history accumulates even for exercises that belong to no template.

### Training cycles (added 2026-09-06)

Training is not monotonic: intensity ramps for a few weeks, hits a wall, then a **deload week** at lighter weights lets things recover before the next cycle starts. Every session carries a **week type** — `build`, `peak` or `deload` — chosen with one tap on the session screen and switchable mid-workout, because that is when the decision really gets made.

The week type is what the numbers hang off. Build and peak weeks pick up from the previous workout (including from a deload — a new cycle *should* restart light and ramp again). A deload offers **60% of what was last lifted with half the sets** (rounded to 2.5kg; L/R pairs kept whole) — the user's choice on 2026-09-23 after reviewing coaching guidance (60–75% of working weight, sets cut 40–60%, every ~4–8 weeks), taking the lighter end because he trains at ~8.5/10. It remembers the rep scheme and set count from the last deload so they only have to be dialled in once. Nothing is imposed: every number is a starting offer on a stepper.

The app deliberately **records** the cycle rather than planning it. No cycle length, no calendar, no rules engine — see the backlog for the suggestion layer ("week 4 and stalling — make this a deload?") that sits on top.

### Design principle: defaults everywhere

If the user says nothing, assume something sensible — never block logging on an empty field. Starting defaults: **intensity 7/10**; rest and tempo inherit the exercise's sticky value; reps/loads copy forward from last session. Defaults are visible and one-tap editable, and placeholder values get refined during real sessions.

### Data-model notes
- **Single-side work is one row per side.** `PlannedSet`/`LoggedSet` carry an optional `side: 'L' | 'R'`, and adding a unilateral exercise generates *two* rows per set, alternating L, R, L, R. Three sets is therefore six rows. This exists because rehab sides genuinely diverge — the weaker side often takes fewer reps at a lighter load — and averaging them into one row loses the asymmetry that matters. `side` is optional so pre-existing unilateral sets (where one row meant "reps per side") keep rendering as before; the template editor offers "⇄ split into L/R" to convert them. Sets are added and removed in pairs so the two sides never drift out of step.
 (from real seed workouts)

- **Load types**: absolute kg · bodyweight · BW + added kg · band · light "as-needed" weights.
- **Intensity/effort** is rated **per exercise** by default (fractional allowed, e.g. 7.5/10), with optional per-set override.
- **Unilateral exercises** are common (per-side flag; "2s × 8r each side" logged in one tap).
- **Supersets default to symmetric** (same set count both exercises) but must allow asymmetry as a flex (e.g. 5 sets pull-ups vs 4 sets bench); pairing governs rotation + rest, set lists stay independent.
- **Ramping weight across sets** is the norm — per-set loads are first-class.
- **Secondary gets the same table format + intensity as Primary**; **Cool-down stays loose** (bullets, no intensity/tables) even though it can contain real exercises (weighted capsule stretches).
- **Ramp sets vs main work sets** — sets carry a "main work" flag (deadlift: 60/80/100/110 ramp → 120×3×3 main); progression tracking watches main work sets.
- **Warm-up sets** (added 2026-08-10) — sets also carry an explicit `warmup` flag, toggled via a "W" bubble on set rows in the template editor and live in-session. The user often opens a primary exercise with 2–3 warm-up sets and wants them flagged; shown as "(w)" wherever sets render, copies forward, excluded from progression alongside non-main-work sets.
- **Rest is per-movement, not per-group** — "rest after this exercise" (calf raises 0s → tibialis 60s); symmetric rest is the default, asymmetric an occasional pattern.
- **Set modifiers** — short technique notes that copy forward ("pause at the top").
- **Duration-based items** — a third prescription type beyond reps and loose/quality (e.g. 5 min of 4-7-8 breathing, 12-min warm-up).
- **Category ≠ section** — a stretch can sit in Primary with full sets/reps/intensity tracking (diagonal stretch); the user decides placement.
- **Skipped exercises are decisions, not history** (added 2026-09-04) — the `skipped` flag still lives on the session and still resets on copy-forward, but the markdown mirror leaves skipped exercises out completely (renumbering what remains, and collapsing a superset that lost a member). A list of things that did not happen made the file harder to read. The same reasoning drives the finish-workout prompt: an unlogged set is a hole worth asking about, a skipped one is not.
- **Two sources, not one** (decided 2026-09-06) — the template is the *prescription* (exercises, sets, target reps) and the last workout is the *record* (loads, intensity, rest). A workout is built from the first and overlaid with the second. The point is that targets do not drift upward on their own: doing 3 reps where it said 6 does not make 3 the new plan, and the plan can come *down* for a deload week without fighting the app. It also means template edits reach your next workout, which they previously did not.
- **Workout length is asked, not measured** (added 2026-09-04) — `Session.durationMin` is prefilled on the close screen from `startedAt`→now, then confirmed or corrected. The app's own stamps are routinely wrong in real use (logging started after the workout did, phone left open on the bench afterwards), so the number kept is the one the user agreed to.
- Exercise library accepts **user-invented names** ("shoulder overhead exploration").
- Seed templates live in `src/data/seed.ts`.

### Effort vs. fatigue

Tracked separately because they diverge: a 10/10-effort session can leave 2/10 fatigue or 8/10 fatigue. The divergence trend over weeks is the key overtraining / under-recovery signal for future recommendations.

## The core interaction (v1)

1. Arrive at gym → open app → pick today's template.
2. Warm-up: enter starting energy/fatigue.
3. Primary: work through exercise groups (straight sets or superset rotation), each pre-filled from last time → adjust reps/weight/effort per set with minimal taps; rest timer counts the prescribed rest.
4. Secondary: quick, optional, feel-based logging.
5. Close session: overall effort + ending fatigue + workout length (prefilled from elapsed time). Finishing with sets neither logged nor skipped asks for confirmation first.
6. History and markdown mirror update automatically.

## Phases

- **Phase 1 (v1)**: templates, copy-forward session logging, effort/fatigue/energy ratings, history views + basic per-exercise progression, markdown mirror, offline PWA.
- **Phase 2+**: see the backlog — calendar integration, micro-workout scheduling suggestions, AI coach recommendations (staleness/deload detection), other training types (paddle, cardio, movement, yoga), live mode.

## Project docs

- The backlog (kept in the instance's private repo) — planned later-phase items + exploratory ideas. Maintained as markdown in this repo (human-readable, no external PM tool).
