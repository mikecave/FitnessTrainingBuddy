// Progression per exercise, across finished workouts (Milestone 3 charts).
//
// One point per workout: the TOP SET — the heaviest working set that was
// actually logged. Warm-up (w) sets are excluded, since a ramp-in at 22kg says
// nothing about progress on a 27.5kg lift. Reps come from that same set, so a
// point reads "27.5kg × 6", and a heavier weight for fewer reps still counts
// as the top set.
//
// What gets charted depends on how the exercise is loaded:
//   - any logged kg (plain kg, or the "+kg" of BW+kg) -> the load
//   - otherwise, timed holds                           -> the longest hold
//   - otherwise (bodyweight, band)                     -> the most reps
// Mixed history (BW sets one week, BW+10kg the next) charts BW as +0kg, which
// is what it is.

import type { Exercise, LoggedSet, Session, WeekType } from '../data/types';
import { isByFeel } from './logging';

export type Metric = 'kg' | 'seconds' | 'reps';

export interface ProgressPoint {
  sessionId: string;
  date: string;
  weekType: WeekType;
  /** The charted number, in the exercise's metric. */
  value: number;
  /** "27.5kg × 6", "BW+10kg × 4", "45s", "12 reps". */
  label: string;
  /** Reps on the top set, for load-charted exercises: progress at the same
   *  weight shows up here rather than in `value`. */
  reps?: number;
}

export interface ExerciseProgress {
  metric: Metric;
  points: ProgressPoint[];
}

function addedKg(set: LoggedSet): number | undefined {
  if (set.load.type === 'kg' || set.load.type === 'bw_plus_kg') return set.load.kg;
  if (set.load.type === 'bw') return 0;
  return undefined;
}

function reps(set: LoggedSet): number | undefined {
  return set.actualReps ?? (set.target.type === 'reps' ? set.target.reps : undefined);
}

function seconds(set: LoggedSet): number | undefined {
  return set.actualSeconds ?? (set.target.type === 'duration' ? set.target.seconds : undefined);
}

function loadLabel(set: LoggedSet): string {
  if (set.load.type === 'kg') return `${set.load.kg}kg`;
  if (set.load.type === 'bw_plus_kg') return `BW+${set.load.kg}kg`;
  if (set.load.type === 'bw') return 'BW';
  return set.load.type;
}

/** The working sets actually lifted for this exercise in one workout. */
function workingSets(session: Session, exerciseId: string): LoggedSet[] {
  return session.sections.flatMap((section) =>
    section.groups.flatMap((g) =>
      g.members
        .filter((m) => m.exerciseId === exerciseId && !m.skipped && !isByFeel(section, m))
        .flatMap((m) => m.sets.filter((s) => s.done && !s.warmup)),
    ),
  );
}

function chronological(sessions: Session[]): Session[] {
  return sessions
    .filter((s) => s.status === 'done')
    .sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt);
}

export function progressFor(sessions: Session[], exerciseId: string): ExerciseProgress {
  const perSession = chronological(sessions)
    .map((session) => ({ session, sets: workingSets(session, exerciseId) }))
    .filter((x) => x.sets.length > 0);

  const all = perSession.flatMap((x) => x.sets);
  const metric: Metric = all.some((s) => (addedKg(s) ?? 0) > 0)
    ? 'kg'
    : all.some((s) => seconds(s) !== undefined)
      ? 'seconds'
      : 'reps';

  const points: ProgressPoint[] = [];
  for (const { session, sets } of perSession) {
    let best: { value: number; tie: number; set: LoggedSet } | undefined;
    for (const set of sets) {
      const value =
        metric === 'kg' ? addedKg(set) : metric === 'seconds' ? seconds(set) : reps(set);
      if (value === undefined) continue;
      // At equal load, the set with more reps is the better top set.
      const tie = metric === 'kg' ? (reps(set) ?? 0) : 0;
      if (!best || value > best.value || (value === best.value && tie > best.tie)) {
        best = { value, tie, set };
      }
    }
    if (!best) continue;
    const r = reps(best.set);
    const label =
      metric === 'kg'
        ? `${loadLabel(best.set)}${r !== undefined ? ` × ${r}` : ''}`
        : metric === 'seconds'
          ? `${best.value}s`
          : `${best.value} reps`;
    points.push({
      sessionId: session.id,
      date: session.date,
      weekType: session.weekType ?? 'build',
      value: best.value,
      label,
      ...(metric === 'kg' && r !== undefined ? { reps: r } : {}),
    });
  }
  return { metric, points };
}

export interface ExerciseSummary {
  exercise: Exercise;
  workouts: number;
  lastDate: string;
}

/** "+2.5kg", or "same weight, +2 reps", or "no change" — first vs latest. */
export function describeChange(progress: ExerciseProgress): string {
  const { points, metric } = progress;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || first === last) return '';
  const unit = metric === 'kg' ? 'kg' : metric === 'seconds' ? 's' : ' reps';
  const diff = Math.round((last.value - first.value) * 10) / 10;
  if (diff !== 0) return `${diff > 0 ? '+' : ''}${diff}${unit}`;
  const repDiff = (last.reps ?? 0) - (first.reps ?? 0);
  if (metric === 'kg' && repDiff !== 0) {
    return `same weight, ${repDiff > 0 ? '+' : ''}${repDiff} rep${Math.abs(repDiff) === 1 ? '' : 's'}`;
  }
  return 'no change';
}

/** Every exercise with at least one logged working set, most recently trained
 *  first — the list to pick a chart from. */
export function exercisesWithHistory(
  sessions: Session[],
  exercises: Map<string, Exercise>,
): ExerciseSummary[] {
  const seen = new Map<string, { workouts: Set<string>; lastDate: string }>();
  for (const session of chronological(sessions)) {
    for (const section of session.sections) {
      for (const group of section.groups) {
        for (const m of group.members) {
          // By-feel ticks have no numbers to chart.
          if (m.skipped || isByFeel(section, m) || !m.sets.some((s) => s.done && !s.warmup)) continue;
          const entry = seen.get(m.exerciseId) ?? { workouts: new Set(), lastDate: session.date };
          entry.workouts.add(session.id);
          entry.lastDate = session.date;
          seen.set(m.exerciseId, entry);
        }
      }
    }
  }
  return [...seen.entries()]
    .flatMap(([id, e]) => {
      const exercise = exercises.get(id);
      return exercise ? [{ exercise, workouts: e.workouts.size, lastDate: e.lastDate }] : [];
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.exercise.name.localeCompare(b.exercise.name));
}
