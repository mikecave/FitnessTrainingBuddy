#!/usr/bin/env node
// REPL driver for FitnessTrainingBuddy (Vite/React PWA). Launches headless
// Chromium via Playwright and drives it via stdin commands. Designed for
// agents: pipe a heredoc of commands, or run interactively and type them.
//
// chromium-cli is not installed on this machine, so this is the documented
// fallback in the `run` skill: same idea, hand-rolled with plain Playwright.

import { chromium } from 'playwright';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DEV_URL = process.env.DEV_URL || 'http://localhost:5173';
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/fitness-training-buddy-shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

let browser = null;
let page = null;
const consoleErrors = [];

const COMMANDS = {
  async launch() {
    if (browser) return console.log('already launched');
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    // VIEWPORT=390x844 reproduces a phone. Worth using by default for this app:
    // it is mobile-first, and at least one real bug (numeric inputs shrinking in
    // a crowded flex row until a digit clipped) only reproduced at phone width.
    const vp = process.env.VIEWPORT?.match(/^(\d+)x(\d+)$/);
    const contextOpts = vp
      ? { viewport: { width: Number(vp[1]), height: Number(vp[2]) }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : {};
    page = await (await browser.newContext(contextOpts)).newPage();
    if (vp) console.log(`viewport: ${vp[1]}x${vp[2]} (mobile)`);
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    console.log('launched.');
  },

  async nav(url) {
    if (!page) return console.log('ERROR: launch first');
    await page.goto(url || DEV_URL);
    console.log('navigated to', url || DEV_URL);
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, `${name || `ss-${Date.now()}`}.png`);
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  // Generic CSS/text-pseudo selector click, e.g.:
  //   click span.text-lg.font-semibold:text-is("Upper Body 1")
  // Optional trailing integer picks the nth match (0-indexed) when a page
  // has several identical elements (e.g. two "+" stepper buttons):
  //   click button:has-text("+") 1
  async click(argsRaw) {
    if (!page) return console.log('ERROR: launch first');
    const parts = argsRaw.trim().split(/\s+/);
    let idx = 0;
    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
      idx = Number(parts.pop());
    }
    const sel = parts.join(' ');
    try {
      await page.locator(sel).nth(idx).click();
      console.log('clicked:', sel, `[${idx}]`);
    } catch (e) {
      console.log('ERROR:', String(e.message).split('\n')[0]);
    }
  },

  // Click a button/link by accessible role + visible name, e.g.:
  //   click-role button Start
  async 'click-role'(args) {
    if (!page) return console.log('ERROR: launch first');
    const [role, ...nameParts] = args.split(' ');
    const name = nameParts.join(' ');
    try {
      await page.getByRole(role, { name }).first().click();
      console.log('clicked role:', role, name);
    } catch (e) {
      console.log('ERROR:', String(e.message).split('\n')[0]);
    }
  },

  // Click nearest ancestor of an exact-text element matching an ancestor
  // class, then click a role/name inside it. Needed because this app's
  // cards repeat similar text ("Upper Body 1" is a substring of "Micro —
  // Upper Body 1") — see Gotchas in SKILL.md.
  // usage: click-in-card <exact-heading-text> <ancestor-class> <role> <name>
  async 'click-in-card'(args) {
    if (!page) return console.log('ERROR: launch first');
    const [headingText, ancestorClass, role, ...nameParts] = args
      .match(/"[^"]*"|\S+/g)
      .map((s) => s.replace(/^"|"$/g, ''));
    const name = nameParts.join(' ');
    try {
      const heading = page.locator(`:text-is("${headingText}")`);
      const card = heading.locator(`xpath=ancestor::div[contains(@class,"${ancestorClass}")][1]`);
      await card.getByRole(role, { name }).first().click();
      console.log('clicked in card:', headingText, '->', role, name);
    } catch (e) {
      console.log('ERROR:', String(e.message).split('\n')[0]);
    }
  },

  async fill(args) {
    if (!page) return console.log('ERROR: launch first');
    const [sel, ...rest] = args.split(' ');
    try {
      await page.locator(sel).first().fill(rest.join(' '));
      console.log('filled:', sel);
    } catch (e) {
      console.log('ERROR:', String(e.message).split('\n')[0]);
    }
  },

  // Choose a <select> option by value — locator.selectOption fires the full
  // event chain React needs (raw el.value + dispatchEvent does NOT update
  // React state). usage: select <selector> <value>
  async select(args) {
    if (!page) return console.log('ERROR: launch first');
    const parts = args.trim().split(/\s+/);
    const value = parts.pop();
    const sel = parts.join(' ');
    try {
      await page.locator(sel).first().selectOption(value);
      console.log('selected:', sel, '=', value);
    } catch (e) {
      console.log('ERROR:', String(e.message).split('\n')[0]);
    }
  },

  // Drag one element onto another with stepped mouse moves. dnd-kit's
  // PointerSensor needs real intermediate pointermove events past its
  // activation distance — locator.dragTo's single jump doesn't trigger it.
  // usage: drag <source-selector> => <target-selector>
  async drag(args) {
    if (!page) return console.log('ERROR: launch first');
    const [srcSel, dstSel] = args.split(' => ').map((s) => s?.trim());
    if (!srcSel || !dstSel) return console.log('ERROR: usage: drag <src> => <dst>');
    try {
      const a = await page.locator(srcSel).first().boundingBox();
      const b = await page.locator(dstSel).first().boundingBox();
      if (!a || !b) return console.log('ERROR: element not visible');
      const from = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
      const to = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(
          from.x + ((to.x - from.x) * i) / steps,
          from.y + ((to.y - from.y) * i) / steps,
        );
        await page.waitForTimeout(25);
      }
      await page.mouse.up();
      await page.waitForTimeout(150); // let the drop settle/persist
      console.log('dragged:', srcSel, '=>', dstSel);
    } catch (e) {
      console.log('ERROR:', String(e.message).split('\n')[0]);
    }
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 20 });
  },
  async press(key) {
    if (page) await page.keyboard.press(key);
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    // page.evaluate() treats a string as an EXPRESSION, so "() => {...}" merely
    // evaluates to a function object and is never called — the eval appeared to
    // succeed (printing undefined) while doing nothing at all. Invoke it.
    const src = expr.trim();
    const isFn = /^(async\s+)?(function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(src);
    try {
      const result = await page.evaluate(isFn ? `(${src})()` : src);
      console.log(result === undefined ? '(undefined)' : JSON.stringify(result));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(
      await page.evaluate(
        (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
        sel || null,
      ),
    );
  },

  errors() {
    console.log(consoleErrors.length ? JSON.stringify(consoleErrors) : 'none');
  },

  async quit() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    page = null;
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '));
  },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

// readline's 'line' event fires for every buffered line immediately — it does
// NOT wait for an async handler to finish before firing the next one. Piping
// a heredoc of commands (as opposed to typing them one at a time) means every
// line is available at once, so without this queue, "launch" would still be
// opening the browser while "nav"/"click"/... already raced ahead and found
// `page` null. Chaining through one promise serializes execution.
let queue = Promise.resolve();
let closed = false;
const safePrompt = () => {
  if (!closed) rl.prompt();
};
rl.on('line', (line) => {
  queue = queue.then(async () => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    if (!cmd) return safePrompt();
    const fn = COMMANDS[cmd];
    if (!fn) {
      console.log('unknown:', cmd, '— try: help');
      return safePrompt();
    }
    try {
      await fn(rest.join(' '));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
    if (cmd === 'quit') {
      closed = true;
      rl.close();
      process.exit(0);
    }
    safePrompt();
  });
});
rl.on('close', async () => {
  // With piped input, EOF arrives while the queue is still draining — wait
  // for every queued command to finish before shutting down.
  closed = true;
  await queue;
  await COMMANDS.quit();
  process.exit(0);
});

console.log('fitness-training-buddy driver — "help" for commands, "launch" then "nav" to start');
rl.prompt();
