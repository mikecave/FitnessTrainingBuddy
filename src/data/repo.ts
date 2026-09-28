// The data layer. ALL reads/writes go through this module so a sync engine
// (or multi-user scoping) can be added underneath without touching the UI.

import { monotonicFactory } from 'ulid';

// Monotonic: ids minted within the same millisecond still sort by creation
// order. Plain ulid() randomises the tail, which made same-millisecond
// ordering (e.g. two feedback notes jotted together) non-deterministic.
const ulid = monotonicFactory();
import { db } from './db';
import { seedExercises, seedTemplates } from './seed';
import { regroupInTemplate } from '../lib/templateEdits';
import { isByFeel } from '../lib/logging';
import {
  CURRENT_USER,
  type BackupFile,
  type Feedback,
  type Observation,
  type Category,
  type Exercise,
  type GroupMember,
  type ImportMode,
  type ImportSummary,
  type LoggedSet,
  type PlannedSet,
  type Section,
  type Load,
  type SectionKind,
  type WeekType,
  type Session,
  type SessionExercise,
  type SessionSection,
  type TableImportCounts,
  type Template,
  type TemplateGroup,
} from './types';

export async function ensureSeeded(): Promise<void> {
  const count = await db.templates.count();
  if (count === 0) {
    await db.transaction('rw', db.exercises, db.templates, async () => {
      await db.exercises.bulkPut(seedExercises);
      await db.templates.bulkPut(seedTemplates);
    });
  }
  // Ask the browser not to evict our data under storage pressure.
  if (navigator.storage?.persist) {
    try {
      await navigator.storage.persist();
    } catch {
      // non-fatal
    }
  }
}

export function listTemplates(): Promise<Template[]> {
  return db.templates.orderBy('name').toArray();
}

export function getTemplate(id: string): Promise<Template | undefined> {
  return db.templates.get(id);
}

export function listExercises(): Promise<Exercise[]> {
  return db.exercises.toArray();
}

export async function exerciseMap(): Promise<Map<string, Exercise>> {
  const all = await listExercises();
  return new Map(all.map((e) => [e.id, e]));
}

export async function createExercise(input: {
  name: string;
  category: Category;
  unilateral: boolean;
}): Promise<Exercise> {
  const exercise: Exercise = {
    id: ulid(),
    userId: CURRENT_USER,
    name: input.name,
    category: input.category,
    unilateral: input.unilateral,
    defaultIntensity: DEFAULT_INTENSITY,
    updatedAt: Date.now(),
  };
  await db.exercises.add(exercise);
  return exercise;
}

const SECTION_ORDER: SectionKind[] = ['warmup', 'primary', 'secondary', 'cooldown'];

export async function createTemplate(input: {
  name: string;
  kind: 'gym' | 'micro' | 'cardio';
  timeCapMin?: number;
  group?: TemplateGroup;
  /** Deep-copies the source template's sections (prescriptions included). */
  copyFromTemplateId?: string;
}): Promise<Template> {
  let sections: Section[] = [];
  if (input.copyFromTemplateId) {
    const source = await db.templates.get(input.copyFromTemplateId);
    if (!source) {
      throw new Error(`Template not found: ${input.copyFromTemplateId}`);
    }
    sections = structuredClone(source.sections);
  }

  const template: Template = {
    id: ulid(),
    userId: CURRENT_USER,
    name: input.name,
    kind: input.kind,
    ...(input.group ? { group: input.group } : {}),
    ...(input.timeCapMin ? { timeCapMin: input.timeCapMin } : {}),
    sections,
    updatedAt: Date.now(),
  };
  await db.templates.add(template);
  return template;
}

/** Promote an exercise into a template: appended as a new straight-sets group. Creates the section if the template lacks it. */
export async function addExerciseToTemplate(
  templateId: string,
  sectionKind: SectionKind,
  member: GroupMember,
): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  let section = template.sections.find((s) => s.kind === sectionKind);
  if (!section) {
    section = {
      kind: sectionKind,
      logging: sectionKind === 'primary' || sectionKind === 'secondary' ? 'tracked' : 'loose',
      groups: [],
    };
    const insertAt = template.sections.findIndex(
      (s) => SECTION_ORDER.indexOf(s.kind) > SECTION_ORDER.indexOf(sectionKind),
    );
    if (insertAt === -1) template.sections.push(section);
    else template.sections.splice(insertAt, 0, section);
  }

  section.groups.push({ members: [member] });
  await db.templates.put({ ...template, updatedAt: Date.now() });
}

/** Put a template on a Home tab (Upper / Lower / The rest). */
export async function setTemplateGroup(templateId: string, group: TemplateGroup): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  await db.templates.put({ ...template, group, updatedAt: Date.now() });
}

