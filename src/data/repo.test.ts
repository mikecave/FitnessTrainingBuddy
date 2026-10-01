import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addExerciseToTemplate,
  addFeedback,
  addMemberToGroup,
  addObservation,
  deleteResolvedFeedback,
  listFeedback,
  setFeedbackResolved,
  cancelSession,
  createExercise,
  createTemplate,
  ensureSeeded,
  exportAllData,
  finishSession,
  getActiveSession,
  getTemplate,
  importData,
  listActivities,
  listDoneSessions,
  listTemplates,
  logActivitySession,
  setSessionDate,
  listSessionsForTemplate,
  moveGroupInTemplate,
  removeExerciseFromTemplate,
  removeMemberFromTemplate,
  renameTemplate,
  splitMemberFromGroup,
  setSessionWeekType,
  startSession,
  updateExercise,
  updateMemberInTemplate,
  updateSession,
} from './repo';
import { CURRENT_USER, type BackupFile, type Session, type SessionExercise } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
});

describe('startSession — first-ever session (no prior done session)', () => {
  it('builds sections/sets fresh from the template prescription', async () => {
    const session = await startSession('tpl-upper-1');

    expect(session.templateId).toBe('tpl-upper-1');
    expect(session.userId).toBe(CURRENT_USER);
    expect(session.status).toBe('active');
    expect(session.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const primary = session.sections.find((s) => s.kind === 'primary')!;
    const supersetA = primary.groups[0];
    const pullUps = supersetA.members.find((m) => m.exerciseId === 'ex-pull-ups')!;

    expect(pullUps.intensity).toBe(8); // member.intensity in the template
    expect(pullUps.sets).toHaveLength(5);
    expect(pullUps.sets.every((s) => s.done === false)).toBe(true);
    expect(pullUps.sets.every((s) => s.actualReps === undefined)).toBe(true);
    expect(pullUps.sets.filter((s) => s.mainWork).length).toBe(3);
  });

  it('falls back to the exercise default intensity when the template omits one', async () => {
    const session = await startSession('tpl-lower-1');
    const primary = session.sections.find((s) => s.kind === 'primary')!;
    const jeffersonCurl = primary.groups
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-jefferson-curl')!;

    // seed template gives ex-jefferson-curl no per-workout `intensity`
    const exercise = await db.exercises.get('ex-jefferson-curl');
    expect(jeffersonCurl.intensity).toBe(exercise!.defaultIntensity);
  });

  it('resets AMRAP sets to a fresh un-logged amrap target', async () => {
    const session = await startSession('tpl-micro-upper-1');
    const pullUps = session.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-pull-ups')!;

    const amrapSet = pullUps.sets.at(-1)!;
    expect(amrapSet.target).toEqual({ type: 'amrap' });
    expect(amrapSet.done).toBe(false);
    expect(amrapSet.actualReps).toBeUndefined();
  });
});

describe('startSession — copy-forward from a prior done session', () => {
  async function seedPriorDoneSession(): Promise<Session> {
    const first = await startSession('tpl-upper-1');

    const primary = first.sections.find((s) => s.kind === 'primary')!;
    const pullUps = primary.groups[0].members.find((m) => m.exerciseId === 'ex-pull-ups')!;
    pullUps.intensity = 8.5;
    pullUps.sets[0].actualReps = 6;
    pullUps.sets[0].done = true;
    pullUps.sets[2].actualReps = 5; // a mainWork set, ramped up from the template's 3
    pullUps.sets[2].load = { type: 'bw_plus_kg', kg: 20 };
    pullUps.sets[2].done = true;
    pullUps.sets[2].note = 'felt strong';

    await updateSession(first);
    await finishSession(first.id, { overallEffort: 8, endingFatigue: 4 });

    const saved = await db.sessions.get(first.id);
    return saved!;
  }

  it('clones the prior session loads/targets/intensity, resetting per-instance fields', async () => {
    const prior = await seedPriorDoneSession();
    const next = await startSession('tpl-upper-1');

    expect(next.id).not.toBe(prior.id);

    const priorPullUps = prior.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-pull-ups')!;
    const nextPullUps = next.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-pull-ups')!;

    expect(nextPullUps.intensity).toBe(8.5); // carried forward, not the template's 8
    expect(nextPullUps.sets[2].load).toEqual({ type: 'bw_plus_kg', kg: 20 }); // ramped load carried forward
    expect(nextPullUps.sets[2].mainWork).toBe(priorPullUps.sets[2].mainWork);

    // every set is reset to a fresh, un-logged instance
    for (const set of nextPullUps.sets) {
      expect(set.done).toBe(false);
      expect(set.actualReps).toBeUndefined();
      expect(set.actualSeconds).toBeUndefined();
      expect(set.intensityOverride).toBeUndefined();
      expect(set.note).toBeUndefined();
    }
  });

  it('resets AMRAP sets even when the prior session logged real reps for it', async () => {
    const first = await startSession('tpl-micro-upper-1');
    const pullUps = first.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-pull-ups')!;
    const amrapSet = pullUps.sets.at(-1)!;
    expect(amrapSet.target).toEqual({ type: 'amrap' });
    amrapSet.actualReps = 11;
    amrapSet.done = true;
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 9, endingFatigue: 6 });

    const next = await startSession('tpl-micro-upper-1');
    const nextPullUps = next.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-pull-ups')!;
    const nextAmrapSet = nextPullUps.sets.at(-1)!;

    expect(nextAmrapSet.target).toEqual({ type: 'amrap' });
    expect(nextAmrapSet.actualReps).toBeUndefined();
    expect(nextAmrapSet.done).toBe(false);
  });

  it('preserves mainWork flags through copy-forward', async () => {
    await seedPriorDoneSession();
    const next = await startSession('tpl-upper-1');
    const deadliftLikeGroup = next.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-pull-ups')!;

    const mainWorkCount = deadliftLikeGroup.sets.filter((s) => s.mainWork).length;
    expect(mainWorkCount).toBe(3);
    expect(deadliftLikeGroup.sets[0].mainWork).toBeUndefined();
  });

  it('uses the most recent done session when several exist', async () => {
    const oldest = await startSession('tpl-lower-1');
    oldest.date = '2020-01-01';
    await updateSession(oldest);
    await finishSession(oldest.id, { overallEffort: 5, endingFatigue: 5 });

    const middle = await startSession('tpl-lower-1');
    middle.date = '2024-06-01';
    const deadlift = middle.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-deadlift')!;
    deadlift.sets.at(-1)!.load = { type: 'kg', kg: 130 };
    await updateSession(middle);
    await finishSession(middle.id, { overallEffort: 7, endingFatigue: 5 });

    const sessions = await listSessionsForTemplate('tpl-lower-1');
    expect(sessions[0].id).toBe(middle.id);
    expect(sessions[1].id).toBe(oldest.id);

    const next = await startSession('tpl-lower-1');
    const nextDeadlift = next.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-deadlift')!;
    expect(nextDeadlift.sets.at(-1)!.load).toEqual({ type: 'kg', kg: 130 });
  });
});

