import { describe, expect, it } from 'vitest';
import { describeChange, exercisesWithHistory, progressFor } from './progression';
import type { Exercise, LoggedSet, Session, SessionSection, WeekType } from '../data/types';

const kgSet = (kg: number, reps: number, extra: Partial<LoggedSet> = {}): LoggedSet => ({
  target: { type: 'reps', reps },
  load: { type: 'kg', kg },
  actualReps: reps,
  done: true,
  ...extra,
});

function session(id: string, date: string, sets: LoggedSet[], weekType?: WeekType, extra: SessionSection[] = []): Session {
  return {
    id,
    userId: 'mike',
    templateId: 't',
    date,
    startedAt: 0,
    status: 'done',
    ...(weekType ? { weekType } : {}),
    sections: [
      { kind: 'primary', logging: 'tracked', groups: [{ members: [{ exerciseId: 'bench', intensity: 8, restAfterSec: 90, sets }] }] },
      ...extra,
    ],
    updatedAt: 0,
  };
}

describe('progressFor', () => {
  it('charts the heaviest working set per workout, oldest first, ignoring warm-ups', () => {
    const p = progressFor(
      [
        session('b', '2026-09-08', [kgSet(40, 10, { warmup: true }), kgSet(30, 8), kgSet(32.5, 5)]),
        session('a', '2026-09-01', [kgSet(30, 8), kgSet(30, 6)]),
      ],
      'bench',
    );
    expect(p.metric).toBe('kg');
    expect(p.points.map((x) => [x.date, x.value, x.label])).toEqual([
      ['2026-09-01', 30, '30kg × 8'],
      ['2026-09-08', 32.5, '32.5kg × 5'],
    ]);
  });

  it('ignores unlogged sets and marks deload weeks', () => {
    const p = progressFor([session('a', '2026-09-01', [kgSet(25, 8), kgSet(50, 8, { done: false })], 'deload')], 'bench');
    expect(p.points).toEqual([{ sessionId: 'a', date: '2026-09-01', weekType: 'deload', value: 25, label: '25kg × 8', reps: 8 }]);
  });

  it('charts BW+kg as the added load, with plain BW as +0', () => {
    const bw: LoggedSet = { target: { type: 'reps', reps: 10 }, load: { type: 'bw' }, actualReps: 10, done: true };
    const plus: LoggedSet = { ...bw, load: { type: 'bw_plus_kg', kg: 10 }, actualReps: 4 };
    const p = progressFor([session('a', '2026-09-01', [bw]), session('b', '2026-09-08', [bw, plus])], 'bench');
    expect(p.points.map((x) => x.label)).toEqual(['BW × 10', 'BW+10kg × 4']);
  });

  it('charts reps for bodyweight-only work, and seconds for holds', () => {
    const bw = (r: number): LoggedSet => ({ target: { type: 'reps', reps: r }, load: { type: 'bw' }, actualReps: r, done: true });
    expect(progressFor([session('a', '2026-09-01', [bw(8), bw(12)])], 'bench').points[0].label).toBe('12 reps');
    const hold: LoggedSet = { target: { type: 'duration', seconds: 30 }, load: { type: 'bw' }, actualSeconds: 45, done: true };
    const p = progressFor([session('a', '2026-09-01', [hold])], 'bench');
    expect([p.metric, p.points[0].label]).toEqual(['seconds', '45s']);
  });
});

describe('exercisesWithHistory', () => {
  it('lists logged exercises, most recent first, skipping by-feel ticks', () => {
    const ex = (id: string, name: string) => [id, { id, name } as Exercise] as const;
    const exercises = new Map([ex('bench', 'Bench press'), ex('stretch', 'Stretch')]);
    const cooldown: SessionSection = {
      kind: 'cooldown',
      logging: 'loose',
      groups: [{ members: [{ exerciseId: 'stretch', intensity: 5, restAfterSec: 0, sets: [{ target: { type: 'loose' }, load: { type: 'bw' }, done: true }] }] }],
    };
    const list = exercisesWithHistory(
      [session('a', '2026-09-01', [kgSet(30, 8)], undefined, [cooldown]), session('b', '2026-09-08', [kgSet(30, 8)])],
      exercises,
    );
    expect(list.map((x) => [x.exercise.name, x.workouts, x.lastDate])).toEqual([['Bench press', 2, '2026-09-08']]);
  });
});

describe('describeChange', () => {
  it('reports load change, else rep change at the same weight, else no change', () => {
    const run = (a: LoggedSet[], b: LoggedSet[]) =>
      describeChange(progressFor([session('a', '2026-09-01', a), session('b', '2026-09-08', b)], 'bench'));
    expect(run([kgSet(27.5, 8)], [kgSet(30, 6)])).toBe('+2.5kg');
    expect(run([kgSet(27.5, 8)], [kgSet(27.5, 10)])).toBe('same weight, +2 reps');
    expect(run([kgSet(27.5, 8)], [kgSet(27.5, 8)])).toBe('no change');
  });
});
