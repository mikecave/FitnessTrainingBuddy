import { describe, expect, it } from 'vitest';
import {
  addMemberToSessionGroup,
  addRound,
  findGroupOf,
  joinGroups,
  loggedSetCount,
  removeMemberAt,
  splitMember,
  withExtraSet,
  withoutLastSet,
} from './sessionEdits';
import type { LoggedSet, Session, SessionExercise } from '../data/types';

function set(done: boolean): LoggedSet {
  return { target: { type: 'reps', reps: 8 }, load: { type: 'bw' }, done };
}

function member(exerciseId: string, sets: LoggedSet[] = [set(false)]): SessionExercise {
  return { exerciseId, intensity: 7, restAfterSec: 60, sets };
}

function sessionWith(groups: SessionExercise[][]): Session {
  return {
    id: 's1',
    userId: 'mike',
    templateId: 't1',
    date: '2026-09-06',
    startedAt: 0,
    status: 'active',
    sections: [
      { kind: 'warmup', logging: 'loose', description: 'Joint rotations', groups: [] },
      { kind: 'primary', logging: 'tracked', groups: groups.map((members) => ({ members })) },
    ],
    updatedAt: 0,
  };
}

const ids = (s: Session) =>
  s.sections[1].groups.map((g) => g.members.map((m) => m.exerciseId));

describe('removeMemberAt', () => {
  it('removes just the targeted exercise', () => {
    const s = sessionWith([[member('a')], [member('b')], [member('c')]]);
    expect(ids(removeMemberAt(s, { si: 1, gi: 1, mi: 0 }))).toEqual([['a'], ['c']]);
  });

  it('collapses a superset to straight sets when one member goes', () => {
    const s = sessionWith([[member('a'), member('b')]]);
    const out = removeMemberAt(s, { si: 1, gi: 0, mi: 1 });
    expect(ids(out)).toEqual([['a']]);
  });

  it('drops the group once it is empty', () => {
    const s = sessionWith([[member('a')], [member('b')]]);
    expect(ids(removeMemberAt(s, { si: 1, gi: 0, mi: 0 }))).toEqual([['b']]);
  });

  it('keeps the section even when its last exercise goes', () => {
    const s = sessionWith([[member('a')]]);
    const out = removeMemberAt(s, { si: 1, gi: 0, mi: 0 });
    expect(out.sections).toHaveLength(2);
    expect(out.sections[1].kind).toBe('primary');
    expect(out.sections[1].groups).toEqual([]);
  });

  it('leaves other sections untouched', () => {
    const s = sessionWith([[member('a')]]);
    const out = removeMemberAt(s, { si: 1, gi: 0, mi: 0 });
    expect(out.sections[0]).toEqual(s.sections[0]);
  });

  it('does not mutate the session it was given', () => {
    const s = sessionWith([[member('a')], [member('b')]]);
    removeMemberAt(s, { si: 1, gi: 0, mi: 0 });
    expect(ids(s)).toEqual([['a'], ['b']]);
  });
});

describe('loggedSetCount', () => {
  it('counts only sets actually marked done', () => {
    const s = sessionWith([[member('a', [set(true), set(true), set(false)])]]);
    expect(loggedSetCount(s, { si: 1, gi: 0, mi: 0 })).toBe(2);
  });

  it('is 0 for a path that no longer exists', () => {
    const s = sessionWith([[member('a')]]);
    expect(loggedSetCount(s, { si: 1, gi: 9, mi: 0 })).toBe(0);
  });
});

