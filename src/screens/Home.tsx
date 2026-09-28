import { useEffect, useState } from 'react';
import {
  createTemplate,
  getActiveSession,
  listDoneSessions,
  listTemplates,
  startSession,
} from '../data/repo';
import type { Session, Template, TemplateGroup } from '../data/types';
import { GROUPS, daysAgo, dueGroup, groupOf, lastDoneByTemplate } from '../lib/templateGroups';
import { getLastSyncAt, getLastSyncError, isSyncConfigured } from '../data/sync';
import { RotationLockButton } from '../components/RotationLockButton';
import { NumberField } from '../components/NumberField';

function AddWorkoutForm({
  templates,
  group,
  onCancel,
  onCreated,
}: {
  templates: Template[];
  /** The tab it was added from, which is where it should appear. */
  group: TemplateGroup;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'gym' | 'micro'>(group === 'rest' ? 'micro' : 'gym');
  const [timeCap, setTimeCap] = useState(30);
  const [copyFrom, setCopyFrom] = useState('');

  return (
    <div className="rounded-2xl bg-slate-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold">Add workout</span>
        <button onClick={onCancel} className="text-sm text-slate-400">
          Cancel
        </button>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Workout name"
        className="mb-3 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500"
      />

      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setKind('gym')}
          className={`rounded-lg px-4 py-2 text-xs font-medium ${
            kind === 'gym' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Gym
        </button>
        <button
          onClick={() => setKind('micro')}
          className={`rounded-lg px-4 py-2 text-xs font-medium ${
            kind === 'micro' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Micro
        </button>
        {kind === 'micro' && (
          <>
            <NumberField
              value={String(timeCap)}
              onChange={(v) => setTimeCap(v === '' ? 15 : Number(v))}
              label="Time cap minutes"
              step={5}
              min={5}
            />
            <span className="text-xs text-slate-500">min cap</span>
          </>
        )}
      </div>

      <div className="mb-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Start from</div>
        <select
          value={copyFrom}
          onChange={(e) => setCopyFrom(e.target.value)}
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="">Blank workout</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              Copy of {t.name}
            </option>
          ))}
        </select>
      </div>

      <button
        disabled={!name.trim()}
        onClick={async () => {
          await createTemplate({
            name: name.trim(),
            kind,
            group,
            ...(kind === 'micro' ? { timeCapMin: timeCap } : {}),
            ...(copyFrom ? { copyFromTemplateId: copyFrom } : {}),
          });
          onCreated();
        }}
        className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold disabled:opacity-40 active:bg-sky-500"
      >
        Create workout
      </button>
    </div>
  );
}

/** The tab the user last picked, kept for as long as the app is open so a trip
 *  to View/Edit and back doesn't snap them to the "due" tab. A fresh launch
 *  starts on the due one again. */