/** Rename a template. Blank names are ignored rather than saved. */
export async function renameTemplate(templateId: string, name: string): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  const trimmed = name.trim();
  if (!trimmed || trimmed === template.name) return;
  await db.templates.put({ ...template, name: trimmed, updatedAt: Date.now() });
}

/** Pair an exercise into an existing group — straight sets become a superset, a superset gains a member. */
export async function addMemberToGroup(
  templateId: string,
  si: number,
  gi: number,
  member: GroupMember,
): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  const group = template.sections[si]?.groups[gi];
  if (!group) {
    throw new Error(`No group at ${si}/${gi} in template ${templateId}`);
  }
  group.members.push(member);
  await db.templates.put({ ...template, updatedAt: Date.now() });
}

/** Break one member out of a superset into its own straight-sets group placed just below. No-op on a single-member group. */
export async function splitMemberFromGroup(
  templateId: string,
  si: number,
  gi: number,
  mi: number,
): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  const section = template.sections[si];
  const group = section?.groups[gi];
  const member = group?.members[mi];
  if (!group || !member) {
    throw new Error(`No member at ${si}/${gi}/${mi} in template ${templateId}`);
  }
  if (group.members.length < 2) return;
  section.groups = [
    ...section.groups.slice(0, gi),
    { ...group, members: group.members.filter((_, k) => k !== mi) },
    { members: [member] },
    ...section.groups.slice(gi + 1),
  ];
  await db.templates.put({ ...template, updatedAt: Date.now() });
}

/** Carry a mid-workout superset change into the template, so next week's
 *  session is built with the same grouping. See lib/templateEdits.ts. */
export async function regroupTemplate(
  templateId: string,
  kind: SectionKind,
  members: GroupMember[],
): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  await db.templates.put({ ...regroupInTemplate(template, kind, members), updatedAt: Date.now() });
}

/** Update library-level exercise fields. A rename applies everywhere the exercise appears (templates, history views) since they all render by exerciseId. */
export async function updateExercise(
  id: string,
  updates: Partial<Pick<Exercise, 'name' | 'category' | 'unilateral' | 'stickyModifier' | 'notes'>>,
): Promise<void> {
  const exercise = await db.exercises.get(id);
  if (!exercise) {
    throw new Error(`Exercise not found: ${id}`);
  }
  await db.exercises.put({ ...exercise, ...updates, updatedAt: Date.now() });
}

/** Replace one exercise slot's prescription (sets, rest, intensity, variation note) in a template. */
export async function updateMemberInTemplate(
  templateId: string,
  si: number,
  gi: number,
  mi: number,
  member: GroupMember,
): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  if (!template.sections[si]?.groups[gi]?.members[mi]) {
    throw new Error(`No member at ${si}/${gi}/${mi} in template ${templateId}`);
  }
  template.sections[si].groups[gi].members[mi] = member;
  await db.templates.put({ ...template, updatedAt: Date.now() });
}

/** Reorder groups within one section of a template. */
export async function moveGroupInTemplate(
  templateId: string,
  si: number,
  fromGi: number,
  toGi: number,
): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  const section = template.sections[si];
  const max = section ? section.groups.length - 1 : -1;
  if (!section || fromGi < 0 || fromGi > max || toGi < 0 || toGi > max) {
    throw new Error(`Bad group move ${fromGi}->${toGi} in section ${si} of ${templateId}`);
  }
  const groups = [...section.groups];
  const [moved] = groups.splice(fromGi, 1);
  groups.splice(toGi, 0, moved);
  template.sections[si] = { ...section, groups };
  await db.templates.put({ ...template, updatedAt: Date.now() });
}

/** Remove one exercise slot from a template. Empty groups are dropped; a section survives only if it still has groups or a description worth keeping. */
export async function removeMemberFromTemplate(
  templateId: string,
  si: number,
  gi: number,
  mi: number,
): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const sections = template.sections
    .map((section, i) =>
      i !== si
        ? section
        : {
            ...section,
            groups: section.groups
              .map((group, j) =>
                j !== gi ? group : { ...group, members: group.members.filter((_, k) => k !== mi) },
              )
              .filter((group) => group.members.length > 0),
          },
    )
    .filter((section) => section.groups.length > 0 || section.description);

  await db.templates.put({ ...template, sections, updatedAt: Date.now() });
}

/** Remove an exercise from a template by *identity*, not by position.
 *
 *  The live session is where this gets called from, and its indices drift from
 *  the template's the moment anything is reordered, added ad hoc or unpaired
 *  mid-workout — so a positional path from a session would delete the wrong
 *  movement. Matching on (section kind, exerciseId) is stable under all of
 *  that. Returns false when the exercise isn't in that section of the template
 *  (an ad-hoc add, or something already removed), so the caller can tell the
 *  difference between "removed" and "there was nothing to remove".
 */
