// Whether one exercise is logged by feel (a tick) or by numbers (set rows).
//
// `Section.logging` sets the default for its exercises, but a single warm-up
// legitimately mixes both: "3×10 @ 20kg" next to "mobilise until it feels
// right". `byFeel` on the member overrides the section either way.
//
// Resolving through this helper (rather than reading `section.logging`
// directly) keeps existing data rendering exactly as before: members with no
// flag simply inherit the section, which is what every record had before the
// field existed.

import type { GroupMember, Section, SessionExercise, SessionSection } from '../data/types';

export function isByFeel(
  section: Pick<Section | SessionSection, 'logging'>,
  member: Pick<GroupMember | SessionExercise, 'byFeel'>,
): boolean {
  return member.byFeel ?? section.logging === 'loose';
}