describe('copy-forward: template owns structure, last workout owns the numbers', () => {
  const PULL = 'ex-pull-ups';

  function pullUpsIn(session: Session): SessionExercise {
    return session.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === PULL)!;
  }

  /** Log a first workout, applying `edit` to the pull-ups before finishing. */
  async function firstWorkout(edit: (m: SessionExercise) => void): Promise<void> {
    const first = await startSession('tpl-upper-1');
    edit(pullUpsIn(first));
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 8, endingFatigue: 5 });
  }

  it('carries the load you actually lifted', async () => {
    await firstWorkout((m) => {
      m.sets[0].load = { type: 'bw_plus_kg', kg: 25 };
      m.sets[0].actualReps = 3;
      m.sets[0].done = true;
    });

    const next = await startSession('tpl-upper-1');
    expect(pullUpsIn(next).sets[0].load).toEqual({ type: 'bw_plus_kg', kg: 25 });
  });

  it('does NOT carry the reps you managed — the target stays the prescription', async () => {
    const before = pullUpsIn(await startSession('tpl-upper-1')).sets[0].target;
    await db.sessions.clear();

    await firstWorkout((m) => {
      m.sets[0].actualReps = 1; // a bad day
      m.sets[0].done = true;
    });

    const next = await startSession('tpl-upper-1');
    expect(pullUpsIn(next).sets[0].target).toEqual(before);
    expect(pullUpsIn(next).sets[0].actualReps).toBeUndefined();
    expect(pullUpsIn(next).sets[0].done).toBe(false);
  });

  it('takes the set count from the template, so a mid-session extra set does not stick', async () => {
    let templateSets = 0;
    await firstWorkout((m) => {
      templateSets = m.sets.length;
      m.sets.push({ ...m.sets[m.sets.length - 1], done: false });
    });

    const next = await startSession('tpl-upper-1');
    expect(pullUpsIn(next).sets).toHaveLength(templateSets);
  });

  it('gives template sets beyond last time the last load actually used', async () => {
    await firstWorkout((m) => {
      m.sets = [{ ...m.sets[0], load: { type: 'bw_plus_kg', kg: 20 }, done: true, actualReps: 5 }];
    });

    const next = await startSession('tpl-upper-1');
    // The template prescribes several sets; only one had a load last time.
    for (const set of pullUpsIn(next).sets) {
      expect(set.load).toEqual({ type: 'bw_plus_kg', kg: 20 });
    }
  });

  it('carries intensity and rest, which are tuned in the gym', async () => {
    await firstWorkout((m) => {
      m.intensity = 9.5;
      m.restAfterSec = 150;
    });

    const next = await startSession('tpl-upper-1');
    expect(pullUpsIn(next).intensity).toBe(9.5);
    expect(pullUpsIn(next).restAfterSec).toBe(150);
  });

  it('carries the mid-workout (w) warm-up flag', async () => {
    await firstWorkout((m) => {
      m.sets[1].warmup = true;
    });

    const next = await startSession('tpl-upper-1');
    expect(pullUpsIn(next).sets[1].warmup).toBe(true);
  });

  it('a change to the template prescription takes effect next workout', async () => {
    await firstWorkout((m) => {
      m.sets[0].load = { type: 'bw_plus_kg', kg: 25 };
      m.sets[0].done = true;
    });

    const template = (await db.templates.get('tpl-upper-1'))!;
    const si = template.sections.findIndex((sec) => sec.kind === 'primary');
    const gi = template.sections[si].groups.findIndex((g) =>
      g.members.some((m) => m.exerciseId === PULL),
    );
    const mi = template.sections[si].groups[gi].members.findIndex((m) => m.exerciseId === PULL);
    await updateMemberInTemplate('tpl-upper-1', si, gi, mi, {
      exerciseId: PULL,
      restAfterSec: 90,
      sets: [{ target: { type: 'reps', reps: 2 }, load: { type: 'bw' }, mainWork: true }],
    });

    const next = await startSession('tpl-upper-1');
    const pull = pullUpsIn(next);
    expect(pull.sets).toHaveLength(1);
    expect(pull.sets[0].target).toEqual({ type: 'reps', reps: 2 });
    // ...and the load you were using is still there.
    expect(pull.sets[0].load).toEqual({ type: 'bw_plus_kg', kg: 25 });
  });

  it('keeps L and R numbers on their own sides when set counts differ', async () => {
    const exercise = await createExercise({ name: 'Single-leg press', category: 'strength', unilateral: true });
    const template = await createTemplate({ name: 'Legs', kind: 'gym' });
    await addExerciseToTemplate(template.id, 'primary', {
      exerciseId: exercise.id,
      restAfterSec: 60,
      sets: [
        { target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 12 }, side: 'L' },
        { target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 12 }, side: 'R' },
        { target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 12 }, side: 'L' },
        { target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 12 }, side: 'R' },
      ],
    });

    const first = await startSession(template.id);
    const member = first.sections.flatMap((s) => s.groups).flatMap((g) => g.members)[0];
    // Only one pair logged, and the weak right side went lighter.
    member.sets = [
      { ...member.sets[0], load: { type: 'kg', kg: 20 }, side: 'L', done: true, actualReps: 10 },
      { ...member.sets[1], load: { type: 'kg', kg: 14 }, side: 'R', done: true, actualReps: 8 },
    ];
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });

    const next = await startSession(template.id);
    const sets = next.sections.flatMap((s) => s.groups).flatMap((g) => g.members)[0].sets;
    expect(sets.map((s) => [s.side, (s.load as { kg: number }).kg])).toEqual([
      ['L', 20],
      ['R', 14],
      ['L', 20],
      ['R', 14],
    ]);
  });

  it('still ignores a session-only ad-hoc exercise', async () => {
    const exercise = await createExercise({ name: 'Face pulls', category: 'rehab', unilateral: false });
    const first = await startSession('tpl-upper-1');
    first.sections[1].groups.push({
      members: [
        {
          exerciseId: exercise.id,
          intensity: 7,
          restAfterSec: 60,
          sets: [{ target: { type: 'reps', reps: 12 }, load: { type: 'kg', kg: 10 }, done: true }],
          addedAdHoc: true,
        },
      ],
    });
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });

    const next = await startSession('tpl-upper-1');
    const ids = next.sections.flatMap((s) => s.groups).flatMap((g) => g.members).map((m) => m.exerciseId);
    expect(ids).not.toContain(exercise.id);
  });
});

