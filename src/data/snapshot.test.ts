import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { ensureSeeded, importData, listTemplates } from './repo';

// Lives in the instance's private repo, checked out at ./private. Absent in a
// fresh clone of the public code, in which case the test is skipped.
const SNAPSHOT = 'private/data-backup/fitbuddy-data.json';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

// The committed snapshot is the last line of defence: it is what gets imported
// if the Cloudflare account is gone. A snapshot that cannot be imported is
// worthless, so assert it against the real import path rather than trusting it.
describe('committed data snapshot', () => {
  it.skipIf(!existsSync(SNAPSHOT))('imports cleanly into an empty database', async () => {
    const parsed = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    const summary = await importData(parsed);

    expect(summary.templates.added).toBeGreaterThan(0);
    const names = (await listTemplates()).map((t) => t.name);
    expect(names.length).toBe(summary.templates.added);

    // Re-importing must be a no-op, so a restore can be repeated safely.
    const again = await importData(parsed);
    expect(again.templates.added).toBe(0);
    expect(again.templates.updated).toBe(0);
  });

  it.skipIf(!existsSync(SNAPSHOT))('survives being restored over seeded data', async () => {
    await ensureSeeded();
    const parsed = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    await importData(parsed);
    // Seed templates must not have clobbered the snapshot's copies.
    const templates = await listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(
      (parsed as { data: { templates: unknown[] } }).data.templates.length,
    );
  });
});
