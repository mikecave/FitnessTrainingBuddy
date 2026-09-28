import { useEffect, useState } from 'react';
import { createExercise, listActivities, logActivitySession } from '../data/repo';
import { NumberField } from '../components/NumberField';
import { Stepper } from '../components/Stepper';
import type { Exercise } from '../data/types';

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Log a whole-session activity — cardio, yoga, stretching or anything else
 *  recorded as one thing for a length of time at an intensity.
 *
 *  Saved complete rather than opened as a live workout: these are nearly always
 *  recorded after the fact, so there is nothing to tick along with. The date
 *  defaults to today but accepts any past day (F10). */
export default function LogActivity({ onBack, onLogged }: { onBack: () => void; onLogged: () => void }) {
  const [activities, setActivities] = useState<Exercise[] | null>(null);
  const [activityId, setActivityId] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [duration, setDuration] = useState('30');
  const [intensity, setIntensity] = useState(6);
  const [avgHr, setAvgHr] = useState('');
  const [maxHr, setMaxHr] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listActivities().then((list) => {
      setActivities(list);
      setActivityId((current) => current || (list[0]?.id ?? ''));
    });
  }, []);

  async function addActivity() {
    const name = newName.trim();
    if (!name) return;
    const created = await createExercise({ name, category: 'cardio', unilateral: false });
    const list = await listActivities();
    setActivities(list);
    setActivityId(created.id);
    setNewName('');
    setAdding(false);
  }

  async function save() {
    setError(null);
    const mins = Number(duration);
    if (!activityId || !Number.isFinite(mins) || mins <= 0) {
      setError('Pick an activity and a duration.');
      return;
    }
    setSaving(true);
    try {
      await logActivitySession({
        activityId,
        date,
        durationMin: mins,
        intensity,
        ...(Number(avgHr) > 0 ? { avgHeartRate: Number(avgHr) } : {}),
        ...(Number(maxHr) > 0 ? { maxHeartRate: Number(maxHr) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onLogged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  if (activities === null) return null;

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-sky-400">
        ← Home
      </button>
      <h1 className="mb-1 text-2xl font-bold">Log cardio / yoga / other</h1>
      <p className="mb-6 text-sm text-slate-400">
        One activity, a duration and an intensity — saved straight to history with no workout to
        tick through.
      </p>

      <div className="mb-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Activity</div>
        <div className="flex flex-wrap gap-2">
          {activities.map((a) => (
            <button
              key={a.id}
              onClick={() => setActivityId(a.id)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                a.id === activityId ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {a.name}
            </button>
          ))}
          {adding ? (
            <span className="flex w-full items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addActivity();
                  if (e.key === 'Escape') setAdding(false);
                }}
                placeholder="New activity"
                aria-label="New activity name"
                className="min-w-0 flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500"
              />
              <button
                onClick={() => void addActivity()}
                className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold"
              >
                Add
              </button>
            </span>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-sm text-slate-400"
            >
              ＋ other
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-500">Date</span>
        <input
          type="date"
          value={date}
          max={todayLocal()}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm"
        />
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-500">Minutes</span>
        <NumberField value={duration} onChange={setDuration} label="Minutes" step={5} min={1} />
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-500">Intensity</span>
        <Stepper value={intensity} onChange={setIntensity} />
      </div>

      {/* Optional: a watch may not have given a reading, and logging must never
          wait on a number the user does not have. */}
      <div className="mb-4 rounded-xl bg-slate-900 p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
          Heart rate <span className="normal-case text-slate-600">— optional</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-400">Average</span>
          <NumberField
            value={avgHr}
            onChange={setAvgHr}
            label="Average heart rate"
            step={5}
            placeholder="bpm"
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-400">Max</span>
          <NumberField
            value={maxHr}
            onChange={setMaxHr}
            label="Max heart rate"
            step={5}
            placeholder="bpm"
          />
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Notes (optional)"
        aria-label="Notes"
        className="mb-4 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500"
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold disabled:opacity-40 active:bg-emerald-500"
      >
        {saving ? 'Saving…' : 'Save session'}
      </button>
    </div>
  );
}