describe('training cycles: build, peak and deload weeks', () => {
  const PULL = 'ex-pull-ups';

  function member(session: Session, exerciseId = PULL): SessionExercise {
    return session.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === exerciseId)!;
  }

  /** Log a workout of the given type, setting every pull-up set to `kg`. */
  async function logWeek(weekType: 'build' | 'peak' | 'deload' | undefined, kg: number) {
    const session = await startSession('tpl-upper-1', weekType);
    const pull = member(session);
    pull.sets = pull.sets.map((set) => ({
      ...set,
      load: { type: 'kg', kg },
      actualReps: 5,
      done: true,
    }));
    await updateSession(session);
    await finishSession(session.id, { overallEffort: 8, endingFatigue: 5 });
    return session;
  }

  it('a fresh workout is a build week', async () => {
    const session = await startSession('tpl-upper-1');
    expect(session.weekType).toBe('build');
  });

  it('a deload starts at 60% of what you were last lifting, rounded to 2.5kg', async () => {
    await logWeek('build', 40);

    const deload = await startSession('tpl-upper-1', 'deload');
    // 40 × 0.6 = 24 → nearest 2.5 is 25
    expect(member(deload).sets.every((s) => s.load.type === 'kg' && s.load.kg === 25)).toBe(true);
  });

  it('a first deload halves the sets, rounded up', async () => {
    const full = (await logWeek('build', 40)).sections;
    const fullCount = full.flatMap((s) => s.groups).flatMap((g) => g.members).find((m) => m.exerciseId === PULL)!.sets.length;

    const deload = await startSession('tpl-upper-1', 'deload');
    expect(member(deload).sets).toHaveLength(Math.ceil(fullCount / 2));
  });

  it('a later deload keeps the set count the user settled on last deload', async () => {
    await logWeek('build', 40);
    const first = await startSession('tpl-upper-1', 'deload');
    const pull = member(first);
    pull.sets = [{ ...pull.sets[0], done: true, actualReps: 5 }];
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 4, endingFatigue: 3 });
    await logWeek('build', 45);

    expect(member(await startSession('tpl-upper-1', 'deload')).sets).toHaveLength(1);
  });

  it('does not discount twice when two deloads run back to back', async () => {
    await logWeek('build', 40);
    await logWeek('deload', 25);

    const second = await startSession('tpl-upper-1', 'deload');
    expect(member(second).sets[0].load).toEqual({ type: 'kg', kg: 25 });
  });

  it('the week after a deload goes back to building, from the deload weights', async () => {
    await logWeek('build', 40);
    await logWeek('deload', 35);

    const next = await startSession('tpl-upper-1');
    expect(next.weekType).toBe('build');
    // The new cycle restarts light and ramps, instead of resuming at the peak.
    expect(member(next).sets[0].load).toEqual({ type: 'kg', kg: 35 });
  });

  it('a peak week stays a peak until told otherwise', async () => {
    await logWeek('peak', 45);
    expect((await startSession('tpl-upper-1')).weekType).toBe('peak');
  });

  it('a deload remembers the rep scheme from the last deload', async () => {
    await logWeek('build', 40);

    // First deload: the user dials the reps down by hand.
    const firstDeload = await startSession('tpl-upper-1', 'deload');
    const pull = member(firstDeload);
    pull.sets = pull.sets.map((set) => ({
      ...set,
      target: { type: 'reps', reps: 4 },
      done: true,
      actualReps: 4,
    }));
    await updateSession(firstDeload);
    await finishSession(firstDeload.id, { overallEffort: 5, endingFatigue: 3 });

    await logWeek('build', 45);

    const nextDeload = await startSession('tpl-upper-1', 'deload');
    expect(member(nextDeload).sets.every((s) => s.target.type === 'reps' && s.target.reps === 4)).toBe(true);
    // ...and its loads track current strength: 45 × 0.6 = 27 → 27.5
    expect(member(nextDeload).sets[0].load).toEqual({ type: 'kg', kg: 27.5 });
  });

  it('a build week keeps the template targets, not the deload ones', async () => {
    const templateTarget = member(await startSession('tpl-upper-1')).sets[0].target;
    await db.sessions.clear();

    await logWeek('build', 40);
    const deload = await startSession('tpl-upper-1', 'deload');
    const pull = member(deload);
    pull.sets = pull.sets.map((set) => ({ ...set, target: { type: 'reps', reps: 2 }, done: true }));
    await updateSession(deload);
    await finishSession(deload.id, { overallEffort: 4, endingFatigue: 3 });

    const build = await startSession('tpl-upper-1');
    expect(member(build).sets[0].target).toEqual(templateTarget);
  });

  it('bodyweight and band loads survive a deload unscaled', async () => {
    const first = await startSession('tpl-upper-1', 'build');
    const pull = member(first);
    pull.sets = pull.sets.map((set) => ({ ...set, load: { type: 'bw' }, done: true }));
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 4 });

    const deload = await startSession('tpl-upper-1', 'deload');
    expect(member(deload).sets[0].load).toEqual({ type: 'bw' });
  });

  it('scales the added kg of a BW+kg load', async () => {
    const first = await startSession('tpl-upper-1', 'build');
    const pull = member(first);
    pull.sets = pull.sets.map((set) => ({
      ...set,
      load: { type: 'bw_plus_kg', kg: 20 },
      done: true,
    }));
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 4 });

    const deload = await startSession('tpl-upper-1', 'deload');
    // 20 × 0.6 = 12 → 12.5
    expect(member(deload).sets[0].load).toEqual({ type: 'bw_plus_kg', kg: 12.5 });
  });

  describe('switching mid-workout', () => {
    it('re-derives the sets still to come and leaves logged ones alone', async () => {
      await logWeek('build', 40);

      const today = await startSession('tpl-upper-1');
      const pull = member(today);
      pull.sets[0] = { ...pull.sets[0], load: { type: 'kg', kg: 40 }, actualReps: 5, done: true };
      await updateSession(today);

      const switched = await setSessionWeekType(today.id, 'deload');
      const after = member(switched);

      expect(switched.weekType).toBe('deload');
      // the set they already lifted is untouched...
      expect(after.sets[0].load).toEqual({ type: 'kg', kg: 40 });
      expect(after.sets[0].done).toBe(true);
      // ...the rest come down to the deload weight, and there are fewer of them
      expect(after.sets[1]?.load ?? { type: 'kg', kg: 25 }).toEqual({ type: 'kg', kg: 25 });
      expect(after.sets.length).toBeLessThan(member(today).sets.length);
    });

    it('switching back to build restores the full set count', async () => {
      await logWeek('build', 40);
      const today = await startSession('tpl-upper-1');
      const fullCount = member(today).sets.length;
      await setSessionWeekType(today.id, 'deload');
      const back = await setSessionWeekType(today.id, 'build');
      expect(member(back).sets).toHaveLength(fullCount);
      expect(member(back).sets.every((s) => s.load.type === 'kg' && s.load.kg === 40)).toBe(true);
    });

    it('keeps an exercise added mid-workout', async () => {
      const exercise = await createExercise({ name: 'Face pulls', category: 'rehab', unilateral: false });
      const today = await startSession('tpl-upper-1');
      today.sections[1].groups.push({ members: [adHocMemberFor(exercise.id)] });
      await updateSession(today);

      const switched = await setSessionWeekType(today.id, 'deload');
      const ids = switched.sections.flatMap((s) => s.groups).flatMap((g) => g.members).map((m) => m.exerciseId);
      expect(ids).toContain(exercise.id);
    });
  });

  function adHocMemberFor(exerciseId: string): SessionExercise {
    return {
      exerciseId,
      intensity: 7,
      restAfterSec: 60,
      sets: [{ target: { type: 'reps', reps: 12 }, load: { type: 'kg', kg: 10 }, done: false }],
      addedAdHoc: true,
    };
  }
});

describe('active-session invariant', () => {
  it('throws when starting a session while one is already active', async () => {
    await startSession('tpl-upper-1');
    await expect(startSession('tpl-lower-1')).rejects.toThrow();
  });

  it('getActiveSession returns the in-progress session', async () => {
    expect(await getActiveSession()).toBeUndefined();
    const started = await startSession('tpl-upper-1');
    const active = await getActiveSession();
    expect(active?.id).toBe(started.id);
  });

  it('finishing a session frees up starting a new one', async () => {
    const first = await startSession('tpl-upper-1');
    await finishSession(first.id, { overallEffort: 6, endingFatigue: 5 });
    expect(await getActiveSession()).toBeUndefined();
    const second = await startSession('tpl-lower-1');
    expect(second.templateId).toBe('tpl-lower-1');
  });
});

