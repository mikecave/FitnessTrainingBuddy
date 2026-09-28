// Cloud sync against the Cloudflare D1-backed endpoint.
//
// The whole point is ONE dataset regardless of which URL the app is opened
// from. Browser storage is per-origin, so localhost and the deployed site can
// never share a database directly; they converge by both syncing to the same
// server. Hence the endpoint is absolute rather than relative — the dev server
// deliberately talks to the production database.
//
// Conflict rule is last-write-wins on `updatedAt`, the same rule the file-based
// backup import already uses, so a sync is just an import from the server plus
// an export to it.

import { exportAllData, importData } from './repo';
import type { BackupFile, ImportSummary } from './types';

/** Same-origin in production. The dev server (localhost:5173) has no Pages
 *  Functions, so it points at the deployed instance via VITE_SYNC_ENDPOINT
 *  in .env.local — instance config, kept out of this repo. */
export const SYNC_ENDPOINT: string = import.meta.env.VITE_SYNC_ENDPOINT || '/api/sync';

const TOKEN_KEY = 'fitbuddy.syncToken';
const LAST_SYNC_KEY = 'fitbuddy.lastSyncAt';
const LAST_ERROR_KEY = 'fitbuddy.lastSyncError';

export function getSyncToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setSyncToken(token: string): void {
  const trimmed = token.trim();
  if (trimmed) localStorage.setItem(TOKEN_KEY, trimmed);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Why the last sync attempt failed, or null if the last one worked. Background
 *  syncs used to fail completely silently, which made a broken device
 *  indistinguishable from an idle one. */
export function getLastSyncError(): string | null {
  return localStorage.getItem(LAST_ERROR_KEY);
}

export function getLastSyncAt(): number | null {
  const raw = localStorage.getItem(LAST_SYNC_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** True once a key has been set on THIS device — sync is per-device because the
 *  key lives in localStorage, which is per-origin. */
export function isSyncConfigured(): boolean {
  return getSyncToken() !== '';
}

export interface SyncResult {
  /** Records this device sent up. */
  pushed: number;
  /** What came back down and was applied locally. */
  summary: ImportSummary;
  at: number;
}

export async function syncNow(): Promise<SyncResult> {
  const token = getSyncToken();
  if (!token) throw new Error('No sync key set yet.');

  const local = await exportAllData();

  let res: Response;
  try {
    res = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: local.data }),
    });
  } catch {
    throw new Error('Could not reach the sync server — offline?');
  }

  if (res.status === 401) throw new Error('Sync key rejected — check the key.');
  if (!res.ok) throw new Error(`Sync failed (HTTP ${res.status}).`);

  const payload = (await res.json()) as { ok: boolean; pushed: number; data: BackupFile['data'] };
  if (!payload?.ok || !payload.data) throw new Error('Sync server returned an unexpected response.');

  // Apply the server's merged truth locally, same last-write-wins rule.
  const summary = await importData(
    {
      format: 'fitbuddy-backup',
      version: 1,
      exportedAt: Date.now(),
      data: payload.data,
    } satisfies BackupFile,
    'merge',
  );

  const at = Date.now();
  localStorage.setItem(LAST_SYNC_KEY, String(at));
  localStorage.removeItem(LAST_ERROR_KEY);
  return { pushed: payload.pushed, summary, at };
}

// ---- automatic sync ----
//
// Manual-only sync was a design mistake: pushing from the phone left every other
// device stale until someone remembered to press the button there too, which is
// not what "one database" means to anyone using it. These guards make it safe to
// call on app start and whenever the app comes back to the foreground.

let inFlight: Promise<SyncResult | null> | null = null;

/** Skip a sync that just happened — foregrounding an app fires repeatedly. */
const MIN_INTERVAL_MS = 20_000;

/**
 * Sync if it makes sense to: a key is set, nothing is already running, and we
 * did not just sync. Never throws — a failed background sync (offline in the
 * gym, most likely) must not surface as an error or block anything.
 *
 * @returns the result, or null if it was skipped or failed.
 */
export function maybeSync(options: { force?: boolean } = {}): Promise<SyncResult | null> {
  if (!isSyncConfigured()) return Promise.resolve(null);
  if (inFlight) return inFlight;

  const last = getLastSyncAt();
  if (!options.force && last && Date.now() - last < MIN_INTERVAL_MS) {
    return Promise.resolve(null);
  }

  inFlight = syncNow()
    .catch((err: unknown) => {
      // Remember why, so the UI can say so. Still resolves null: a background
      // sync must never surface as a thrown error or block the app.
      localStorage.setItem(
        LAST_ERROR_KEY,
        err instanceof Error ? err.message : 'Sync failed for an unknown reason.',
      );
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Did a sync actually bring anything down or push anything up? Used to decide
 *  whether the screens need to re-read the database. */
export function syncChangedData(result: SyncResult | null): boolean {
  if (!result) return false;
  const tables = [result.summary.exercises, result.summary.templates, result.summary.sessions, result.summary.feedback];
  return result.pushed > 0 || tables.some((t) => t.added > 0 || t.updated > 0);
}
