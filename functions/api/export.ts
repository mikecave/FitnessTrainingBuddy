// GET /api/export — read-only exports of the sync database, for GitHub Actions.
//
//   (default)        the workout log as markdown files. Pulled nightly by
//                    a personal wiki repo by its own GitHub Action.
//   ?format=backup   every record, in the app's own Backup → Import format.
//                    Pulled nightly by this repo's data-backup workflow into
//                    data-backup/fitbuddy-data.json — the restorable copy for
//                    the day Cloudflare itself is gone.
//
// Both use their own key (EXPORT_TOKEN) rather than reusing SYNC_TOKEN: the export key lives in GitHub, and a key
// stored there should only be able to read, never to write into the database.

import type { Exercise, Session, Template } from '../../src/data/types';
import { buildLogFiles } from '../../src/lib/exportLog';

interface D1Database {
  prepare(query: string): { all<T = unknown>(): Promise<{ results: T[] }> };
}

interface Env {
  DB: D1Database;
  EXPORT_TOKEN: string;
  /** IANA zone for times in the markdown, e.g. "Europe/London". */
  LOG_TIME_ZONE?: string;
}

/** Length-independent comparison, so a wrong token leaks nothing by timing.
 *  Same as sync.ts — duplicated because every file under functions/ is a route. */
function tokenMatches(given: string, expected: string): boolean {
  if (!expected) return false;
  let diff = given.length ^ expected.length;
  for (let i = 0; i < Math.max(given.length, expected.length); i++) {
    diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

const KINDS = ['exercises', 'templates', 'sessions', 'feedback'] as const;

/** Same envelope as the Backup screen and the old scripts/snapshot-data.mjs.
 *  Sorted by id with a fixed exportedAt, so an unchanged database produces a
 *  byte-identical file and the nightly job commits nothing. */
function backupFile(rows: { kind: string; json: string }[]) {
  const data: Record<string, { id: string }[]> = { exercises: [], templates: [], sessions: [], feedback: [] };
  for (const row of rows) {
    if (!(KINDS as readonly string[]).includes(row.kind)) continue;
    try {
      data[row.kind].push(JSON.parse(row.json));
    } catch {
      // A corrupt row must not sink the whole backup.
    }
  }
  for (const list of Object.values(data)) list.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { format: 'fitbuddy-backup', version: 1, exportedAt: 0, data };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!tokenMatches(token, env.EXPORT_TOKEN)) {
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }

  const rows = await env.DB.prepare('SELECT kind, json FROM records').all<{
    kind: string;
    json: string;
  }>();

  if (new URL(request.url).searchParams.get('format') === 'backup') {
    return json(backupFile(rows.results), 200);
  }

  const sessions: Session[] = [];
  const templates: Template[] = [];
  const exercises: Exercise[] = [];
  for (const row of rows.results) {
    try {
      const rec = JSON.parse(row.json);
      if (row.kind === 'sessions') sessions.push(rec);
      else if (row.kind === 'templates') templates.push(rec);
      else if (row.kind === 'exercises') exercises.push(rec);
    } catch {
      // A corrupt row must not sink the whole export.
    }
  }

  return json({ ok: true, files: buildLogFiles(sessions, templates, exercises, env.LOG_TIME_ZONE || undefined) }, 200);
}