describe('session flexing — ad-hoc adds and skips', () => {
  function adHocMember(exerciseId: string, addedAdHoc = true): SessionExercise {
    return {
      exerciseId,
      intensity: 7,
      restAfterSec: 60,
      sets: [{ target: { type: 'reps', reps: 8 }, load: { type: 'kg', kg: 10 }, done: false }],
      ...(addedAdHoc ? { addedAdHoc: true } : {}),
    };
  }

  it('createExercise adds a permanent library entry with the default intensity', async () => {
    const exercise = await createExercise({ name: 'Face pulls', category: 'rehab', unilateral: false });
    const saved = await db.exercises.get(exercise.id);
    expect(saved?.name).toBe('Face pulls');
    expect(saved?.defaultIntensity).toBe(7);
    expect(saved?.userId).toBe(CURRENT_USER);
  });

  it('session-only ad-hoc exercises do NOT copy forward', async () => {
    const exercise = await createExercise({ name: 'Face pulls', category: 'rehab', unilateral: false });
    const first = await startSession('tpl-upper-1');
    const secondary = first.sections.find((s) => s.kind === 'secondary')!;
    secondary.groups.push({ members: [adHocMember(exercise.id)] });
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });

    const next = await startSession('tpl-upper-1');
    const allExerciseIds = next.sections.flatMap((s) => s.groups).flatMap((g) => g.members).map((m) => m.exerciseId);
    expect(allExerciseIds).not.toContain(exercise.id);
  });

  it('a promoted ad-hoc exercise DOES come back next time', async () => {
    // Promoting writes the exercise into the template (what the session screen
    // does) and clears the ad-hoc flag. The template is what the next workout
    // is built from, so this is why it sticks.
    const exercise = await createExercise({ name: 'Face pulls', category: 'rehab', unilateral: false });
    const first = await startSession('tpl-upper-1');
    const secondary = first.sections.find((s) => s.kind === 'secondary')!;
    secondary.groups.push({ members: [adHocMember(exercise.id, false)] });
    await updateSession(first);
    await addExerciseToTemplate('tpl-upper-1', 'secondary', {
      exerciseId: exercise.id,
      restAfterSec: 60,
      sets: [{ target: { type: 'reps', reps: 12 }, load: { type: 'kg', kg: 10 } }],
    });
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });

    const next = await startSession('tpl-upper-1');
    const allExerciseIds = next.sections.flatMap((s) => s.groups).flatMap((g) => g.members).map((m) => m.exerciseId);
    expect(allExerciseIds).toContain(exercise.id);
  });

  it('the skipped flag resets on copy-forward but the exercise is kept', async () => {
    const first = await startSession('tpl-upper-1');
    const primary = first.sections.find((s) => s.kind === 'primary')!;
    const pullUps = primary.groups[0].members.find((m) => m.exerciseId === 'ex-pull-ups')!;
    pullUps.skipped = true;
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });

    const next = await startSession('tpl-upper-1');
    const nextPullUps = next.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-pull-ups')!;
    expect(nextPullUps.skipped).toBeUndefined();
  });

  it('addExerciseToTemplate appends a straight-sets group to the section', async () => {
    const exercise = await createExercise({ name: 'Face pulls', category: 'rehab', unilateral: false });
    await addExerciseToTemplate('tpl-upper-1', 'secondary', {
      exerciseId: exercise.id,
      restAfterSec: 60,
      sets: [{ target: { type: 'reps', reps: 12 }, load: { type: 'band' } }],
    });

    const template = await db.templates.get('tpl-upper-1');
    const secondary = template!.sections.find((s) => s.kind === 'secondary')!;
    const lastGroup = secondary.groups.at(-1)!;
    expect(lastGroup.members).toHaveLength(1);
    expect(lastGroup.members[0].exerciseId).toBe(exercise.id);
  });

  it('addExerciseToTemplate creates a missing section in canonical order', async () => {
    // the micro template has no warm-up section
    const exercise = await createExercise({ name: 'Band dislocates', category: 'movement', unilateral: false });
    await addExerciseToTemplate('tpl-micro-upper-1', 'warmup', {
      exerciseId: exercise.id,
      restAfterSec: 0,
      sets: [{ target: { type: 'reps', reps: 10 }, load: { type: 'band' } }],
    });

    const template = await db.templates.get('tpl-micro-upper-1');
    expect(template!.sections[0].kind).toBe('warmup');
    expect(template!.sections[0].logging).toBe('loose');
    expect(template!.sections[0].groups[0].members[0].exerciseId).toBe(exercise.id);
  });

  it('removeMemberFromTemplate removes the member and drops the emptied group', async () => {
    const before = (await db.templates.get('tpl-upper-1'))!;
    const si = before.sections.findIndex((s) => s.kind === 'secondary');
    const groupCount = before.sections[si].groups.length;
    const removedId = before.sections[si].groups[0].members[0].exerciseId;

    await removeMemberFromTemplate('tpl-upper-1', si, 0, 0);

    const after = (await db.templates.get('tpl-upper-1'))!;
    const remaining = after.sections[si].groups.flatMap((g) => g.members).map((m) => m.exerciseId);
    expect(remaining).not.toContain(removedId);
    // the group had a single member, so it disappears entirely
    expect(after.sections[si].groups.length).toBe(groupCount - 1);
  });

  it('removeMemberFromTemplate keeps a multi-member group (superset) intact minus one member', async () => {
    const before = (await db.templates.get('tpl-upper-1'))!;
    const si = before.sections.findIndex((s) => s.kind === 'primary');
    const superset = before.sections[si].groups[0];
    expect(superset.members.length).toBeGreaterThan(1);

    await removeMemberFromTemplate('tpl-upper-1', si, 0, 0);

    const after = (await db.templates.get('tpl-upper-1'))!;
    expect(after.sections[si].groups[0].members.length).toBe(superset.members.length - 1);
  });

  it('removeMemberFromTemplate drops a section left with no groups and no description', async () => {
    const template = await createTemplate({ name: 'One-off', kind: 'gym' });
    const exercise = await createExercise({ name: 'Dead bug', category: 'rehab', unilateral: false });
    await addExerciseToTemplate(template.id, 'primary', {
      exerciseId: exercise.id,
      restAfterSec: 60,
      sets: [{ target: { type: 'reps', reps: 10 }, load: { type: 'bw' } }],
    });

    await removeMemberFromTemplate(template.id, 0, 0, 0);

    const after = (await db.templates.get(template.id))!;
    expect(after.sections).toEqual([]);
  });

  it('updateExercise renames the library exercise for every template that uses it', async () => {
    await updateExercise('ex-pull-ups', { name: 'Weighted pull-ups' });
    const exercise = await db.exercises.get('ex-pull-ups');
    expect(exercise!.name).toBe('Weighted pull-ups');
    // templates reference by id, so both gym and micro templates now show the fix
    const gym = (await db.templates.get('tpl-upper-1'))!;
    const stillReferenced = gym.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .some((m) => m.exerciseId === 'ex-pull-ups');
    expect(stillReferenced).toBe(true);
  });

  it('updateMemberInTemplate replaces the slot prescription in place', async () => {
    const before = (await db.templates.get('tpl-upper-1'))!;
    const si = before.sections.findIndex((s) => s.kind === 'secondary');
    const member = before.sections[si].groups[0].members[0];

    await updateMemberInTemplate('tpl-upper-1', si, 0, 0, {
      ...member,
      restAfterSec: 45,
      intensity: 9,
      sets: [{ target: { type: 'reps', reps: 15 }, load: { type: 'kg', kg: 12.5 } }],
    });

    const after = (await db.templates.get('tpl-upper-1'))!;
    const updated = after.sections[si].groups[0].members[0];
    expect(updated.exerciseId).toBe(member.exerciseId);
    expect(updated.restAfterSec).toBe(45);
    expect(updated.intensity).toBe(9);
    expect(updated.sets).toEqual([{ target: { type: 'reps', reps: 15 }, load: { type: 'kg', kg: 12.5 } }]);
  });

  it('moveGroupInTemplate reorders groups within a section and persists', async () => {
    const before = (await db.templates.get('tpl-upper-1'))!;
    const si = before.sections.findIndex((s) => s.kind === 'primary');
    const order = before.sections[si].groups.map((g) => g.members[0].exerciseId);
    expect(order.length).toBeGreaterThan(1);

    await moveGroupInTemplate('tpl-upper-1', si, 0, order.length - 1);

    const after = (await db.templates.get('tpl-upper-1'))!;
    const newOrder = after.sections[si].groups.map((g) => g.members[0].exerciseId);
    expect(newOrder).toEqual([...order.slice(1), order[0]]);
  });

  it('moveGroupInTemplate rejects out-of-range indexes', async () => {
    const before = (await db.templates.get('tpl-upper-1'))!;
    const si = before.sections.findIndex((s) => s.kind === 'primary');
    await expect(moveGroupInTemplate('tpl-upper-1', si, 0, 99)).rejects.toThrow(/Bad group move/);
  });
});

describe('supersets: pair and unpair', () => {
  const SET = { target: { type: 'reps', reps: 10 } as const, load: { type: 'bw' } as const };

  async function twoStraightGroups() {
    const template = await createTemplate({ name: 'Pair Test', kind: 'gym' });
    const a = await createExercise({ name: 'Move A', category: 'strength', unilateral: false });
    const b = await createExercise({ name: 'Move B', category: 'strength', unilateral: false });
    await addExerciseToTemplate(template.id, 'primary', { exerciseId: a.id, restAfterSec: 60, sets: [SET] });
    await addExerciseToTemplate(template.id, 'primary', { exerciseId: b.id, restAfterSec: 60, sets: [SET] });
    return { template, a, b };
  }

  it('addMemberToGroup turns straight sets into a superset', async () => {
    const { template, a } = await twoStraightGroups();
    const c = await createExercise({ name: 'Move C', category: 'accessory', unilateral: false });

    await addMemberToGroup(template.id, 0, 0, { exerciseId: c.id, restAfterSec: 30, sets: [SET] });

    const after = (await db.templates.get(template.id))!;
    expect(after.sections[0].groups).toHaveLength(2);
    expect(after.sections[0].groups[0].members.map((m) => m.exerciseId)).toEqual([a.id, c.id]);
  });

  it('splitMemberFromGroup breaks a member out into its own group just below', async () => {
    const { template, a, b } = await twoStraightGroups();
    const c = await createExercise({ name: 'Move C', category: 'accessory', unilateral: false });
    await addMemberToGroup(template.id, 0, 0, { exerciseId: c.id, restAfterSec: 30, sets: [SET] });

    await splitMemberFromGroup(template.id, 0, 0, 1); // pull C back out

    const after = (await db.templates.get(template.id))!;
    const order = after.sections[0].groups.map((g) => g.members.map((m) => m.exerciseId));
    expect(order).toEqual([[a.id], [c.id], [b.id]]);
  });

  it('splitMemberFromGroup is a no-op on a straight-sets group', async () => {
    const { template, a, b } = await twoStraightGroups();
    await splitMemberFromGroup(template.id, 0, 0, 0);
    const after = (await db.templates.get(template.id))!;
    expect(after.sections[0].groups.map((g) => g.members.map((m) => m.exerciseId))).toEqual([[a.id], [b.id]]);
  });

  it('a session started from a paired template rotates the superset members together', async () => {
    const { template, a } = await twoStraightGroups();
    const c = await createExercise({ name: 'Move C', category: 'accessory', unilateral: false });
    await addMemberToGroup(template.id, 0, 0, { exerciseId: c.id, restAfterSec: 30, sets: [SET] });

    const session = await startSession(template.id);
    expect(session.sections[0].groups[0].members.map((m) => m.exerciseId)).toEqual([a.id, c.id]);
  });
});

