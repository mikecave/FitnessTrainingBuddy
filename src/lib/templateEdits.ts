// Carrying a superset change made mid-workout back into the template.
//
// The template owns structure (F5, Option B): next week's session is built from
// its groups, so a superset paired or broken only in the session would be
// undone next time. `regroupInTemplate` makes the template's grouping of these
// exercises match the session's.
//
// Pure, and kept out of repo.ts so it can be tested directly.

import type { GroupMember, SectionKind, Template } from '../data/types';

const SECTION_ORDER: SectionKind[] = ['warmup', 'primary', 'secondary', 'cooldown'];

/** Make `members` one group in the template's `kind` section, in this order.
 *
 *  - Each exercise is taken out of wherever it sits in the template (any
 *    section, since a mid-workout join can cross sections), and groups left
 *    empty are dropped.
 *  - An exercise already in the template keeps the TEMPLATE's prescription —
 *    the template owns targets, and today's numbers already copy forward on
 *    their own. Only an exercise new to the template takes the one given.
 *  - The group lands where the first of these exercises used to be: in its old
 *    group's place if that group emptied, else just after it. So unpairing one
 *    exercise out of a superset leaves it directly below, as in the session.
 *    If none was in this section before, it goes at the end. */
export function regroupInTemplate(
  template: Template,
  kind: SectionKind,
  members: GroupMember[],
): Template {
  const ids = new Set(members.map((m) => m.exerciseId));
  const existing = new Map<string, GroupMember>();
  for (const section of template.sections) {
    for (const group of section.groups) {
      for (const m of group.members) {
        if (ids.has(m.exerciseId) && !existing.has(m.exerciseId)) existing.set(m.exerciseId, m);
      }
    }
  }
  const newGroup = { members: members.map((m) => existing.get(m.exerciseId) ?? m) };

  let sections = template.sections;
  if (!sections.some((s) => s.kind === kind)) {
    const at = sections.findIndex((s) => SECTION_ORDER.indexOf(s.kind) > SECTION_ORDER.indexOf(kind));
    const fresh = {
      kind,
      logging: kind === 'primary' || kind === 'secondary' ? ('tracked' as const) : ('loose' as const),
      groups: [],
    };
    sections = at === -1 ? [...sections, fresh] : [...sections.slice(0, at), fresh, ...sections.slice(at)];
  }

  return {
    ...template,
    sections: sections.map((section) => {
      const groups: GroupMember[][] = [];
      let insertAt = -1;
      for (const group of section.groups) {
        const touched = group.members.some((m) => ids.has(m.exerciseId));
        const kept = group.members.filter((m) => !ids.has(m.exerciseId));
        if (kept.length > 0) groups.push(kept);
        if (touched && insertAt === -1 && section.kind === kind) insertAt = groups.length;
      }
      if (section.kind === kind) {
        groups.splice(insertAt === -1 ? groups.length : insertAt, 0, newGroup.members);
      }
      return { ...section, groups: groups.map((m) => ({ members: m })) };
    }),
  };
}
