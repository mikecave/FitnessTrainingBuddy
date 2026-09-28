// Structural edits to a live session — the ones that change which exercises
// are in it, rather than what was logged against them.
//
// Kept out of the screen component so they can be tested directly: getting an
// index-based removal wrong mid-workout means deleting the wrong movement's
// logged sets, which is unrecoverable.

import type { GroupMember, LoggedSet, Session, SessionExercise } from '../data/types';
import { isByFeel } from './logging';

export interface SessionPath {
  si: number;
  gi: number;
  mi: number;
}

/** Drop one exercise from a session.
 *
 *  An emptied group goes with it (a superset that loses a member collapses to
 *  straight sets, and a group with nothing in it would render as a blank card),
 *  but the section stays even when empty: sections carry their own description
 *  and the warm-up's starting-fatigue reading, and a section vanishing from
 *  under you mid-workout also takes away the place to add an exercise back. */
export function removeMemberAt(session: Session, path: SessionPath): Session {
  return {
    ...session,
    sections: session.sections.map((section, si) =>
      si !== path.si
        ? section
        : {
            ...section,
            groups: section.groups
              .map((group, gi) =>
                gi !== path.gi
                  ? group
                  : { ...group, members: group.members.filter((_, mi) => mi !== path.mi) },
              )
              .filter((group) => group.members.length > 0),
          },
    ),
  };
}

/** How many logged sets a removal would discard — the number worth showing on
 *  the confirm, since those are gone for good. */
export function loggedSetCount(session: Session, path: SessionPath): number {
  const member = session.sections[path.si]?.groups[path.gi]?.members[path.mi];
  return member ? member.sets.filter((s) => s.done).length : 0;
}

export interface GroupPos {
  si: number;
  gi: number;
}

function sameGroup(a: GroupPos, b: GroupPos): boolean {
  return a.si === b.si && a.gi === b.gi;
}

/** Superset two groups mid-workout: `from`'s exercises are appended to `into`,
 *  and `from`'s card goes. Covers every case with one rule — two straight sets
 *  become a superset, a straight set joins an existing superset, or two
 *  supersets merge. `into` keeps its place, since it is the one the user picked as
 *  the destination. Across sections is allowed: the joined exercises move into
 *  `into`'s section. Logged sets travel with their exercise untouched. */
export function joinGroups(session: Session, from: GroupPos, into: GroupPos): Session {
  if (sameGroup(from, into)) return session;
  const moving = session.sections[from.si]?.groups[from.gi];
  if (!moving || !session.sections[into.si]?.groups[into.gi]) return session;
  return {
    ...session,
    sections: session.sections.map((section, si) => ({
      ...section,
      groups: section.groups
        .map((group, gi) => {
          if (si === into.si && gi === into.gi) {
            return { ...group, members: [...group.members, ...moving.members] };
          }
          return group;
        })
        .filter((_, gi) => !(si === from.si && gi === from.gi)),
    })),
  };
}

/** Take one exercise out of a superset into its own straight-sets card, placed
 *  just below the superset. No-op on a group that is already straight sets. */
export function splitMember(session: Session, path: SessionPath): Session {
  const group = session.sections[path.si]?.groups[path.gi];
  const member = group?.members[path.mi];
  if (!group || !member || group.members.length < 2) return session;
  return {
    ...session,
    sections: session.sections.map((section, si) =>
      si !== path.si
        ? section
        : {
            ...section,
            groups: section.groups.flatMap((g, gi) =>
              gi !== path.gi
                ? [g]
                : [{ ...g, members: g.members.filter((_, mi) => mi !== path.mi) }, { members: [member] }],
            ),
          },
    ),
  };
}

/** Add an exercise straight into an existing group (making or growing a superset). */
export function addMemberToSessionGroup(
  session: Session,
  pos: GroupPos,
  member: SessionExercise,
): Session {
  return {
    ...session,
    sections: session.sections.map((section, si) =>
      si !== pos.si
        ? section
        : {
            ...section,
            groups: section.groups.map((g, gi) =>
              gi === pos.gi ? { ...g, members: [...g.members, member] } : g,
            ),
          },
    ),
  };
}