describe('warm-up set flag', () => {
  async function templateWithWarmupSets() {
    const template = await createTemplate({ name: 'Warmup Flag Test', kind: 'gym' });
    const exercise = await createExercise({ name: 'Front squat', category: 'strength', unilateral: false });
    await addExerciseToTemplate(template.id, 'primary', {
      exerciseId: exercise.id,
      restAfterSec: 90,
      sets: [
        { target: { type: 'reps', reps: 8 }, load: { type: 'kg', kg: 40 }, warmup: true },
        { target: { type: 'reps', reps: 5 }, load: { type: 'kg', kg: 80 }, mainWork: true },
      ],
    });
    return template;
  }

  it('carries warmup from the template prescription into a first session', async () => {
    const template = await templateWithWarmupSets();
    const session = await startSession(template.id);
    const sets = session.sections[0].groups[0].members[0].sets;
    expect(sets[0].warmup).toBe(true);
    expect(sets[1].warmup).toBeUndefined();
    expect(sets[1].mainWork).toBe(true);
  });

  it('copies warmup forward from a prior done session, including mid-session toggles', async () => {
    const template = await templateWithWarmupSets();
    const first = await startSession(template.id);
    // mid-session: the user flags set 2 as warm-up too
    first.sections[0].groups[0].members[0].sets[1].warmup = true;
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });

    const next = await startSession(template.id);
    const sets = next.sections[0].groups[0].members[0].sets;
    expect(sets[0].warmup).toBe(true);
    expect(sets[1].warmup).toBe(true);
    expect(sets.every((s) => !s.done)).toBe(true);
  });
});

describe('createTemplate', () => {
  it('creates a blank template', async () => {
    const template = await createTemplate({ name: 'Upper Body 2', kind: 'gym' });
    const saved = await db.templates.get(template.id);
    expect(saved?.name).toBe('Upper Body 2');
    expect(saved?.sections).toEqual([]);
    expect(saved?.userId).toBe(CURRENT_USER);
  });

  it('copies sections deeply from a source template', async () => {
    const copy = await createTemplate({
      name: 'Upper Body 2',
      kind: 'gym',
      copyFromTemplateId: 'tpl-upper-1',
    });
    const source = (await db.templates.get('tpl-upper-1'))!;
    expect(copy.sections).toEqual(source.sections);

    // deep copy: mutating the clone must not touch the source
    copy.sections[1].groups[0].members[0].restAfterSec = 999;
    await db.templates.put(copy);
    const sourceAfter = (await db.templates.get('tpl-upper-1'))!;
    expect(sourceAfter.sections[1].groups[0].members[0].restAfterSec).toBe(90);
  });

  it('renameTemplate trims and saves a new name, ignoring blank input', async () => {
    await renameTemplate('tpl-upper-1', '  Upper Body A  ');
    expect((await db.templates.get('tpl-upper-1'))!.name).toBe('Upper Body A');

    await renameTemplate('tpl-upper-1', '   ');
    expect((await db.templates.get('tpl-upper-1'))!.name).toBe('Upper Body A');

    await expect(renameTemplate('nope', 'X')).rejects.toThrow(/Template not found/);
  });

  it('a copied template starts its first session from its own prescription', async () => {
    const copy = await createTemplate({
      name: 'Micro 2',
      kind: 'micro',
      timeCapMin: 30,
      copyFromTemplateId: 'tpl-micro-upper-1',
    });
    const session = await startSession(copy.id);
    expect(session.templateId).toBe(copy.id);
    const exerciseIds = session.sections.flatMap((s) => s.groups).flatMap((g) => g.members).map((m) => m.exerciseId);
    expect(exerciseIds).toContain('ex-pull-ups');
  });
});

describe('removeExerciseFromTemplate — removal by identity, from a live session', () => {
  async function primaryIds(): Promise<string[]> {
    const template = (await db.templates.get('tpl-upper-1'))!;
    return template.sections
      .filter((s) => s.kind === 'primary')
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .map((m) => m.exerciseId);
  }

  it('removes the exercise and reports that it did', async () => {
    expect(await primaryIds()).toContain('ex-pull-ups');
    expect(await removeExerciseFromTemplate('tpl-upper-1', 'primary', 'ex-pull-ups')).toBe(true);
    expect(await primaryIds()).not.toContain('ex-pull-ups');
  });

  it('reports false and changes nothing when the exercise is not in that section', async () => {
    const before = await db.templates.get('tpl-upper-1');
    expect(await removeExerciseFromTemplate('tpl-upper-1', 'primary', 'ex-not-here')).toBe(false);
    expect(await db.templates.get('tpl-upper-1')).toEqual(before);
  });

  it('is not fooled by the section kind: the same exercise elsewhere survives', async () => {
    const exercise = await createExercise({ name: 'Face pulls', category: 'rehab', unilateral: false });
    await addExerciseToTemplate('tpl-upper-1', 'primary', {
      exerciseId: exercise.id,
      restAfterSec: 60,
      sets: [{ target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 10 } }],
    });
    await addExerciseToTemplate('tpl-upper-1', 'secondary', {
      exerciseId: exercise.id,
      restAfterSec: 60,
      sets: [{ target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 10 } }],
    });

    expect(await removeExerciseFromTemplate('tpl-upper-1', 'primary', exercise.id)).toBe(true);

    const template = (await db.templates.get('tpl-upper-1'))!;
    const inSection = (kind: string) =>
      template.sections
        .filter((s) => s.kind === kind)
        .flatMap((s) => s.groups)
        .flatMap((g) => g.members)
        .map((m) => m.exerciseId);
    expect(inSection('primary')).not.toContain(exercise.id);
    expect(inSection('secondary')).toContain(exercise.id);
  });

  it('removes only one member of a superset, leaving its partner', async () => {
    const template = (await db.templates.get('tpl-upper-1'))!;
    const superset = template.sections
      .flatMap((s) => s.groups)
      .find((g) => g.members.length > 1)!;
    const [first, second] = superset.members.map((m) => m.exerciseId);

    await removeExerciseFromTemplate('tpl-upper-1', 'primary', first);

    const after = (await db.templates.get('tpl-upper-1'))!;
    const ids = after.sections.flatMap((s) => s.groups).flatMap((g) => g.members).map((m) => m.exerciseId);
    expect(ids).not.toContain(first);
    expect(ids).toContain(second);
  });

  it('stamps updatedAt so the change syncs', async () => {
    const before = (await db.templates.get('tpl-upper-1'))!.updatedAt;
    await removeExerciseFromTemplate('tpl-upper-1', 'primary', 'ex-pull-ups');
    expect((await db.templates.get('tpl-upper-1'))!.updatedAt).toBeGreaterThan(before);
  });

  it('removing from today AND the template keeps it out of the next session', async () => {
    // The real flow from the session screen: the exercise leaves today's
    // session and the template together. Copy-forward reads the prior session,
    // so it is the session-side removal that keeps it away next time; the
    // template-side one keeps the programme document honest.
    const first = await startSession('tpl-upper-1');
    first.sections = first.sections.map((s) => ({
      ...s,
      groups: s.groups
        .map((g) => ({ ...g, members: g.members.filter((m) => m.exerciseId !== 'ex-pull-ups') }))
        .filter((g) => g.members.length > 0),
    }));
    await updateSession(first);
    await removeExerciseFromTemplate('tpl-upper-1', 'primary', 'ex-pull-ups');
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });

    const next = await startSession('tpl-upper-1');
    const ids = next.sections.flatMap((s) => s.groups).flatMap((g) => g.members).map((m) => m.exerciseId);
    expect(ids).not.toContain('ex-pull-ups');
  });

  it('a template-only edit reaches the next session', async () => {
    // The template owns structure, so editing it in the template editor is
    // enough — no need to also remove the exercise from a live workout.
    const first = await startSession('tpl-upper-1');
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });
    await removeExerciseFromTemplate('tpl-upper-1', 'primary', 'ex-pull-ups');

    const next = await startSession('tpl-upper-1');
    const ids = next.sections.flatMap((s) => s.groups).flatMap((g) => g.members).map((m) => m.exerciseId);
    expect(ids).not.toContain('ex-pull-ups');
  });
});