export async function removeExerciseFromTemplate(
  templateId: string,
  sectionKind: SectionKind,
  exerciseId: string,
): Promise<boolean> {
  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  let removed = false;
  const sections = template.sections
    .map((section) => {
      if (section.kind !== sectionKind || removed) return section;
      return {
        ...section,
        groups: section.groups
          .map((group) => {
            if (removed) return group;
            const mi = group.members.findIndex((m) => m.exerciseId === exerciseId);
            if (mi === -1) return group;
            removed = true;
            return { ...group, members: group.members.filter((_, k) => k !== mi) };
          })
          .filter((group) => group.members.length > 0),
      };
    })
    .filter((section) => section.groups.length > 0 || section.description);

  if (!removed) return false;

  await db.templates.put({ ...template, sections, updatedAt: Date.now() });
  return true;
}

// ---- Sessions ----

const DEFAULT_INTENSITY = 7;

/** Local (not UTC-shifted) calendar date, e.g. "2026-07-20". */
function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildLoggedSetFromPlanned(planned: PlannedSet): LoggedSet {
  return {
    target: planned.target,
    load: planned.load,
    ...(planned.side ? { side: planned.side } : {}),
    ...(planned.mainWork ? { mainWork: true } : {}),
    ...(planned.warmup ? { warmup: true } : {}),
    done: false,
  };
}

function buildSessionExerciseFromMember(
  member: GroupMember,
  exercises: Map<string, Exercise>,
): SessionExercise {
  const intensity = member.intensity ?? exercises.get(member.exerciseId)?.defaultIntensity ?? DEFAULT_INTENSITY;
  return {
    exerciseId: member.exerciseId,
    intensity,
    ...(member.byFeel !== undefined ? { byFeel: member.byFeel } : {}),
    ...(member.variationNote ? { variationNote: member.variationNote } : {}),
    restAfterSec: member.restAfterSec,
    sets: member.sets.map(buildLoggedSetFromPlanned),
  };
}

/** First-ever session for a template: build fresh from the template's own prescription. */
async function buildSectionsFromTemplate(template: Template): Promise<SessionSection[]> {
  const exercises = await exerciseMap();
  return template.sections.map((section) => ({
    kind: section.kind,
    logging: section.logging,
    ...(section.description ? { description: section.description } : {}),
    groups: section.groups.map((group) => ({
      members: group.members.map((member) => buildSessionExerciseFromMember(member, exercises)),
    })),
  }));
}

/** Copy-forward, the numbers half.
 *
 *  The template owns *structure and prescription* — which exercises, in what
 *  order, how many sets, and the target reps/duration. The last workout owns
 *  *your numbers* — the loads you actually lifted, plus intensity and rest.
 *  Starting a workout builds from the template and then overlays those.
 *
 *  Before this, starting a workout cloned the previous session wholesale and
 *  never looked at the template again, which meant template edits silently did
 *  nothing and target reps could never come down: a hard week would ratchet the
 *  numbers up and leave them there. Splitting the two sources is what lets a
 *  programme be a programme (and a deload be a deload) instead of an
 *  ever-rising high-water mark.
 */

/** Prior sets for one exercise, kept split by side so L/R rows line up even
 *  when the template and the last workout disagree on set count. */
function priorSetsBySide(sets: LoggedSet[]): Map<string, LoggedSet[]> {
  const bySide = new Map<string, LoggedSet[]>();
  for (const set of sets) {
    const key = set.side ?? '-';
    const list = bySide.get(key);
    if (list) list.push(set);
    else bySide.set(key, [set]);
  }
  return bySide;
}

/** The prior set to take a load from, for the nth template set on a given side.
 *  Runs off the end deliberately: if the template asks for 5 sets and last week
 *  logged 3, sets 4 and 5 inherit the last load actually used rather than
 *  dropping back to the template's starting weight. */
function priorSetFor(
  bySide: Map<string, LoggedSet[]>,
  side: string,
  nth: number,
): LoggedSet | undefined {
  const list = bySide.get(side) ?? bySide.get('-');
  if (!list || list.length === 0) return undefined;
  return list[Math.min(nth, list.length - 1)];
}

/** Index a prior session's exercises by (section kind, exerciseId).
 *  Section kind is part of the key so the same movement prescribed in both
 *  Primary and Secondary keeps its own numbers in each. */
function indexPriorMembers(prior: Session): Map<string, SessionExercise> {
  const index = new Map<string, SessionExercise>();
  for (const section of prior.sections) {
    for (const group of section.groups) {
      for (const member of group.members) {
        const key = `${section.kind}\u0000${member.exerciseId}`;
        if (!index.has(key)) index.set(key, member);
      }
    }
  }
  return index;
}

