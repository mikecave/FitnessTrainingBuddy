import { describe, expect, it } from 'vitest';
import { describeOutstanding, isFullyLogged, sessionProgress } from './sessionProgress';
import type { LoggedSet, Session, SessionSection } from '../data/types';

function set(done: boolean): LoggedSet {
  return { target: { type: 'reps', reps: 8 }, load: { type: 'bw' }, done };
}

function sessionOf(sections: SessionSection[]): Session {
  return {
    id: 's1',
    userId: 'mike',
    templateId: 't1',
    date: '2026-09-04',
    startedAt: 0,
    status: 'active',
    sections,
    updatedAt: 0,
  };
}

const tracked = (sets: LoggedSet[], extra: Record<string, unknown> = {}): SessionSection => ({
  kind: 'primary',
  logging: 'tracked',
  groups: [{ members: [{ exerciseId: 'ex1', intensity: 7, restAfterSec: 60, sets, ...extra }] }],
});

describe('sessionProgress', () => {
  it('counts nothing outstanding when every set is done', () => {
    const p = sessionProgress(sessionOf([tracked([set(true), set(true)])]));
    expect(p).toEqual({ unloggedSets: 0, unloggedExercises: 0, uncheckedItems: 0 });
    expect(isFullyLogged(p)).toBe(true);
  });

  it('counts unlogged sets and the exercises they belong to', () => {
    const p = sessionProgress(
      sessionOf([
        {
          kind: 'primary',
          logging: 'tracked',
          groups: [
            {
              members: [
                { exerciseId: 'ex1', intensity: 7, restAfterSec: 60, sets: [set(true), set(false)] },
                { exerciseId: 'ex2', intensity: 7, restAfterSec: 60, sets: [set(false), set(false)] },
                { exerciseId: 'ex3', intensity: 7, restAfterSec: 60, sets: [set(true)] },
              ],
            },
          ],
        },
      ]),
    );
    expect(p.unloggedSets).toBe(3);
    expect(p.unloggedExercises).toBe(2);
    expect(isFullyLogged(p)).toBe(false);
  });

  it('treats a skipped exercise as a decision, not a hole', () => {
    const p = sessionProgress(sessionOf([tracked([set(false), set(false)], { skipped: true })]));
    expect(p.unloggedSets).toBe(0);
    expect(isFullyLogged(p)).toBe(true);
  });

  it('counts a loose member as one unticked checklist item, not as its sets', () => {
    const p = sessionProgress(
      sessionOf([
        {
          kind: 'warmup',
          logging: 'loose',
          groups: [
            {
              members: [
                { exerciseId: 'ex1', intensity: 7, restAfterSec: 0, sets: [set(false), set(false)] },
                { exerciseId: 'ex2', intensity: 7, restAfterSec: 0, sets: [set(true)] },
              ],
            },
          ],
        },
      ]),
    );
    expect(p).toEqual({ unloggedSets: 0, unloggedExercises: 0, uncheckedItems: 1 });
    expect(isFullyLogged(p)).toBe(false);
  });

  it('describes what is outstanding, pluralised, tracked work first', () => {
    expect(describeOutstanding({ unloggedSets: 1, unloggedExercises: 1, uncheckedItems: 0 })).toBe(
      '1 set not logged across 1 exercise',
    );
    expect(describeOutstanding({ unloggedSets: 3, unloggedExercises: 2, uncheckedItems: 2 })).toBe(
      '3 sets not logged across 2 exercises · 2 checklist items unticked',
    );
    expect(describeOutstanding({ unloggedSets: 0, unloggedExercises: 0, uncheckedItems: 1 })).toBe(
      '1 checklist item unticked',
    );
  });
});