describe('cancelSession', () => {
  it('frees the active slot and leaves no trace for copy-forward', async () => {
    const first = await startSession('tpl-upper-1');
    // log something so we can prove the canceled data never comes back
    first.sections[1].groups[0].members[0].intensity = 9.5;
    await updateSession(first);

    await cancelSession(first.id);

    expect(await getActiveSession()).toBeUndefined();
    expect(await listSessionsForTemplate('tpl-upper-1')).toHaveLength(0);

    // a new session builds fresh from the template, not the canceled one
    const next = await startSession('tpl-upper-1');
    const pullUps = next.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-pull-ups')!;
    expect(pullUps.intensity).toBe(8);
  });
});

describe('finishSession', () => {
  it('sets status done, stamps finishedAt, and applies close fields', async () => {
    const session = await startSession('tpl-upper-1');
    await finishSession(session.id, { overallEffort: 9, endingFatigue: 3, notes: 'good session' });

    const saved = await db.sessions.get(session.id);
    expect(saved!.status).toBe('done');
    expect(saved!.finishedAt).toBeTypeOf('number');
    expect(saved!.overallEffort).toBe(9);
    expect(saved!.endingFatigue).toBe(3);
    expect(saved!.notes).toBe('good session');
  });

  it('stores the workout length when the close screen supplies one', async () => {
    const session = await startSession('tpl-upper-1');
    await finishSession(session.id, { overallEffort: 7, endingFatigue: 5, durationMin: 68 });

    expect((await db.sessions.get(session.id))!.durationMin).toBe(68);
  });

  it('leaves durationMin unset when none was given', async () => {
    const session = await startSession('tpl-upper-1');
    await finishSession(session.id, { overallEffort: 7, endingFatigue: 5 });

    expect((await db.sessions.get(session.id))!.durationMin).toBeUndefined();
  });
});

describe('backup / restore', () => {
  it('exportAllData returns a versioned envelope with all three tables', async () => {
    const backup = await exportAllData();
    expect(backup.format).toBe('fitbuddy-backup');
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBeTypeOf('number');
    // seed data is present
    expect(backup.data.templates.length).toBeGreaterThan(0);
    expect(backup.data.exercises.length).toBeGreaterThan(0);
    expect(Array.isArray(backup.data.sessions)).toBe(true);
  });

  it('merge adds a template that only exists in the file', async () => {
    // Take a backup, add a brand-new template to it, then import into the live DB.
    const backup = await exportAllData();
    const extra = {
      id: 'tpl-imported-1',
      userId: CURRENT_USER,
      name: 'Imported Legs',
      kind: 'gym' as const,
      sections: [],
      updatedAt: 1000,
    };
    backup.data.templates.push(extra);

    const summary = await importData(backup);
    expect(summary.mode).toBe('merge');
    expect(summary.templates.added).toBe(1);
    expect((await db.templates.get('tpl-imported-1'))!.name).toBe('Imported Legs');
  });

  it('merge is last-write-wins: newer updatedAt overwrites, older is skipped', async () => {
    const template = (await db.templates.get('tpl-upper-1'))!;

    // (a) a file record NEWER than local wins
    const newer: BackupFile = {
      format: 'fitbuddy-backup',
      version: 1,
      exportedAt: Date.now(),
      data: {
        exercises: [],
        templates: [{ ...template, name: 'Renamed From Backup', updatedAt: template.updatedAt + 1 }],
        sessions: [],
      },
    };
    let summary = await importData(newer);
    expect(summary.templates.updated).toBe(1);
    expect((await db.templates.get('tpl-upper-1'))!.name).toBe('Renamed From Backup');

    // (b) a file record OLDER than local is ignored
    const older: BackupFile = {
      format: 'fitbuddy-backup',
      version: 1,
      exportedAt: Date.now(),
      data: {
        exercises: [],
        templates: [{ ...template, name: 'Stale Name', updatedAt: template.updatedAt - 1 }],
        sessions: [],
      },
    };
    summary = await importData(older);
    expect(summary.templates.skipped).toBe(1);
    expect((await db.templates.get('tpl-upper-1'))!.name).toBe('Renamed From Backup');
  });

  it('re-importing the same export is a no-op (idempotent → sync-safe)', async () => {
    const backup = await exportAllData();
    const templatesBefore = await db.templates.count();

    const summary = await importData(backup);
    expect(summary.templates.added).toBe(0);
    expect(summary.templates.updated).toBe(0);
    expect(summary.templates.skipped).toBe(templatesBefore);
    expect(await db.templates.count()).toBe(templatesBefore);
  });

  it('round-trips: export → wipe → import restores the templates', async () => {
    const backup = await exportAllData();
    const names = (await db.templates.toArray()).map((t) => t.name).sort();

    await db.templates.clear();
    expect(await db.templates.count()).toBe(0);

    const summary = await importData(backup);
    expect(summary.templates.added).toBe(names.length);
    expect((await db.templates.toArray()).map((t) => t.name).sort()).toEqual(names);
  });

  it('replace wipes local data and loads the file verbatim', async () => {
    const onlyOne: BackupFile = {
      format: 'fitbuddy-backup',
      version: 1,
      exportedAt: Date.now(),
      data: {
        exercises: [],
        templates: [
          { id: 'tpl-solo', userId: CURRENT_USER, name: 'Solo', kind: 'gym', sections: [], updatedAt: 5 },
        ],
        sessions: [],
      },
    };
    const summary = await importData(onlyOne, 'replace');
    expect(summary.mode).toBe('replace');
    const all = await db.templates.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('tpl-solo');
    expect(await db.exercises.count()).toBe(0);
  });

  it('rejects foreign / malformed JSON without mutating the store', async () => {
    const templatesBefore = await db.templates.count();
    await expect(importData({ hello: 'world' })).rejects.toThrow(/not a Fitness Training Buddy backup/i);
    await expect(importData(null)).rejects.toThrow(/expected a JSON object/i);
    await expect(
      importData({ format: 'fitbuddy-backup', version: 99, data: {} }),
    ).rejects.toThrow(/Unsupported backup version/i);
    // nothing changed
    expect(await db.templates.count()).toBe(templatesBefore);
  });
});

describe('observations (notes about the workout)', () => {
  it('appends timestamped notes to the session in order', async () => {
    const session = await startSession('tpl-upper-1');
    await addObservation(session.id, 'pain in left shoulder');
    await addObservation(session.id, '  felt strong on the last set  ');

    const saved = await db.sessions.get(session.id);
    expect(saved!.observations).toHaveLength(2);
    expect(saved!.observations![0].text).toBe('pain in left shoulder');
    // trimmed, and stamped with a time
    expect(saved!.observations![1].text).toBe('felt strong on the last set');
    expect(saved!.observations![1].at).toBeTypeOf('number');
  });

  it('ignores blank notes and rejects an unknown session', async () => {
    const session = await startSession('tpl-upper-1');
    await addObservation(session.id, '   ');
    expect((await db.sessions.get(session.id))!.observations).toBeUndefined();
    await expect(addObservation('nope', 'x')).rejects.toThrow(/Session not found/);
  });

  it('survives copy-forward without leaking into the next session', async () => {
    const first = await startSession('tpl-upper-1');
    await addObservation(first.id, 'left shoulder twinge');
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });

    const next = await startSession('tpl-upper-1');
    expect(next.observations).toBeUndefined();
    // the original keeps its note as history
    expect((await db.sessions.get(first.id))!.observations).toHaveLength(1);
  });
});

