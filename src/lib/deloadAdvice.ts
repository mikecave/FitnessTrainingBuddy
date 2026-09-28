// "Week 4 and stalling — make this a deload?" (backlog: deload/staleness
// suggestions). The app already records cycles via Session.weekType; this is
// the part that notices one is due.
//
// Deliberately a few plain, explainable rules rather than a score, so the
// banner can say exactly why it is asking — and the user can tell whether the rule
// is right. Starting thresholds, to be tuned from real use:
//
//   - STALLING: at least half the lifts with 3+ workouts in the current cycle
//     haven't improved over their last 3 (improved = heavier top set, or more
//     reps at the same weight — see lib/progression.ts);
//   - LONG CYCLE: 5+ workouts of this template since its last deload (the
//     published norm is a deload every ~4–8 weeks, 5.6 on average);
//   - FATIGUE: today's starting fatigue is 8/10 or more.
//
// Any one of them triggers the suggestion. Only this template's workouts
// count: a stalled lower-body day says nothing about the upper-body one.

import type { Session } from '../data/types';
import { progressFor } from './progression';

export const STALL_WINDOW = 3;
export const LONG_CYCLE = 5;
export const HIGH_FATIGUE = 8;

export interface DeloadAdvice {
  suggest: boolean;
  reasons: string[];
  /** Workouts of this template since its last deload. */
  sinceDeload: number;
}

/** Did this lift improve across its last STALL_WINDOW workouts? */
function stalled(sessions: Session[], exerciseId: string): boolean | undefined {
  const points = progressFor(sessions, exerciseId).points.slice(-STALL_WINDOW);
  if (points.length < STALL_WINDOW) return undefined; // not enough history to judge
  const first = points[0];
  const last = points[points.length - 1];
  if (last.value > first.value) return false;
  if (last.value === first.value && (last.reps ?? 0) > (first.reps ?? 0)) return false;
  return true;
}

export function deloadAdvice(
  current: Session,
  /** Finished workouts of the same template, any order. */
  history: Session[],
  exerciseIds: string[],
): DeloadAdvice {
  const done = history
    .filter((s) => s.status === 'done' && s.id !== current.id && s.templateId === current.templateId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt);
  const lastDeload = done.map((s) => s.weekType).lastIndexOf('deload');
  const cycle = done.slice(lastDeload + 1);

  const reasons: string[] = [];

  const judged = [...new Set(exerciseIds)]
    .map((id) => stalled(cycle, id))
    .filter((x): x is boolean => x !== undefined);
  const stalledCount = judged.filter(Boolean).length;
  if (judged.length > 0 && stalledCount * 2 >= judged.length) {
    reasons.push(
      `${stalledCount} of ${judged.length} lifts haven't gone up in their last ${STALL_WINDOW} workouts`,
    );
  }

  if (cycle.length >= LONG_CYCLE) {
    reasons.push(`${cycle.length} workouts of this since the last deload`);
  }

  if ((current.startingFatigue ?? 0) >= HIGH_FATIGUE) {
    reasons.push(`starting fatigue is ${current.startingFatigue}/10`);
  }

  return { suggest: reasons.length > 0, reasons, sinceDeload: cycle.length };
}