/** Take the last set off (a pair, for sided work), remembering it so a later
 *  "＋ add set" restores the same numbers. */
export function withoutLastSet(member: SessionExercise): SessionExercise {
  const n = member.sets.at(-1)?.side ? 2 : 1;
  if (member.sets.length <= n) return member;
  return {
    ...member,
    sets: member.sets.slice(0, -n),
    removedSets: [...(member.removedSets ?? []), ...member.sets.slice(-n)],
  };
}

/** One more set. If sets were removed today, the most recently removed one
 *  comes back as it was — so deleting down to one and building back up
 *  returns the original prescription, set by set. Otherwise a copy of the
 *  last set: AMRAP stays AMRAP, everything else keeps target/load/mainWork/
 *  warm-up with fresh logging state. Sided work grows a pair at a time (L then
 *  R) so the sides never drift. */
export function withExtraSet(member: SessionExercise): SessionExercise {
  const last = member.sets.at(-1);
  const removed = member.removedSets ?? [];
  const n = last?.side ? 2 : 1;
  if (removed.length >= n) {
    const restored = removed.slice(-n).map((s) => ({ ...s, done: false }));
    const rest = removed.slice(0, -n);
    return {
      ...member,
      sets: [...member.sets, ...restored],
      removedSets: rest.length ? rest : undefined,
    };
  }
  const fresh: LoggedSet = last
    ? {
        target: last.target.type === 'amrap' ? { type: 'amrap' } : last.target,
        load: last.load,
        ...(last.mainWork ? { mainWork: true } : {}),
        ...(last.warmup ? { warmup: true } : {}),
        done: false,
      }
    : { target: { type: 'reps', reps: 8 }, load: { type: 'bw' }, done: false };
  if (last?.side) {
    return {
      ...member,
      sets: [...member.sets, { ...fresh, side: 'L' }, { ...fresh, side: 'R' }],
    };
  }
  return { ...member, sets: [...member.sets, fresh] };
}

/** One more round of a superset: an extra set on every exercise in it that is
 *  being logged by numbers today (skipped and by-feel ones are left alone). */
export function addRound(session: Session, pos: GroupPos): Session {
  return {
    ...session,
    sections: session.sections.map((section, si) =>
      si !== pos.si
        ? section
        : {
            ...section,
            groups: section.groups.map((g, gi) =>
              gi !== pos.gi
                ? g
                : {
                    ...g,
                    members: g.members.map((m) =>
                      m.skipped || isByFeel(section, m) ? m : withExtraSet(m),
                    ),
                  },
            ),
          },
    ),
  };
}

/** Where the group holding this exercise sits now. Structural edits shift
 *  indices, so anything that must find "that superset" again later keys on an
 *  exercise it contains rather than on a stored position. */
export function findGroupOf(session: Session, exerciseId: string): GroupPos | null {
  for (const [si, section] of session.sections.entries()) {
    for (const [gi, group] of section.groups.entries()) {
      if (group.members.some((m) => m.exerciseId === exerciseId)) return { si, gi };
    }
  }
  return null;
}

/** A session exercise as a template prescription: structure and numbers, none
 *  of today's logging state. */
export function memberToGroupMember(member: SessionExercise): GroupMember {
  return {
    exerciseId: member.exerciseId,
    restAfterSec: member.restAfterSec,
    intensity: member.intensity,
    ...(member.byFeel !== undefined ? { byFeel: member.byFeel } : {}),
    ...(member.variationNote ? { variationNote: member.variationNote } : {}),
    sets: member.sets.map((s) => ({
      target: s.target,
      load: s.load,
      ...(s.side ? { side: s.side } : {}),
      ...(s.mainWork ? { mainWork: true } : {}),
      ...(s.warmup ? { warmup: true } : {}),
    })),
  };
}
