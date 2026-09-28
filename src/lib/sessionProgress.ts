// How much of a workout is actually logged.
//
// Finishing used to save silently, so a session left half-logged (phone
// pocketed mid-workout, "finish" tapped out of habit) became permanent history
// with no warning. This measures what is outstanding so the Finish button can
// ask first.
//
// Skipped exercises are deliberately not outstanding — a skip IS a decision.
// Tracked sets and loose checklist items are counted separately: an unlogged
// working set is a hole in the record, whereas an unticked "mobility, by feel"
// warm-up item is milder, and the prompt reads better when it can say which.

import type { Session } from '../data/types';

export interface SessionProgress {
  /** Sets in tracked sections that are neither done nor skipped. */
  unloggedSets: number;
  /** Exercises those sets belong to. */
  unloggedExercises: number;
  /** Unticked exercises in loose (checklist) sections. */
  uncheckedItems: number;
}

export function sessionProgress(session: Session): SessionProgress {
  let unloggedSets = 0;
  let unloggedExercises = 0;
  let uncheckedItems = 0;

  for (const section of session.sections) {
    for (const group of section.groups) {
      for (const member of group.members) {
        if (member.skipped) continue;

        if (section.logging === 'loose') {
          // A loose member is one checklist tick covering all its sets.
          if (member.sets.length > 0 && !member.sets.every((s) => s.done)) uncheckedItems++;
          continue;
        }

        const pending = member.sets.filter((s) => !s.done).length;
        if (pending > 0) {
          unloggedSets += pending;
          unloggedExercises++;
        }
      }
    }
  }

  return { unloggedSets, unloggedExercises, uncheckedItems };
}

/** Nothing outstanding at all — the workout is complete as logged. */
export function isFullyLogged(p: SessionProgress): boolean {
  return p.unloggedSets === 0 && p.uncheckedItems === 0;
}

/** "3 sets across 2 exercises · 1 warm-up item" — the body of the confirm. */
export function describeOutstanding(p: SessionProgress): string {
  const parts: string[] = [];
  if (p.unloggedSets > 0) {
    parts.push(
      `${p.unloggedSets} set${p.unloggedSets === 1 ? '' : 's'} not logged` +
        ` across ${p.unloggedExercises} exercise${p.unloggedExercises === 1 ? '' : 's'}`,
    );
  }
  if (p.uncheckedItems > 0) {
    parts.push(`${p.uncheckedItems} checklist item${p.uncheckedItems === 1 ? '' : 's'} unticked`);
  }
  return parts.join(' · ');
}