/** How much of your working load a deload week starts at, and how many of
 *  the sets it keeps.
 *
 *  60% of working weight with half the sets (2026-09-23). Published
 *  guidance for strength athletes is 60–75% of usual working weights with
 *  sets cut 40–60%; the user trains at ~8.5/10 effort, so they take the lighter
 *  end. Still a starting offer they adjust with the steppers, not a
 *  prescription — and a later deload keeps whatever set count they settled on. */
const DELOAD_LOAD_FACTOR = 0.6;

/** Half the sets, rounded up; single-side work keeps whole L/R pairs. */
function deloadSetCount(sets: LoggedSet[]): number {
  if (sets.some((s) => s.side)) return Math.ceil(Math.ceil(sets.length / 2) / 2) * 2;
  return Math.ceil(sets.length / 2);
}

/** Pad to `count` sets by repeating the last one (a deload set count
 *  remembered from last time can exceed what the template now has). */
function padSets(sets: LoggedSet[], count: number): LoggedSet[] {
  if (sets.length === 0 || count <= sets.length) return sets;
  return [...sets, ...Array.from({ length: count - sets.length }, () => ({ ...sets[sets.length - 1] }))];
}

/** Cut to `count` sets for a deload: warm-up (w) ramp sets go first — at 60%
 *  load a ramp-in is pointless — then from the end. Single-side work loses
 *  whole L/R pairs, since a deload count for it is always even. */
function cutSets(sets: LoggedSet[], count: number): LoggedSet[] {
  let kept = sets;
  while (kept.length > count) {
    const w = kept.findIndex((s) => s.warmup);
    if (w === -1) break;
    const pair = kept[w].side ? kept.filter((_, i) => i >= w && i < w + 2) : [kept[w]];
    kept = kept.filter((s) => !pair.includes(s));
  }
  return kept.slice(0, count);
}

/** Scale a load for a deload week, to the nearest 2.5kg the gym actually has.
 *  Bodyweight, bands and as-needed loads have nothing to scale. */
function scaleLoad(load: Load, factor: number): Load {
  if (factor === 1) return load;
  const round = (kg: number) => Math.max(0, Math.round((kg * factor) / 2.5) * 2.5);
  if (load.type === 'kg') return { type: 'kg', kg: round(load.kg) };
  if (load.type === 'bw_plus_kg') return { type: 'bw_plus_kg', kg: round(load.kg) };
  return load;
}

/** Overlay last workout's numbers onto a structure built from the template.
 *
 *  `loadScale` lightens them for a deload week. `targetsFrom`, when given,
 *  also replaces the template's target reps/duration — used so a deload week
 *  remembers the rep scheme you settled on last deload instead of asking you
 *  to dial it back down every cycle. `deload` also cuts the set count: to the
 *  last deload's count for that exercise, or else to half. */
function overlayPriorNumbers(
  sections: SessionSection[],
  prior: Session,
  {
    loadScale = 1,
    targetsFrom,
    deload = false,
  }: { loadScale?: number; targetsFrom?: Session; deload?: boolean } = {},
): SessionSection[] {
  const index = indexPriorMembers(prior);
  const targetIndex = targetsFrom ? indexPriorMembers(targetsFrom) : undefined;

  return sections.map((section) => ({
    ...section,
    groups: section.groups.map((group) => ({
      members: group.members.map((member) => {
        const key = `${section.kind}\u0000${member.exerciseId}`;
        const priorMember = index.get(key);
        const targetMember = targetIndex?.get(key);
        if (!priorMember) return member;
        const setCount =
          deload && !isByFeel(section, member)
            ? (targetMember?.sets.length ?? deloadSetCount(member.sets))
            : member.sets.length;

        const bySide = priorSetsBySide(priorMember.sets);
        const targetsBySide = targetMember ? priorSetsBySide(targetMember.sets) : undefined;
        const seen = new Map<string, number>();

        return {
          ...member,
          // Intensity and rest are things the user tunes in the gym, so the last
          // workout wins over the template's starting value.
          intensity: priorMember.intensity,
          restAfterSec: priorMember.restAfterSec,
          ...(priorMember.variationNote ? { variationNote: priorMember.variationNote } : {}),
          sets: cutSets(padSets(member.sets, setCount).map((set) => {
            const side = set.side ?? '-';
            const nth = seen.get(side) ?? 0;
            seen.set(side, nth + 1);
            const priorSet = priorSetFor(bySide, side, nth);
            const targetSet = targetsBySide ? priorSetFor(targetsBySide, side, nth) : undefined;
            if (!priorSet) return set;
            return {
              ...set,
              // The load is the number that carries; the target normally stays
              // the template's prescription (see targetsFrom for the exception).
              load: scaleLoad(priorSet.load, loadScale),
              ...(targetSet && targetSet.target.type !== 'amrap'
                ? { target: targetSet.target }
                : {}),
              // The (w) flag is toggled mid-workout and is about how the set
              // was used, not what was prescribed — so it carries too.
              ...(priorSet.warmup ? { warmup: true } : {}),
            };
          }), setCount),
        };
      }),
    })),
  }));
}