let chosenTab: TemplateGroup | null = null;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "4m ago" / "2h ago" / "3d ago" — enough to spot a device that has drifted. */
function relativeTime(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function Home({
  onOpenTemplate,
  onEditTemplate,
  onSessionStarted,
  onOpenHistory,
  onOpenBackup,
  onOpenFeedback,
  onLogActivity,
}: {
  onOpenTemplate: (id: string) => void;
  onEditTemplate: (id: string) => void;
  onSessionStarted: () => void;
  onOpenHistory: () => void;
  onOpenBackup: () => void;
  onOpenFeedback: () => void;
  onLogActivity: () => void;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [active, setActive] = useState<Session | null | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [lastDone, setLastDone] = useState<Map<string, string>>(new Map());
  const [tab, setTab] = useState<TemplateGroup | null>(chosenTab);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const syncing = isSyncConfigured();
  const lastSync = getLastSyncAt();
  const syncError = getLastSyncError();

  useEffect(() => {
    listTemplates().then((all) => setTemplates(all.filter((t) => t.kind !== 'cardio')));
    getActiveSession().then((s) => setActive(s ?? null));
    listDoneSessions().then((all) => setLastDone(lastDoneByTemplate(all)));
  }, []);

  const currentTab = tab ?? (templates ? dueGroup(templates, lastDone) : 'upper');
  const due = templates ? dueGroup(templates, lastDone) : null;
  const today = todayLocal();
  const shown = (templates ?? [])
    .filter((t) => groupOf(t) === currentTab)
    // Most recently done first, so the usual one leads (Push/Pull above its
    // occasional Home variant); which GROUP is due is the tab's job.
    .sort((a, b) => (lastDone.get(b.id) ?? '').localeCompare(lastDone.get(a.id) ?? '') || a.name.localeCompare(b.name));

  function pickTab(g: TemplateGroup) {
    chosenTab = g;
    setTab(g);
    setMenuFor(null);
    setAdding(false);
  }

  const activeTemplateName = active
    ? templates?.find((t) => t.id === active.templateId)?.name
    : undefined;

  async function handleStart(templateId: string) {
    await startSession(templateId);
    onSessionStarted();
  }

  async function handleDuplicate(t: Template) {
    await createTemplate({
      name: `${t.name} (copy)`,
      kind: t.kind,
      ...(t.timeCapMin ? { timeCapMin: t.timeCapMin } : {}),
      group: groupOf(t),
      copyFromTemplateId: t.id,
    });
    listTemplates().then((all) => setTemplates(all.filter((t) => t.kind !== 'cardio')));
  }

  return (
    <div>
      {/* One line: on a phone the old three-line title and subtitle took a
          fifth of the screen before the first workout. */}
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">FitBuddy</h1>
        <div className="flex shrink-0 gap-2">
          <RotationLockButton />
          <button
            onClick={onOpenHistory}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-300 active:bg-slate-700"
          >
            History
          </button>
          <button
            onClick={onOpenBackup}
            aria-label="Backup and sync"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-300 active:bg-slate-700"
          >
            Backup
          </button>
          <button
            onClick={onOpenFeedback}
            aria-label="App feedback"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-300 active:bg-slate-700"
          >
            ✎
          </button>
        </div>
      </header>

      {!syncing ? (
        <button
          onClick={onOpenBackup}
          className="mb-4 w-full rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-left"
        >
          <div className="text-sm font-semibold text-amber-200">This device isn't syncing</div>
          <div className="mt-0.5 text-xs text-amber-200/80">
            Its workouts stay here and won't appear on your other devices. Tap to add the sync key.
          </div>
        </button>
      ) : syncError ? (
        <button
          onClick={onOpenBackup}
          className="mb-4 w-full rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-left"
        >
          <div className="text-sm font-semibold text-red-200">Sync failed</div>
          <div className="mt-0.5 text-xs text-red-200/80">{syncError} — tap to retry.</div>
        </button>
      ) : (
        <p className="mb-4 text-xs text-slate-500">
          {lastSync ? `Synced ${relativeTime(lastSync)}` : 'Syncing…'}
        </p>
      )}

      {active && (
        <button
          onClick={onSessionStarted}
          className="mb-6 w-full rounded-2xl bg-emerald-600 p-5 text-left shadow transition active:scale-[0.98] active:bg-emerald-500"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-100">
            Workout in progress
          </div>
          <div className="mt-1 text-lg font-bold">Resume {activeTemplateName ?? 'workout'}</div>
        </button>
      )}

      <div
        role="tablist"
        aria-label="Workout groups"
        className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-900 p-1"
      >
        {GROUPS.map((g) => {
          const selected = g.value === currentTab;
          const count = (templates ?? []).filter((t) => groupOf(t) === g.value).length;
          return (
            <button
              key={g.value}
              role="tab"
              aria-selected={selected}
              onClick={() => pickTab(g.value)}
              className={`relative rounded-lg py-2 text-sm font-semibold ${
                selected ? 'bg-sky-600 text-white' : 'text-slate-400 active:bg-slate-800'
              }`}
            >
              {g.label}
              <span className={`ml-1 text-xs ${selected ? 'text-sky-100' : 'text-slate-600'}`}>{count}</span>
              {g.value === due && (
                <span
                  aria-label="due next"
                  className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400"
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((t) => (
          <div key={t.id} className="rounded-xl bg-slate-800">
            <div className="flex items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{t.name}</div>
                <div className="text-xs text-slate-400">
                  {daysAgo(lastDone.get(t.id), today)}
                  {t.kind === 'micro' && t.timeCapMin ? ` · ${t.timeCapMin} min` : ''}
                  {!t.sections.some((s) => s.groups.length > 0) && (
                    <span className="text-amber-300/80"> · empty — Edit to add exercises</span>
                  )}
                </div>
              </div>
              {!active && (
                <button
                  onClick={() => handleStart(t.id)}
                  className="shrink-0 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold active:bg-sky-500"
                >
                  Start
                </button>
              )}
              <button
                onClick={() => setMenuFor(menuFor === t.id ? null : t.id)}
                aria-label={`More for ${t.name}`}
                aria-expanded={menuFor === t.id}
                className="shrink-0 rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold active:bg-slate-600"
              >
                ⋯
              </button>
            </div>
            {menuFor === t.id && (
              <div className="flex gap-2 border-t border-slate-700/60 px-4 py-2">
                {[
                  { label: 'Edit', onClick: () => onEditTemplate(t.id) },
                  { label: 'View', onClick: () => onOpenTemplate(t.id) },
                  { label: 'Copy', onClick: () => void handleDuplicate(t) },
                ].map((b) => (
                  <button
                    key={b.label}
                    onClick={b.onClick}
                    aria-label={`${b.label} ${t.name}`}
                    className="flex-1 rounded-lg bg-slate-700 py-2 text-sm font-semibold active:bg-slate-600"
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {templates && shown.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-500">Nothing here yet.</p>
        )}

        {templates &&
          (adding ? (
            <AddWorkoutForm
              templates={templates}
              group={currentTab}
              onCancel={() => setAdding(false)}
              onCreated={() => {
                setAdding(false);
                listTemplates().then((all) => setTemplates(all.filter((t) => t.kind !== 'cardio')));
              }}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="rounded-2xl border border-dashed border-slate-700 py-4 text-sm font-medium text-slate-400 active:bg-slate-900"
            >
              ＋ Add workout
            </button>
          ))}

        <button
          onClick={onLogActivity}
          className="rounded-2xl border border-dashed border-slate-700 py-4 text-sm font-medium text-slate-400 active:bg-slate-900"
        >
          ＋ Log cardio / yoga / other
        </button>
      </div>
    </div>
  );
}
