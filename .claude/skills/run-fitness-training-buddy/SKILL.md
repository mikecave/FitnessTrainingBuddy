---
name: run-fitness-training-buddy
description: Run, screenshot, and drive the FitnessTrainingBuddy PWA in a headless browser. Use when asked to run the app, start the dev server, verify a UI change works, take screenshots, or click through a workout flow.
---

FitnessTrainingBuddy is a Vite/React PWA (no backend — data lives in IndexedDB
in the browser profile). To verify UI changes, start the dev server, then drive
headless Chromium with the Playwright REPL driver in this skill directory.
`chromium-cli` is not installed on this machine; the driver is the equivalent.

All paths are relative to the repo root.

## Prerequisites (already satisfied on this machine)

- Node at `~/.local/node` (on PATH via `~/.zshrc`).
- Driver deps are vendored in this skill dir. If ever missing:
  ```bash
  cd .claude/skills/run-fitness-training-buddy && npm install && npx playwright install chromium
  ```

## Run: dev server

```bash
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null; sh scripts/dev.sh > /tmp/fitness-dev.log 2>&1 &
disown
i=0; until curl -sf http://localhost:5173 >/dev/null || [ $i -ge 30 ]; do sleep 1; i=$((i+1)); done; curl -sf http://localhost:5173 >/dev/null && echo "DEV SERVER UP" || cat /tmp/fitness-dev.log
```

Stop it when done: `lsof -ti:5173 -sTCP:LISTEN | xargs -r kill`

(The port-kill first is required: `--strictPort` means a leftover server from a
previous run fails the launch instead of picking a new port. Don't use
`timeout` for the poll — macOS doesn't ship it; use the counter loop above.)

## Run (agent path): drive the app

Pipe commands to the driver via heredoc — it executes them serially and exits
cleanly at EOF:

```bash
cd .claude/skills/run-fitness-training-buddy && node driver.mjs <<'EOF'
launch
nav
wait text=FitBuddy
ss 01-home
click-in-card "Upper Body 1" rounded-xl button Start
wait h1:has-text("Upper Body 1")
ss 02-session
click button:has-text("✓")
errors
quit
EOF
```

Screenshots land in `/tmp/fitness-training-buddy-shots/` (override with
`SCREENSHOT_DIR`). Dev URL defaults to `http://localhost:5173` (override with
`DEV_URL`). **Read the screenshot files and check `errors` output before
declaring success** — a page can render while every interaction silently fails.

### Commands

| command | what it does |
|---|---|
| `launch` | start headless Chromium (collects console/page errors from then on) |
| `nav [url]` | go to url (default `DEV_URL`) |
| `wait <sel>` | wait for selector, 10s timeout, prints TIMEOUT on failure |
| `ss [name]` | screenshot → `/tmp/fitness-training-buddy-shots/<name>.png` |
| `click <sel> [n]` | click nth match (0-indexed, default 0) of a Playwright selector |
| `click-role <role> <name>` | click by accessible role + visible name |
| `click-in-card "<exact text>" <ancestor-class> <role> <name>` | click a control inside the card containing an exact-text heading (see Gotchas) |
| `fill <sel> <text>` | fill an input/textarea (fires React onChange properly) |
| `select <sel> <value>` | choose a `<select>` option by value — raw `el.value=` + dispatchEvent does NOT update React state; this uses selectOption which does. Target by option: `select:has(option[value="duration"])` |
| `type <text>` / `press <key>` | raw keyboard input |
| `eval <js>` | evaluate in page, print JSON (e.g. `eval () => window.scrollTo(0, 99999)`) |
| `text [sel]` | print innerText of selector (or whole body) |
| `errors` | print all console/page errors collected since launch |
| `quit` | close browser and exit |

### A verified full-session flow

This exact sequence ran clean (start workout → confirm sets → bump intensity →
toggle cool-down item → finish → close form → back at Home, zero errors):

```
launch
nav
wait text=FitBuddy
click-in-card "Upper Body 1" rounded-xl button Start
wait h1:has-text("Upper Body 1")
click button:has-text("✓")
click button:has-text("✓")
click button:has-text("+")
eval () => window.scrollTo(0, document.body.scrollHeight)
click button:has-text("○")
click button:has-text("Finish workout")
wait h1:has-text("Finish workout")
click button:has-text("+") 0
click button:has-text("+") 1
fill textarea smoke test
click button:has-text("Save & finish")
wait text=FitBuddy
errors
quit
```

## Run (human path)

`sh scripts/dev.sh` then open http://localhost:5173. Ctrl-C to stop.

## Test / build

```bash
npm test        # Vitest (uses fake-indexeddb; no browser needed)
npm run build   # tsc + vite build + PWA service worker
```

## Gotchas

- **Home is tabbed (since 2026-09-24): Upper / Lower / The rest.** Only the
  selected tab's workouts are in the DOM, and it opens on the *due* group (the
  one of Upper/Lower trained longest ago). With seed data that's Upper. To reach
  another group first: `click role=tab[name=/Lower/]`. Workout rows are
  `rounded-xl` (was `rounded-2xl` cards); Edit/View/Copy sit behind the row's
  `⋯` button (`button[aria-label^="More for <name>"]`).

- **Template names are substrings of each other** — "Upper Body 1" also
  matches "Micro — Upper Body 1" with `hasText`. That's what `click-in-card`
  is for: it anchors on `:text-is(...)` (exact match) then walks up to the
  `rounded-2xl` card ancestor. A naive `click-role button Start` resolves to
  3 elements and fails on strict-mode violation.
- **Repeated identical buttons** — the session-close form has two `+` stepper
  buttons (effort, fatigue). Use the index arg: `click button:has-text("+") 1`.
- **State persists between runs** in the Chromium profile's IndexedDB — a
  second run of the flow starts with values copied forward from the first
  (that's the app's copy-forward feature, not a bug). An `active` session left
  behind by an aborted run hides the Start buttons (Home shows a Resume banner
  instead); either resume-and-finish it via the driver, or start from
  `click-role button Resume`.
- **Each browser context is fresh though** — `launch` creates a new context,
  so localStorage/IndexedDB actually reset per driver run. Only same-run state
  persists. (If a run behaves as if data carried over, it's the app re-seeding
  from `src/data/seed.ts`.)
- **`eval` takes an arrow function OR a bare expression** — `eval () => window.scrollTo(0, 99999)` or `eval document.title`. A function is invoked and its return value printed (`(undefined)` when it returns nothing). Before 2026-09-01 the driver evaluated the string as an expression, so an arrow function was created and never called: the eval printed `undefined` and silently did nothing. If an `eval` seems to have no effect, check you are on the current driver.

## Troubleshooting

- **Driver prints banner then exits silently / `ERR_USE_AFTER_CLOSE`** — you're
  on an old driver.mjs. Piped stdin EOFs immediately; the driver must drain its
  command queue on close and guard `rl.prompt()`. Current version handles both.
- **`Timed out waiting` on the first `wait` after `nav`** — dev server not up;
  re-run the dev-server block and check `/tmp/fitness-dev.log`.
- **`browserType.launch: Executable doesn't exist`** — run
  `npx playwright install chromium` inside the skill dir.
- **Port 5173 in use / instant dev-server exit** — leftover listener;
  `lsof -ti:5173 -sTCP:LISTEN | xargs -r kill` and relaunch.