export async function listSessionsForTemplate(templateId: string): Promise<Session[]> {
  const sessions = await db.sessions.where('templateId').equals(templateId).toArray();
  return sessions.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    // Same-millisecond starts fall back to the id: ULIDs are monotonic, so a
    // later id is always the later-created session.
    return b.startedAt - a.startedAt || (a.id < b.id ? 1 : -1);
  });
}

export async function getActiveSession(): Promise<Session | undefined> {
  return db.sessions.where('status').equals('active').first();
}

export function getSession(id: string): Promise<Session | undefined> {
  return db.sessions.get(id);
}

/** All finished sessions, newest first — the history feed. */
export async function listDoneSessions(): Promise<Session[]> {
  const sessions = await db.sessions.where('status').equals('done').toArray();
  return sessions.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    // Same-millisecond starts fall back to the id: ULIDs are monotonic, so a
    // later id is always the later-created session.
    return b.startedAt - a.startedAt || (a.id < b.id ? 1 : -1);
  });
}

/** What kind of week to offer when the user just taps Start.
 *
 *  A deload is a one-week event, so the week after one goes back to building.
 *  Anything else repeats: you stay in build (or at peak) until you say
 *  otherwise. */
function defaultWeekTypeAfter(prior: Session | undefined): WeekType {
  const last = prior?.weekType ?? 'build';
  return last === 'deload' ? 'build' : last;
}

/** Where a week of this type gets its numbers.
 *
 *  Build and peak weeks pick up from wherever you left off — including from a
 *  deload, which is the point: a new cycle restarts at the lighter weights and
 *  ramps again, instead of resuming at the peak that broke you.
 *
 *  A deload week takes 60% of what you were last lifting, with half the sets,, so it tracks your
 *  current strength rather than a remembered number — unless the previous
 *  session was itself a deload, which would compound the discount. Its *rep
 *  targets* do come from your last deload, so the scheme you settled on
 *  ("2×6 instead of 3×10") holds for every cycle after the first.
 */
function numbersSourceFor(
  weekType: WeekType,
  doneSessions: Session[],
): { prior: Session | undefined; loadScale: number; targetsFrom?: Session; deload?: boolean } {
  const prior = doneSessions[0];
  if (weekType !== 'deload') return { prior, loadScale: 1 };

  const priorWasDeload = prior?.weekType === 'deload';
  const lastDeload = doneSessions.find((s) => s.weekType === 'deload');
  return {
    prior,
    loadScale: priorWasDeload ? 1 : DELOAD_LOAD_FACTOR,
    deload: true,
    ...(lastDeload ? { targetsFrom: lastDeload } : {}),
  };
}