describe('superset edits', () => {
  it('joins two straight sets, keeping the destination in place', () => {
    const s = sessionWith([[member('a')], [member('b')], [member('c')]]);
    expect(ids(joinGroups(s, { si: 1, gi: 2 }, { si: 1, gi: 0 }))).toEqual([['a', 'c'], ['b']]);
  });

  it('joins into a superset below it, and merges two supersets', () => {
    const s = sessionWith([[member('a')], [member('b'), member('c')]]);
    expect(ids(joinGroups(s, { si: 1, gi: 0 }, { si: 1, gi: 1 }))).toEqual([['b', 'c', 'a']]);
    const two = sessionWith([[member('a'), member('b')], [member('c'), member('d')]]);
    expect(ids(joinGroups(two, { si: 1, gi: 1 }, { si: 1, gi: 0 }))).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('keeps logged sets when joining', () => {
    const s = sessionWith([[member('a')], [member('b', [set(true), set(false)])]]);
    const out = joinGroups(s, { si: 1, gi: 1 }, { si: 1, gi: 0 });
    expect(out.sections[1].groups[0].members[1].sets.map((x) => x.done)).toEqual([true, false]);
  });

  it('splits a member out to just below its superset', () => {
    const s = sessionWith([[member('a'), member('b'), member('c')], [member('d')]]);
    expect(ids(splitMember(s, { si: 1, gi: 0, mi: 1 }))).toEqual([['a', 'c'], ['b'], ['d']]);
    const straight = sessionWith([[member('a')]]);
    expect(splitMember(straight, { si: 1, gi: 0, mi: 0 })).toBe(straight);
  });

  it('adds a round: one set per exercise, a pair for sided work, none for skipped', () => {
    const sided = member('b', [
      { ...set(true), side: 'L' },
      { ...set(true), side: 'R' },
    ]);
    const s = sessionWith([[member('a'), sided, { ...member('c'), skipped: true }]]);
    const out = addRound(s, { si: 1, gi: 0 });
    const [a, b, c] = out.sections[1].groups[0].members;
    expect(a.sets).toHaveLength(2);
    expect(b.sets.map((x) => [x.side, x.done])).toEqual([
      ['L', true],
      ['R', true],
      ['L', false],
      ['R', false],
    ]);
    expect(c.sets).toHaveLength(1);
  });

  it('finds a group by an exercise it holds', () => {
    const s = sessionWith([[member('a')], [member('b'), member('c')]]);
    expect(findGroupOf(s, 'c')).toEqual({ si: 1, gi: 1 });
    expect(findGroupOf(s, 'zz')).toBeNull();
  });

  it('adds an exercise straight into a group', () => {
    const s = sessionWith([[member('a')]]);
    expect(ids(addMemberToSessionGroup(s, { si: 1, gi: 0 }, member('n')))).toEqual([['a', 'n']]);
  });
});

describe('removing and re-adding sets (F9)', () => {
  const kg = (n: number): LoggedSet => ({
    target: { type: 'reps', reps: n },
    load: { type: 'kg', kg: n * 10 },
    done: false,
  });

  it('deleting down to one and adding back restores each set in order', () => {
    let m = member('a', [kg(10), kg(8), kg(6)]);
    m = withoutLastSet(withoutLastSet(m));
    expect(m.sets).toEqual([kg(10)]);
    m = withExtraSet(withExtraSet(m));
    expect(m.sets).toEqual([kg(10), kg(8), kg(6)]);
    expect(m.removedSets).toBeUndefined();
  });

  it('falls back to copying the last set once nothing is left to restore', () => {
    const m = withExtraSet(member('a', [kg(10)]));
    expect(m.sets.map((s) => s.target)).toEqual([kg(10).target, kg(10).target]);
  });

  it('never removes the only set, and handles sided pairs together', () => {
    expect(withoutLastSet(member('a', [kg(5)])).sets).toHaveLength(1);
    const sided = member('b', [
      { ...kg(10), side: 'L' },
      { ...kg(10), side: 'R' },
      { ...kg(6), side: 'L' },
      { ...kg(7), side: 'R' },
    ]);
    const back = withExtraSet(withoutLastSet(sided));
    expect(back.sets.map((s) => [s.side, s.target])).toEqual(sided.sets.map((s) => [s.side, s.target]));
  });
});
