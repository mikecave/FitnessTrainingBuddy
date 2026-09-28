import { useEffect, useMemo, useState } from 'react';
import { exerciseMap, listDoneSessions } from '../data/repo';
import type { Exercise, Session } from '../data/types';
import {
  describeChange,
  exercisesWithHistory,
  progressFor,
  type ExerciseProgress,
  type Metric,
} from '../lib/progression';
import { parseLocalDate } from '../lib/weeks';

const UNIT: Record<Metric, string> = { kg: 'kg', seconds: 's', reps: ' reps' };

function shortDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Deload weeks are drawn amber: a dip there is the plan, not a regression. */
function pointColour(weekType: string): string {
  if (weekType === 'deload') return '#fbbf24';
  if (weekType === 'peak') return '#c4b5fd';
  return '#38bdf8';
}

/** A plain SVG line chart — no charting library. One exercise's top set per
 *  workout, oldest on the left. */
function ProgressChart({ progress }: { progress: ExerciseProgress }) {
  const { points, metric } = progress;
  const W = 320;
  const H = 170;
  const pad = { left: 44, right: 12, top: 12, bottom: 24 };
  const values = points.map((p) => p.value);
  // Not zoomed to the data: fitted tight, a 0.5kg wobble on 27.5kg filled the
  // whole height and read like a big swing. The axis runs from 75% of the
  // lowest point, so a change looks as big as it is relative to the weight.
  const max = Math.max(...values);
  const lo = Math.floor(Math.min(...values) * 0.75);
  const hi = Math.max(max * 1.05, lo + 1);

  const x = (i: number) =>
    points.length === 1
      ? (pad.left + W - pad.right) / 2
      : pad.left + (i / (points.length - 1)) * (W - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - lo) / (hi - lo)) * (H - pad.top - pad.bottom);
  const fmt = (v: number) => `${Math.round(v * 10) / 10}${UNIT[metric]}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Progress chart">
      {[hi, (hi + lo) / 2, lo].map((v, i) => (
        <g key={i}>
          <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} stroke="#1e293b" />
          <text x={pad.left - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#64748b">
            {fmt(v)}
          </text>
        </g>
      ))}
      <polyline
        points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
        fill="none"
        stroke="#38bdf8"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle key={p.sessionId} cx={x(i)} cy={y(p.value)} r="4" fill={pointColour(p.weekType)} />
      ))}
      <text x={x(0)} y={H - 6} textAnchor={points.length === 1 ? 'middle' : 'start'} fontSize="10" fill="#64748b">
        {shortDate(points[0].date)}
      </text>
      {points.length > 1 && (
        <text x={x(points.length - 1)} y={H - 6} textAnchor="end" fontSize="10" fill="#64748b">
          {shortDate(points[points.length - 1].date)}
        </text>
      )}
    </svg>
  );
}

function ExerciseDetail({
  exercise,
  sessions,
  onBack,
  onOpenSession,
}: {
  exercise: Exercise;
  sessions: Session[];
  onBack: () => void;
  onOpenSession: (id: string) => void;
}) {
  const progress = useMemo(() => progressFor(sessions, exercise.id), [sessions, exercise.id]);
  const { points, metric } = progress;
  const first = points[0];
  const last = points[points.length - 1];
  const change = describeChange(progress);
  const up = change.startsWith('+') || change.includes(', +');
  const down = change.startsWith('-') || change.includes(', -');

  if (!last) {
    return (
      <div>
        <button onClick={onBack} className="mb-4 text-sm text-sky-400">
          ← Progress
        </button>
        <h1 className="mb-1 text-2xl font-bold">{exercise.name}</h1>
        <p className="text-sm text-slate-400">No logged numbers to chart for this one yet.</p>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-sky-400">
        ← Progress
      </button>
      <h1 className="mb-1 text-2xl font-bold">{exercise.name}</h1>
      <p className="mb-4 text-sm text-slate-400">
        Top set now <span className="font-semibold text-slate-200">{last.label}</span>
        {points.length > 1 && (
          <>
            {' · '}
            <span className={up ? 'text-emerald-400' : down ? 'text-amber-300' : ''}>{change}</span>{' '}
            since {shortDate(first.date)}
          </>
        )}
      </p>

      <div className="rounded-xl bg-slate-900 p-3">
        <ProgressChart progress={progress} />
        <div className="mt-1 flex gap-4 text-[11px] text-slate-500">
          <span>
            <span className="text-sky-400">●</span> build
          </span>
          <span>
            <span className="text-violet-300">●</span> peak
          </span>
          <span>
            <span className="text-amber-400">●</span> deload
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Heaviest working set each workout
        {metric === 'kg' ? '' : metric === 'seconds' ? ' (longest hold)' : ' (most reps)'} — warm-up
        sets not counted.
      </p>

      <ul className="mt-4 flex flex-col gap-1">
        {[...points].reverse().map((p) => (
          <li key={p.sessionId}>
            <button
              onClick={() => onOpenSession(p.sessionId)}
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-slate-900 px-3 py-2 text-left text-sm active:bg-slate-800"
            >
              <span className="text-slate-400">{shortDate(p.date)}</span>
              <span className="flex items-center gap-2">
                {p.weekType !== 'build' && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      p.weekType === 'deload'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-violet-500/20 text-violet-300'
                    }`}
                  >
                    {p.weekType}
                  </span>
                )}
                <span className="font-medium text-slate-200">{p.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Progression charts (Milestone 3): pick an exercise, see its top set over time. */
export default function Progress({
  exerciseId,
  onSelect,
  onBack,
  onOpenSession,
}: {
  exerciseId?: string;
  onSelect: (exerciseId: string | undefined) => void;
  onBack: () => void;
  onOpenSession: (id: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [exercises, setExercises] = useState<Map<string, Exercise>>(new Map());
  const [filter, setFilter] = useState('');

  useEffect(() => {
    listDoneSessions().then(setSessions);
    exerciseMap().then(setExercises);
  }, []);

  const list = useMemo(
    () => (sessions ? exercisesWithHistory(sessions, exercises) : []),
    [sessions, exercises],
  );

  if (!sessions) return null;

  const selected = exerciseId ? exercises.get(exerciseId) : undefined;
  if (selected) {
    return (
      <ExerciseDetail
        exercise={selected}
        sessions={sessions}
        onBack={() => onSelect(undefined)}
        onOpenSession={onOpenSession}
      />
    );
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle ? list.filter((x) => x.exercise.name.toLowerCase().includes(needle)) : list;

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-sky-400">
        ← History
      </button>
      <h1 className="mb-1 text-2xl font-bold">Progress</h1>
      <p className="mb-4 text-sm text-slate-400">
        {list.length === 0
          ? 'Finish a workout with logged sets and its exercises appear here.'
          : 'Pick an exercise to see its top set over time.'}
      </p>
      {list.length > 6 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find an exercise…"
          aria-label="Find an exercise"
          className="mb-3 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500"
        />
      )}
      <ul className="flex flex-col gap-1">
        {shown.map(({ exercise, workouts, lastDate }) => (
          <li key={exercise.id}>
            <button
              onClick={() => onSelect(exercise.id)}
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-slate-900 px-3 py-3 text-left active:bg-slate-800"
            >
              <span className="min-w-0 truncate font-medium">{exercise.name}</span>
              <span className="shrink-0 text-xs text-slate-500">
                {workouts}× · last {shortDate(lastDate)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