export async function startSession(templateId: string, weekType?: WeekType): Promise<Session> {
  const active = await getActiveSession();
  if (active) {
    throw new Error(
      `A session is already active (id ${active.id}) — finish or resume it before starting another.`,
    );
  }

  const template = await db.templates.get(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const priorSessions = await listSessionsForTemplate(templateId);
  const doneSessions = priorSessions.filter((s) => s.status === 'done');
  const week = weekType ?? defaultWeekTypeAfter(doneSessions[0]);

  // Structure and targets from the template; your numbers from last time.
  const fromTemplate = await buildSectionsFromTemplate(template);
  const { prior, ...numbers } = numbersSourceFor(week, doneSessions);
  const sections = prior ? overlayPriorNumbers(fromTemplate, prior, numbers) : fromTemplate;

  const session: Session = {
    id: ulid(),
    userId: CURRENT_USER,
    templateId,
    date: todayLocalDate(),
    startedAt: Date.now(),
    status: 'active',
    weekType: week,
    sections,
    updatedAt: Date.now(),
  };

  await db.sessions.add(session);
  return session;
}

/** Switch a live workout between build/peak/deload.
 *
 *  The user decides this in the gym, not the night before ("I got here and I'm
 *  broken — make it a deload"), so it has to be changeable mid-session. Sets
 *  already ticked off are left exactly as logged; only the numbers still ahead
 *  of them are re-derived. Structural changes they have made today (an ad-hoc add,
 *  a reorder) survive untouched. */
export async function setSessionWeekType(
  sessionId: string,
  weekType: WeekType,
): Promise<Session> {
  const session = await db.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const template = await db.templates.get(session.templateId);
  if (!template) {
    throw new Error(`Template not found: ${session.templateId}`);
  }

  const doneSessions = (await listSessionsForTemplate(session.templateId)).filter(
    (s) => s.status === 'done',
  );
  const fromTemplate = await buildSectionsFromTemplate(template);
  const { prior, ...numbers } = numbersSourceFor(weekType, doneSessions);
  const derived = prior ? overlayPriorNumbers(fromTemplate, prior, numbers) : fromTemplate;

  // Index the freshly derived sets so they can be matched against the live
  // session, which may have been reordered or added to since it started.
  const derivedIndex = new Map<string, LoggedSet[]>();
  for (const section of derived) {
    for (const group of section.groups) {
      for (const member of group.members) {
        const key = `${section.kind}\u0000${member.exerciseId}`;
        if (!derivedIndex.has(key)) derivedIndex.set(key, member.sets);
      }
    }
  }

  const sections = session.sections.map((section) => ({
    ...section,
    groups: section.groups.map((group) => ({
      ...group,
      members: group.members.map((member) => {
        const planned = derivedIndex.get(`${section.kind}\u0000${member.exerciseId}`);
        if (!planned) return member;
        // The new week's plan decides how many sets there are (a deload has
        // fewer), but a set already lifted is never dropped or changed.
        const lastDone = member.sets.findLastIndex((s) => s.done);
        const length = Math.max(planned.length, lastDone + 1);
        return {
          ...member,
          // Sets removed earlier today carry the old week's loads; restoring
          // one after a switch to deload would bring back the heavy weight.
          removedSets: undefined,
          sets: Array.from({ length }, (_, i) => {
            const current = member.sets[i];
            if (current?.done) return current; // already lifted; history is history
            const next = planned[i];
            if (!next) return current;
            return current ? { ...current, load: next.load, target: next.target } : { ...next, done: false };
          }),
        };
      }),
    })),
  }));

  const updated: Session = { ...session, weekType, sections, updatedAt: Date.now() };
  await db.sessions.put(updated);
  return updated;
}

export async function updateSession(session: Session): Promise<void> {
  await db.sessions.put({ ...session, updatedAt: Date.now() });
}

/** Discard a session entirely — it never happened. History and copy-forward (which only reads done sessions) are untouched. */
export async function cancelSession(sessionId: string): Promise<void> {
  await db.sessions.delete(sessionId);
}

// ---- Whole-session activities: cardio, yoga and anything else timed ----
//
// These cover any training logged as "one thing, for a length of time, at an
// intensity" rather than as sets and reps — cardio, yoga, stretching, a sports
// match. Yoga will likely grow its own detail later; until then it is logged
// exactly like cardio, which is enough to get it into the history.
//
// The stored category and template kind are both still the string 'cardio'.
// That name is now narrower than what it holds, but it is a value in real
// records, and renaming it would mean migrating live data for a purely internal
// label — not worth the risk.

/** Starter activities. Missing ones are topped up on read, so a list seeded
 *  before yoga existed gains it without duplicating what is already there.
 *  (There is no delete UI for activities yet; if one is added, this top-up
 *  needs to learn not to resurrect a deliberately removed activity.) */
const STARTER_ACTIVITIES = [
  'Indoor bike',
  'Padel',
  'Treadmill',
  'Boxing',
  'Yoga',
  'Stretching',
  'Mobility',
];

function newActivity(name: string): Exercise {
  return {
    id: ulid(),
    userId: CURRENT_USER,
    name,
    category: 'cardio',
    unilateral: false,
    defaultIntensity: DEFAULT_INTENSITY,
    updatedAt: Date.now(),
  };
}

/** Activities for the cardio / yoga / other picker. */
export async function listActivities(): Promise<Exercise[]> {
  const existing = (await db.exercises.toArray()).filter((e) => e.category === 'cardio');

  // The starter list once shipped the sport as "Paddle". Renaming the Exercise
  // corrects it everywhere, since everything renders by exerciseId.
  const misspelled = existing.find((e) => e.name === 'Paddle');
  if (misspelled) {
    await db.exercises.put({ ...misspelled, name: 'Padel', updatedAt: Date.now() });
    const template = (await db.templates.toArray()).find(
      (t) => t.kind === 'cardio' && t.name === 'Paddle',
    );
    if (template) await db.templates.put({ ...template, name: 'Padel', updatedAt: Date.now() });
    misspelled.name = 'Padel';
  }

  const have = new Set(existing.map((e) => e.name));
  const missing = STARTER_ACTIVITIES.filter((name) => !have.has(name)).map(newActivity);
  if (missing.length > 0) await db.exercises.bulkPut(missing);

  return [...existing, ...missing].sort((a, b) => a.name.localeCompare(b.name));
}

/** Find (or create) the template that backs one cardio activity. One template
 *  per activity is what lets history group them and copy-forward remember the
 *  last duration. */
async function activityTemplateFor(activity: Exercise): Promise<Template> {
  const all = await db.templates.toArray();
  const existing = all.find((t) => t.kind === 'cardio' && t.name === activity.name);
  if (existing) return existing;

  const template: Template = {
    id: ulid(),
    userId: CURRENT_USER,
    name: activity.name,
    kind: 'cardio',
    sections: [
      {
        kind: 'primary',
        logging: 'tracked',
        groups: [
          {
            members: [
              {
                exerciseId: activity.id,
                restAfterSec: 0,
                sets: [{ target: { type: 'duration', seconds: 30 * 60 }, load: { type: 'bw' } }],
              },
            ],
          },
        ],
      },
    ],
    updatedAt: Date.now(),
  };
  await db.templates.add(template);
  return template;
}

/**
 * Log a cardio session that has already happened — one activity, a duration and
 * an intensity, saved complete rather than opened as a live workout. Cardio is
 * usually recorded afterwards, so there is nothing to tick along with.
 *
 * `date` may be in the past (F10): the session is stored under that date and
 * sorts into history there.
 */
export async function logActivitySession(input: {
  activityId: string;
  date?: string;
  durationMin: number;
  intensity: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  notes?: string;
}): Promise<Session> {
  const activity = await db.exercises.get(input.activityId);
  if (!activity) {
    throw new Error(`Activity not found: ${input.activityId}`);
  }
  const template = await activityTemplateFor(activity);
  const date = input.date ?? todayLocalDate();
  // Stamp the clock at midday on the chosen date so a backdated entry does not
  // claim to have happened at the moment it was typed.
  const at = new Date(`${date}T12:00:00`).getTime();
  const seconds = Math.round(input.durationMin * 60);

  const session: Session = {
    id: ulid(),
    userId: CURRENT_USER,
    templateId: template.id,
    date,
    startedAt: at,
    finishedAt: at + seconds * 1000,
    durationMin: input.durationMin,
    overallEffort: input.intensity,
    ...(input.avgHeartRate ? { avgHeartRate: input.avgHeartRate } : {}),
    ...(input.maxHeartRate ? { maxHeartRate: input.maxHeartRate } : {}),
    status: 'done',
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    sections: [
      {
        kind: 'primary',
        logging: 'tracked',
        groups: [
          {
            members: [
              {
                exerciseId: activity.id,
                intensity: input.intensity,
                restAfterSec: 0,
                sets: [
                  {
                    target: { type: 'duration', seconds },
                    load: { type: 'bw' },
                    actualSeconds: seconds,
                    done: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    updatedAt: Date.now(),
  };
  await db.sessions.add(session);
  return session;
}

/** Move a session to a different date (F10) — for a workout logged late, or
 *  one whose date was wrong. Keeps the time-of-day from the original stamps so
 *  only the calendar day moves. */
export async function setSessionDate(sessionId: string, date: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Bad date: ${date}`);
  }
  const session = await db.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  if (session.date === date) return;

  const shiftToDate = (ts: number): number => {
    const old = new Date(ts);
    const next = new Date(`${date}T00:00:00`);
    next.setHours(old.getHours(), old.getMinutes(), old.getSeconds(), old.getMilliseconds());
    return next.getTime();
  };

  await db.sessions.put({
    ...session,
    date,
    startedAt: shiftToDate(session.startedAt),
    ...(session.finishedAt ? { finishedAt: shiftToDate(session.finishedAt) } : {}),
    updatedAt: Date.now(),
  });
}

export async function finishSession(
  sessionId: string,
  close: { overallEffort: number; endingFatigue: number; durationMin?: number; notes?: string },
): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const finished: Session = {
    ...session,
    status: 'done',
    finishedAt: Date.now(),
    overallEffort: close.overallEffort,
    endingFatigue: close.endingFatigue,
    ...(close.durationMin !== undefined ? { durationMin: close.durationMin } : {}),
    ...(close.notes !== undefined ? { notes: close.notes } : {}),
    updatedAt: Date.now(),
  };

  await db.sessions.put(finished);
}

// ---- Observations (notes about the workout) ----

/** Append a timestamped note to a session. Stays with the workout as history
 *  and is rendered into its markdown mirror. */
export async function addObservation(sessionId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const session = await db.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const observation: Observation = { at: Date.now(), text: trimmed };
  await db.sessions.put({
    ...session,
    observations: [...(session.observations ?? []), observation],
    updatedAt: Date.now(),
  });
}

// ---- Feedback (notes about the app) ----

/** Capture an app annoyance the moment it is noticed, mid-workout. */
export async function addFeedback(text: string, sessionId?: string): Promise<Feedback | undefined> {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const entry: Feedback = {
    id: ulid(),
    userId: CURRENT_USER,
    text: trimmed,
    createdAt: Date.now(),
    ...(sessionId ? { sessionId } : {}),
    updatedAt: Date.now(),
  };
  await db.feedback.add(entry);
  return entry;
}

/** Newest first. Resolved items are excluded unless asked for. */
export async function listFeedback(includeResolved = false): Promise<Feedback[]> {
  const all = await db.feedback.toArray();
  return all
    .filter((f) => includeResolved || !f.resolved)
    // Two notes jotted in the same millisecond would otherwise order at random;
    // ULIDs are monotonic, so they break the tie correctly.
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}

export async function setFeedbackResolved(id: string, resolved: boolean): Promise<void> {
  const entry = await db.feedback.get(id);
  if (!entry) {
    throw new Error(`Feedback not found: ${id}`);
  }
  await db.feedback.put({ ...entry, resolved, updatedAt: Date.now() });
}

/** Drop resolved items for good — they exist only until they are fixed. */
export async function deleteResolvedFeedback(): Promise<number> {
  const resolved = (await db.feedback.toArray()).filter((f) => f.resolved);
  await db.feedback.bulkDelete(resolved.map((f) => f.id));
  return resolved.length;
}

// ---- Backup / restore ----
//
// Device-to-device portability without a backend. Export dumps the whole store
// to a JSON file; import merges it back. Because every record has a ULID `id`
// and an `updatedAt`, `merge` is last-write-wins per id — so moving a file
// between two devices behaves like a manual sync (idempotent: re-importing the
// same file changes nothing). `replace` wipes local data first (destructive).

export const BACKUP_FORMAT = 'fitbuddy-backup' as const;
export const BACKUP_VERSION = 1 as const;

/** Dump all three tables into a self-describing backup object. */
export async function exportAllData(): Promise<BackupFile> {
  const [exercises, templates, sessions, feedback] = await Promise.all([
    db.exercises.toArray(),
    db.templates.toArray(),
    db.sessions.toArray(),
    db.feedback.toArray(),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: { exercises, templates, sessions, feedback },
  };
}

/** Narrow unknown parsed JSON to a BackupFile, throwing a clear error otherwise. */
function assertBackupFile(input: unknown): asserts input is BackupFile {
  const f = input as Partial<BackupFile> | null;
  if (!f || typeof f !== 'object') {
    throw new Error('Not a backup file: expected a JSON object.');
  }
  if (f.format !== BACKUP_FORMAT) {
    throw new Error('This file is not a Fitness Training Buddy backup.');
  }
  if (f.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${String(f.version)} (expected ${BACKUP_VERSION}).`);
  }
  const d = f.data as BackupFile['data'] | undefined;
  if (!d || !Array.isArray(d.exercises) || !Array.isArray(d.templates) || !Array.isArray(d.sessions)) {
    throw new Error('Backup file is missing or has malformed data.');
  }
}

/** Merge one table's incoming records by last-write-wins on `updatedAt`. */
async function mergeTable<T extends { id: string; updatedAt: number }>(
  table: import('dexie').Table<T, string>,
  incoming: T[],
): Promise<TableImportCounts> {
  const counts: TableImportCounts = { added: 0, updated: 0, skipped: 0 };
  for (const record of incoming) {
    const existing = await table.get(record.id);
    if (!existing) {
      await table.put(record);
      counts.added += 1;
    } else if (record.updatedAt > existing.updatedAt) {
      await table.put(record);
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }
  return counts;
}

/**
 * Import a backup. `merge` (default) is safe and sync-like: last-write-wins per
 * id, nothing deleted. `replace` clears the three tables first, then loads the
 * file verbatim (destructive — the caller must confirm).
 */
export async function importData(
  input: unknown,
  mode: ImportMode = 'merge',
): Promise<ImportSummary> {
  assertBackupFile(input);
  const { exercises, templates, sessions } = input.data;
  // Backups taken before feedback existed simply have none.
  const feedback = input.data.feedback ?? [];

  return db.transaction(
    'rw',
    db.exercises,
    db.templates,
    db.sessions,
    db.feedback,
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.exercises.clear(),
          db.templates.clear(),
          db.sessions.clear(),
          db.feedback.clear(),
        ]);
        await Promise.all([
          db.exercises.bulkPut(exercises),
          db.templates.bulkPut(templates),
          db.sessions.bulkPut(sessions),
          db.feedback.bulkPut(feedback),
        ]);
        return {
          mode,
          exercises: { added: exercises.length, updated: 0, skipped: 0 },
          templates: { added: templates.length, updated: 0, skipped: 0 },
          sessions: { added: sessions.length, updated: 0, skipped: 0 },
          feedback: { added: feedback.length, updated: 0, skipped: 0 },
        };
      }

      return {
        mode,
        exercises: await mergeTable(db.exercises, exercises),
        templates: await mergeTable(db.templates, templates),
        sessions: await mergeTable(db.sessions, sessions),
        feedback: await mergeTable(db.feedback, feedback),
      };
    },
  );
}
