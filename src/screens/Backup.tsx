import { useRef, useState } from 'react';
import { exportAllData, importData } from '../data/repo';
import {
  getLastSyncAt,
  getSyncToken,
  setSyncToken,
  syncNow,
  type SyncResult,
} from '../data/sync';
import type { ImportSummary, TableImportCounts } from '../data/types';

function backupFilename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `fitbuddy-backup-${y}-${m}-${day}.json`;
}

function line(label: string, c: TableImportCounts): string {
  return `${label}: ${c.added} added, ${c.updated} updated, ${c.skipped} unchanged`;
}

/** Manual device-to-device backup & restore. Export a JSON file, move it to
 *  another device, import it (merge = sync-like; replace = destructive). */
export default function Backup({ onBack }: { onBack: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  /** Set when the user has armed a destructive replace; the file picker then imports in replace mode. */
  const [replaceArmed, setReplaceArmed] = useState(false);
  const [tokenDraft, setTokenDraft] = useState(getSyncToken());
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(getLastSyncAt());
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'current' | 'found'>('idle');

  /** An installed PWA keeps serving its cached build until a new service worker
   *  takes over, which normally happens on the NEXT launch — so the phone can
   *  legitimately look older than the website. This forces the check now. */
  async function checkForUpdate() {
    setUpdateState('checking');
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) {
        setUpdateState('current');
        return;
      }
      const before = reg.waiting ?? reg.installing;
      await reg.update();
      const after = reg.waiting ?? reg.installing;
      if (after && after !== before) {
        setUpdateState('found');
        // The new worker is claiming control; reload onto it.
        setTimeout(() => window.location.reload(), 600);
      } else {
        setUpdateState('current');
      }
    } catch {
      setUpdateState('current');
    }
  }

  async function handleSync() {
    setError(null);
    setSummary(null);
    setSyncResult(null);
    setSyncing(true);
    try {
      setSyncToken(tokenDraft);
      const result = await syncNow();
      setSyncResult(result);
      setLastSync(result.at);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleExport() {
    setError(null);
    const backup = await exportAllData();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFilename();
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  }

  function pickFile(replace: boolean) {
    setReplaceArmed(replace);
    setError(null);
    setSummary(null);
    fileInput.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;

    const mode = replaceArmed ? 'replace' : 'merge';
    if (mode === 'replace') {
      const ok = window.confirm(
        'Replace ALL data on this device with the contents of this file?\n\n' +
          'This deletes every workout and template currently on this device first. This cannot be undone.',
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON.');
      }
      const result = await importData(parsed, mode);
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-sky-400">
        ← Home
      </button>

      <h1 className="mb-1 text-2xl font-bold">Backup &amp; Sync</h1>
      <p className="mb-6 text-sm text-slate-400">
        Cloud sync keeps every device on one dataset. The file export below is the offline
        fallback.
      </p>

      {/* Cloud sync — the canonical copy */}
      <div className="mb-4 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-5">
        <div className="font-semibold">Cloud sync</div>
        <p className="mb-3 mt-1 text-sm text-slate-300">
          Sends this device's data up, pulls everything else down, newest change winning. Same
          dataset whether you open the app on your phone or the dev server.
        </p>

        <input
          type="password"
          value={tokenDraft}
          onChange={(e) => setTokenDraft(e.target.value)}
          // Persist as soon as the field is left, not only when "Sync now" is
          // pressed. Previously a key could be typed and the device still had
          // none stored, so it silently kept its own private copy of the data.
          onBlur={(e) => setSyncToken(e.target.value)}
          placeholder="Sync key"
          aria-label="Sync key"
          className="mb-2 w-full rounded-lg bg-slate-800 px-3 py-2 font-mono text-sm placeholder:text-slate-500"
        />
        <button
          disabled={syncing || !tokenDraft.trim()}
          onClick={() => void handleSync()}
          className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold disabled:opacity-40 active:bg-sky-500"
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <p className="mt-2 text-xs text-slate-400">
          {lastSync
            ? `Last synced ${new Date(lastSync).toLocaleString()}`
            : 'Not synced on this device yet.'}
        </p>
      </div>

      {syncResult && (
        <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          <div className="mb-1 font-semibold">Sync complete</div>
          <ul className="space-y-0.5 font-mono text-xs">
            <li>sent up: {syncResult.pushed} records</li>
            <li>{line('Templates', syncResult.summary.templates)}</li>
            <li>{line('Sessions', syncResult.summary.sessions)}</li>
            <li>{line('Exercises', syncResult.summary.exercises)}</li>
            <li>{line('Feedback', syncResult.summary.feedback)}</li>
          </ul>
        </div>
      )}

      {/* Export */}
      <div className="mb-4 rounded-2xl bg-slate-800 p-5">
        <div className="font-semibold">Export a backup</div>
        <p className="mb-3 mt-1 text-sm text-slate-400">
          Downloads a <span className="font-mono text-slate-300">.json</span> file with every
          exercise, template and logged session on this device.
        </p>
        <button
          onClick={handleExport}
          className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold active:bg-sky-500"
        >
          {exported ? 'Downloaded ✓' : 'Export backup file'}
        </button>
      </div>

      {/* Import */}
      <div className="mb-4 rounded-2xl bg-slate-800 p-5">
        <div className="font-semibold">Import a backup</div>
        <p className="mb-3 mt-1 text-sm text-slate-400">
          <span className="font-semibold text-slate-300">Merge</span> keeps everything and only
          adds or updates from the file (newer wins) — safe, and the right choice for syncing
          between devices.
        </p>
        <button
          disabled={busy}
          onClick={() => pickFile(false)}
          className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold disabled:opacity-40 active:bg-emerald-500"
        >
          {busy ? 'Importing…' : 'Import & merge'}
        </button>
        <button
          disabled={busy}
          onClick={() => pickFile(true)}
          className="mt-2 w-full rounded-xl bg-slate-700 py-2 text-xs font-semibold text-slate-300 disabled:opacity-40 active:bg-slate-600"
        >
          Replace all instead (destructive)
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          className="hidden"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {summary && (
        <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          <div className="mb-1 font-semibold">
            Import complete ({summary.mode === 'replace' ? 'replaced all' : 'merged'})
          </div>
          <ul className="space-y-0.5 font-mono text-xs">
            <li>{line('Templates', summary.templates)}</li>
            <li>{line('Sessions', summary.sessions)}</li>
            <li>{line('Exercises', summary.exercises)}</li>
            <li>{line('Feedback', summary.feedback)}</li>
          </ul>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Tip: cloud sync above is the main route between devices. The file export is the offline
        fallback and the thing to keep if you ever want a copy outside the cloud.
      </p>

      <div className="mt-6 border-t border-slate-800 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">App version</div>
            <div className="font-mono text-sm text-slate-300">{__APP_VERSION__}</div>
          </div>
          <button
            onClick={() => void checkForUpdate()}
            disabled={updateState === 'checking'}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 disabled:opacity-40 active:bg-slate-700"
          >
            {updateState === 'checking'
              ? 'Checking…'
              : updateState === 'found'
                ? 'Updating…'
                : updateState === 'current'
                  ? 'Up to date ✓'
                  : 'Check for update'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Compare this with the version on any other device. An installed app can lag a launch
          behind the website until its update is picked up.
        </p>
      </div>
    </div>
  );
}