describe('app feedback', () => {
  it('records feedback newest-first and ignores blanks', async () => {
    await addFeedback('reps box too narrow');
    await addFeedback('cannot edit rest');
    expect(await addFeedback('   ')).toBeUndefined();

    const list = await listFeedback();
    expect(list).toHaveLength(2);
    expect(list[0].text).toBe('cannot edit rest'); // newest first
    expect(list[0].userId).toBe(CURRENT_USER);
  });

  it('links feedback to the session it was raised during', async () => {
    const session = await startSession('tpl-upper-1');
    await addFeedback('stepper too small', session.id);
    expect((await listFeedback())[0].sessionId).toBe(session.id);
  });

  it('hides resolved items unless asked, and can delete them', async () => {
    const a = await addFeedback('bug one');
    await addFeedback('bug two');
    await setFeedbackResolved(a!.id, true);

    expect(await listFeedback()).toHaveLength(1);
    expect(await listFeedback(true)).toHaveLength(2);

    expect(await deleteResolvedFeedback()).toBe(1);
    expect(await listFeedback(true)).toHaveLength(1);
  });

  it('rides along in a backup round-trip', async () => {
    await addFeedback('rest not editable');
    const backup = await exportAllData();
    expect(backup.data.feedback).toHaveLength(1);

    await db.feedback.clear();
    const summary = await importData(backup);
    expect(summary.feedback.added).toBe(1);
    expect((await listFeedback())[0].text).toBe('rest not editable');
  });

  it('imports a pre-feedback backup (no feedback key) without complaint', async () => {
    const legacy = {
      format: 'fitbuddy-backup' as const,
      version: 1 as const,
      exportedAt: Date.now(),
      data: { exercises: [], templates: [], sessions: [] },
    };
    const summary = await importData(legacy);
    expect(summary.feedback).toEqual({ added: 0, updated: 0, skipped: 0 });
  });
});

describe('seed timestamps (cloud-sync safety)', () => {
  it('stamps seed records in the past so they always lose to real edits', async () => {
    // If seeds were stamped with Date.now(), a freshly-seeded device would win
    // a last-write-wins sync and overwrite genuinely edited templates.
    const templates = await db.templates.toArray();
    const exercises = await db.exercises.toArray();
    const seeded = [...templates, ...exercises];
    expect(seeded.length).toBeGreaterThan(0);
    for (const record of seeded) {
      expect(record.updatedAt).toBeLessThan(Date.now() - 1000);
    }
  });

  it('a real edit beats the seed copy on merge', async () => {
    await renameTemplate('tpl-upper-1', 'Upper Body A');
    const edited = (await db.templates.get('tpl-upper-1'))!;
    const backup = await exportAllData();

    // Simulate a fresh device pushing its factory seed at us.
    await db.delete();
    await db.open();
    await ensureSeeded();
    const factory = (await db.templates.get('tpl-upper-1'))!;
    expect(factory.updatedAt).toBeLessThan(edited.updatedAt);

    await importData(backup);
    expect((await db.templates.get('tpl-upper-1'))!.name).toBe('Upper Body A');
  });
});

describe('single-side (L/R) sets', () => {
  const UNILATERAL_SETS = [
    { target: { type: 'reps', reps: 10 } as const, load: { type: 'kg', kg: 12 } as const, side: 'L' as const },
    { target: { type: 'reps', reps: 10 } as const, load: { type: 'kg', kg: 12 } as const, side: 'R' as const },
    { target: { type: 'reps', reps: 10 } as const, load: { type: 'kg', kg: 12 } as const, side: 'L' as const },
    { target: { type: 'reps', reps: 10 } as const, load: { type: 'kg', kg: 12 } as const, side: 'R' as const },
  ];

  async function unilateralTemplate() {
    const template = await createTemplate({ name: 'Side Test', kind: 'gym' });
    const exercise = await createExercise({
      name: 'Single-leg press',
      category: 'strength',
      unilateral: true,
    });
    await addExerciseToTemplate(template.id, 'primary', {
      exerciseId: exercise.id,
      restAfterSec: 60,
      sets: UNILATERAL_SETS,
    });
    return { template, exercise };
  }

  it('builds a session with the sides intact and alternating', async () => {
    const { template } = await unilateralTemplate();
    const session = await startSession(template.id);
    const sets = session.sections[0].groups[0].members[0].sets;
    expect(sets.map((s) => s.side)).toEqual(['L', 'R', 'L', 'R']);
    expect(sets.every((s) => s.done === false)).toBe(true);
  });

  it('carries sides through copy-forward, and each side keeps its own numbers', async () => {
    const { template } = await unilateralTemplate();
    const first = await startSession(template.id);
    const sets = first.sections[0].groups[0].members[0].sets;
    // the rehabbing right side manages fewer reps at a lighter load
    sets[0].actualReps = 10;
    sets[1].actualReps = 7;
    sets[1].load = { type: 'kg', kg: 8 };
    for (const set of sets) set.done = true;
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 7, endingFatigue: 5 });

    const next = await startSession(template.id);
    const nextSets = next.sections[0].groups[0].members[0].sets;
    expect(nextSets.map((s) => s.side)).toEqual(['L', 'R', 'L', 'R']);
    // the asymmetric load carried forward on the right only
    expect(nextSets[0].load).toEqual({ type: 'kg', kg: 12 });
    expect(nextSets[1].load).toEqual({ type: 'kg', kg: 8 });
    expect(nextSets.every((s) => !s.done)).toBe(true);
  });

  it('leaves bilateral exercises without any side', async () => {
    const session = await startSession('tpl-upper-1');
    const allSets = session.sections.flatMap((sec) => sec.groups).flatMap((g) => g.members).flatMap((m) => m.sets);
    expect(allSets.every((s) => s.side === undefined)).toBe(true);
  });

  it('survives a backup round-trip with sides preserved', async () => {
    const { template } = await unilateralTemplate();
    await startSession(template.id);
    const backup = await exportAllData();
    await db.sessions.clear();
    await importData(backup);
    const restored = (await db.sessions.toArray())[0];
    expect(restored.sections[0].groups[0].members[0].sets.map((s) => s.side)).toEqual([
      'L',
      'R',
      'L',
      'R',
    ]);
  });
});

describe('by-feel vs prescribed exercises (F1)', () => {
  it('carries the flag from template into the session, and through copy-forward', async () => {
    const template = await createTemplate({ name: 'Warmup Test', kind: 'gym' });
    const ex = await createExercise({ name: 'Band pull-apart', category: 'movement', unilateral: false });
    await addExerciseToTemplate(template.id, 'warmup', {
      exerciseId: ex.id,
      byFeel: false, // a warm-up exercise WITH real numbers
      restAfterSec: 30,
      sets: [{ target: { type: 'reps', reps: 15 }, load: { type: 'band' } }],
    });

    const first = await startSession(template.id);
    const member = first.sections[0].groups[0].members[0];
    expect(member.byFeel).toBe(false);

    for (const set of member.sets) set.done = true;
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 6, endingFatigue: 4 });

    const next = await startSession(template.id);
    expect(next.sections[0].groups[0].members[0].byFeel).toBe(false);
  });

  it('leaves the flag absent when the exercise follows its section', async () => {
    const session = await startSession('tpl-upper-1');
    const all = session.sections.flatMap((s) => s.groups).flatMap((g) => g.members);
    expect(all.every((m) => m.byFeel === undefined)).toBe(true);
  });
});

describe('cardio sessions (F11)', () => {
  it('seeds the starter activity list once, then leaves it alone', async () => {
    const first = await listActivities();
    expect(first.map((a) => a.name)).toEqual([
      'Boxing', 'Indoor bike', 'Mobility', 'Padel', 'Stretching', 'Treadmill', 'Yoga',
    ]);

    // A second call must not duplicate them, and must keep anything the user added.
    await createExercise({ name: 'Rowing', category: 'cardio', unilateral: false });
    const second = await listActivities();
    expect(second.map((a) => a.name)).toContain('Rowing');
    expect(second).toHaveLength(8);
  });

  it('logs a complete session — no active workout is left open', async () => {
    const [activity] = await listActivities();
    const session = await logActivitySession({ activityId: activity.id, durationMin: 45, intensity: 6 });

    expect(session.status).toBe('done');
    expect(session.durationMin).toBe(45);
    expect(session.overallEffort).toBe(6);
    expect(await getActiveSession()).toBeUndefined();

    const set = session.sections[0].groups[0].members[0].sets[0];
    expect(set.actualSeconds).toBe(45 * 60);
    expect(set.done).toBe(true);
  });

  it('reuses one template per activity, so history groups and numbers carry forward', async () => {
    const [activity] = await listActivities();
    const a = await logActivitySession({ activityId: activity.id, durationMin: 30, intensity: 5 });
    const b = await logActivitySession({ activityId: activity.id, durationMin: 40, intensity: 7 });
    expect(b.templateId).toBe(a.templateId);

    const template = await getTemplate(a.templateId);
    expect(template?.kind).toBe('cardio');
    expect(template?.name).toBe(activity.name);
  });

  it('appears in history alongside gym workouts', async () => {
    const [activity] = await listActivities();
    await logActivitySession({ activityId: activity.id, durationMin: 30, intensity: 5 });
    const gym = await startSession('tpl-upper-1');
    await finishSession(gym.id, { overallEffort: 7, endingFatigue: 5 });

    expect(await listDoneSessions()).toHaveLength(2);
  });

  it('rejects an unknown activity', async () => {
    await expect(
      logActivitySession({ activityId: 'nope', durationMin: 20, intensity: 5 }),
    ).rejects.toThrow(/Activity not found/);
  });
});

