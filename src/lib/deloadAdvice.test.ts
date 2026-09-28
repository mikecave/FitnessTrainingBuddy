import { describe, expect, it } from 'vitest';
import { deloadAdvice } from './deloadAdvice';
import type { LoggedSet, Session, WeekType } from '../data/types';

const set = (kg: number, reps: number): LoggedSet => ({
  target: { type: 'reps', reps },
  load: { type: 'kg', kg },
  actualReps: reps,
  done: true,
});

let n = 0;
function workout(date: string, lifts: Record<string, LoggedSet>, weekType: WeekType = 'build', extra: Partial<Session> = {}): Session {
  return {
    id: `s${n++}`,
    userId: 'mike',
    templateId: 't1',
    date,
    startedAt: 0,
    status: 'done',
    weekType,
    sections: [
      {
        kind: 'primary',
        logging: 'tracked',
        groups: Object.entries(lifts).map(([exerciseId, s]) => ({
          members: [{ exerciseId, intensity: 8, restAfterSec: 90, sets: [s] }],
        })),
      },
    ],
    updatedAt: 0,
    ...extra,
  };
}

const today = (extra: Partial<Session> = {}) => workout('2026-10-01', {}, 'build', { status: 'active', ...extra });

describe('deloadAdvice', () => {
  it('stays quiet while lifts are still going up', () => {
    const history = [
      workout('2026-09-01', { a: set(30, 8), b: set(50, 5) }),
      workout('2026-09-08', { a: set(32.5, 8), b: set(50, 6) }),
      workout('2026-09-15', { a: set(35, 8), b: set(52.5, 5) }),
    ];
    expect(deloadAdvice(today(), history, ['a', 'b']).suggest).toBe(false);
  });

  it('suggests a deload when half the lifts have stalled over 3 workouts', () => {
    const history = [
      workout('2026-09-01', { a: set(30, 8), b: set(50, 5) }),
      workout('2026-09-08', { a: set(30, 8), b: set(52.5, 5) }),
      workout('2026-09-15', { a: set(30, 7), b: set(55, 5) }),
    ];
    const advice = deloadAdvice(today(), history, ['a', 'b']);
    expect(advice.suggest).toBe(true);
    expect(advice.reasons).toEqual(["1 of 2 lifts haven't gone up in their last 3 workouts"]);
  });

  it('counts more reps at the same weight as progress', () => {
    const history = [
      workout('2026-09-01', { a: set(30, 6) }),
      workout('2026-09-08', { a: set(30, 7) }),
      workout('2026-09-15', { a: set(30, 8) }),
    ];
    expect(deloadAdvice(today(), history, ['a']).suggest).toBe(false);
  });

  it('only looks at the cycle since the last deload', () => {
    const history = [
      workout('2026-08-01', { a: set(30, 8) }),
      workout('2026-08-08', { a: set(30, 8) }),
      workout('2026-08-15', { a: set(25, 8) }, 'deload'),
      workout('2026-08-22', { a: set(30, 8) }),
      workout('2026-08-29', { a: set(32.5, 8) }),
    ];
    const advice = deloadAdvice(today(), history, ['a']);
    expect([advice.suggest, advice.sinceDeload]).toEqual([false, 2]);
  });

  it('flags a long cycle and high starting fatigue', () => {
    const history = Array.from({ length: 6 }, (_, i) => workout(`2026-09-0${i + 1}`, { a: set(30 + i, 8) }));
    const advice = deloadAdvice(today({ startingFatigue: 8 }), history, ['a']);
    expect(advice.reasons).toEqual(['6 workouts of this since the last deload', 'starting fatigue is 8/10']);
  });

  it('ignores other templates', () => {
    const other = { templateId: 't2' };
    const history = [
      workout('2026-09-01', { a: set(30, 8) }, 'build', other),
      workout('2026-09-08', { a: set(30, 8) }, 'build', other),
      workout('2026-09-15', { a: set(30, 8) }, 'build', other),
    ];
    expect(deloadAdvice(today(), history, ['a']).suggest).toBe(false);
  });
});