describe('backdated sessions (F10)', () => {
  it('logs cardio under a past date and stamps the clock on that day', async () => {
    const [activity] = await listActivities();
    const session = await logActivitySession({
      activityId: activity.id,
      date: '2026-09-10',
      durationMin: 25,
      intensity: 4,
    });
    expect(session.date).toBe('2026-09-10');
    expect(new Date(session.startedAt).toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('moves a finished workout to another date, keeping its time of day', async () => {
    const gym = await startSession('tpl-upper-1');
    await finishSession(gym.id, { overallEffort: 7, endingFatigue: 5 });
    const before = await db.sessions.get(gym.id);
    const hour = new Date(before!.startedAt).getHours();

    await setSessionDate(gym.id, '2026-09-11');

    const after = await db.sessions.get(gym.id);
    expect(after!.date).toBe('2026-09-11');
    expect(new Date(after!.startedAt).getHours()).toBe(hour);
    expect(after!.finishedAt).toBeDefined();
  });

  it('rejects a malformed date and no-ops on an unchanged one', async () => {
    const gym = await startSession('tpl-upper-1');
    await finishSession(gym.id, { overallEffort: 7, endingFatigue: 5 });
    const before = await db.sessions.get(gym.id);

    await expect(setSessionDate(gym.id, '11-09-2026')).rejects.toThrow(/Bad date/);
    await setSessionDate(gym.id, before!.date);
    expect((await db.sessions.get(gym.id))!.updatedAt).toBe(before!.updatedAt);
  });

  it('a backdated session does not become the copy-forward basis', async () => {
    // Log today's workout with a distinctive load, then insert an older one.
    const recent = await startSession('tpl-lower-1');
    const deadlift = recent.sections
      .flatMap((s) => s.groups).flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-deadlift')!;
    deadlift.sets.at(-1)!.load = { type: 'kg', kg: 140 };
    for (const set of deadlift.sets) set.done = true;
    await updateSession(recent);
    await finishSession(recent.id, { overallEffort: 8, endingFatigue: 5 });

    const older = await startSession('tpl-lower-1');
    const olderDeadlift = older.sections
      .flatMap((s) => s.groups).flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-deadlift')!;
    olderDeadlift.sets.at(-1)!.load = { type: 'kg', kg: 90 };
    for (const set of olderDeadlift.sets) set.done = true;
    await updateSession(older);
    await finishSession(older.id, { overallEffort: 6, endingFatigue: 4 });
    await setSessionDate(older.id, '2026-01-01');

    const next = await startSession('tpl-lower-1');
    const nextDeadlift = next.sections
      .flatMap((s) => s.groups).flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-deadlift')!;
    expect(nextDeadlift.sets.at(-1)!.load).toEqual({ type: 'kg', kg: 140 });
  });
});

describe('cardio heart rate (optional)', () => {
  it('stores avg and max when given', async () => {
    const [activity] = await listActivities();
    const session = await logActivitySession({
      activityId: activity.id,
      durationMin: 40,
      intensity: 7,
      avgHeartRate: 142,
      maxHeartRate: 171,
    });
    expect(session.avgHeartRate).toBe(142);
    expect(session.maxHeartRate).toBe(171);
  });

  it('leaves both absent when not supplied — logging never waits on a reading', async () => {
    const [activity] = await listActivities();
    const session = await logActivitySession({ activityId: activity.id, durationMin: 20, intensity: 5 });
    expect(session.avgHeartRate).toBeUndefined();
    expect(session.maxHeartRate).toBeUndefined();
  });

  it('records one without the other', async () => {
    const [activity] = await listActivities();
    const session = await logActivitySession({
      activityId: activity.id, durationMin: 20, intensity: 5, maxHeartRate: 168,
    });
    expect(session.avgHeartRate).toBeUndefined();
    expect(session.maxHeartRate).toBe(168);
  });
});

describe('Padel spelling', () => {
  it('corrects an already-seeded "Paddle" in place, template included', async () => {
    const wrong = await createExercise({ name: 'Paddle', category: 'cardio', unilateral: false });
    await logActivitySession({ activityId: wrong.id, durationMin: 60, intensity: 7 });

    const list = await listActivities();
    expect(list.map((a) => a.name)).toContain('Padel');
    expect(list.map((a) => a.name)).not.toContain('Paddle');

    const templates = await listTemplates();
    expect(templates.filter((t) => t.kind === 'cardio').map((t) => t.name)).toEqual(['Padel']);
  });
});

describe('yoga and other timed activities', () => {
  it('tops up starter activities added after the list was first seeded', async () => {
    // Simulate an install from before yoga existed.
    await db.exercises.bulkPut(
      ['Indoor bike', 'Padel'].map((name, i) => ({
        id: `legacy-${i}`, userId: CURRENT_USER, name, category: 'cardio' as const,
        unilateral: false, defaultIntensity: 7, updatedAt: 1,
      })),
    );

    const list = await listActivities();
    const names = list.map((a) => a.name);
    expect(names).toContain('Yoga');
    expect(names).toContain('Stretching');
    // and it did not duplicate what was already there
    expect(names.filter((n) => n === 'Padel')).toHaveLength(1);
  });

  it('logs an hour of yoga the same way as cardio', async () => {
    const yoga = (await listActivities()).find((a) => a.name === 'Yoga')!;
    const session = await logActivitySession({
      activityId: yoga.id, durationMin: 60, intensity: 4,
    });

    expect(session.status).toBe('done');
    expect(session.durationMin).toBe(60);
    const set = session.sections[0].groups[0].members[0].sets[0];
    expect(set.actualSeconds).toBe(3600);

    const template = await getTemplate(session.templateId);
    expect(template?.name).toBe('Yoga');
  });
});

describe('deload set cut', () => {
  it('drops warm-up ramp sets before working sets', async () => {
    const first = await startSession('tpl-upper-1', 'build');
    const pull = first.sections.flatMap((s) => s.groups).flatMap((g) => g.members).find((m) => m.exerciseId === 'ex-pull-ups')!;
    pull.sets = [
      { target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 20 }, warmup: true, done: true, actualReps: 10 },
      { target: { type: 'reps', reps: 8 }, load: { type: 'kg', kg: 40 }, done: true, actualReps: 8 },
      { target: { type: 'reps', reps: 6 }, load: { type: 'kg', kg: 40 }, done: true, actualReps: 6 },
      { target: { type: 'reps', reps: 6 }, load: { type: 'kg', kg: 40 }, done: true, actualReps: 6 },
    ];
    await updateSession(first);
    await finishSession(first.id, { overallEffort: 8, endingFatigue: 5 });

    const deload = await startSession('tpl-upper-1', 'deload');
    const sets = deload.sections.flatMap((s) => s.groups).flatMap((g) => g.members).find((m) => m.exerciseId === 'ex-pull-ups')!.sets;
    expect(sets.some((s) => s.warmup)).toBe(false);
    expect(sets.every((s) => s.load.type === 'kg' && s.load.kg === 25)).toBe(true);
  });
});

describe('cancelling a workout', () => {
  it('stays cancelled when an older copy comes back from sync', async () => {
    const session = await startSession('tpl-lower-1');
    const cloudCopy = structuredClone(session); // what the server still holds
    await cancelSession(session.id);
    expect(await getActiveSession()).toBeUndefined();

    // A sync re-imports the server's older, still-active version.
    await importData({
      format: 'fitbuddy-backup',
      version: 1,
      exportedAt: 0,
      data: { exercises: [], templates: [], sessions: [cloudCopy], feedback: [] },
    });
    expect(await getActiveSession()).toBeUndefined();
    expect((await listDoneSessions()).map((s) => s.id)).not.toContain(session.id);
  });
});
