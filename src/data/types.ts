// Core data model — see docs/TECH_PLAN.md.
// Every record carries userId + updatedAt so sync/multi-user can be layered on later.

export type UserId = string;
export const CURRENT_USER: UserId = 'mike';

export type Category =
  | 'strength'
  | 'rehab'
  | 'flexibility'
  | 'accessory'
  | 'movement'
  | 'breathing'
  /** A cardio activity (indoor bike, paddle, treadmill…). Stored as an
   *  Exercise so the list syncs, backs up and grows the same way every other
   *  exercise list does — no new table, no sync-worker change. */
  | 'cardio';

export interface Exercise {
  id: string;
  userId: UserId;
  name: string;
  category: Category;
  unilateral: boolean;
  /** 4-digit tempo: Eccentric–Pause(bottom)–Concentric–Pause(top), e.g. "3-1-1-0". X = explosive. */
  stickyTempo?: string;
  /** Technique note that copies forward, e.g. "pause at the top". */
  stickyModifier?: string;
  /** 1–10, halves allowed. App-wide default is 7. */
  defaultIntensity: number;
  notes?: string;
  updatedAt: number;
}

export type Load =
  | { type: 'kg'; kg: number }
  | { type: 'bw' }
  | { type: 'bw_plus_kg'; kg: number }
  | { type: 'band' }
  | { type: 'as_needed'; note?: string };

export type SetTarget =
  | { type: 'reps'; reps: number }
  | { type: 'amrap' }
  | { type: 'duration'; seconds: number }
  | { type: 'loose' };

/** Which side a set trains, for single-side (unilateral) work. Absent on
 *  bilateral movements — and on unilateral sets created before sides existed,
 *  where one row meant "this many reps per side". */
export type Side = 'L' | 'R';

export interface PlannedSet {
  target: SetTarget;
  load: Load;
  side?: Side;
  /** Progression tracking watches main work sets (vs ramp sets). */
  mainWork?: boolean;
  /** Warm-up/ramp-in set — flagged with a (w) marker, excluded from progression. */
  warmup?: boolean;
}

/** One exercise's slot inside a group: its rest, prescription and workout-specific intensity. */
export interface GroupMember {
  exerciseId: string;
  /** Logged by feel (a single tick) rather than by numbers. Overrides the
   *  section default, so a warm-up can hold "3×10 @ 20kg" alongside "mobilise
   *  until it feels right". Undefined = follow the section. */
  byFeel?: boolean;
  /** Rest after each set of THIS movement (per-movement, so asymmetric rest works). */
  restAfterSec: number;
  sets: PlannedSet[];
  /** Per-workout intensity for this exercise (falls back to exercise.defaultIntensity). */
  intensity?: number;
  /** e.g. push-ups: "variation chosen ad hoc to make 10r tough". */
  variationNote?: string;
}

/** 1 member = straight sets; 2+ members = superset rotation. */
export interface ExerciseGroup {
  members: GroupMember[];
}

export type SectionKind = 'warmup' | 'primary' | 'secondary' | 'cooldown';

export interface Section {
  kind: SectionKind;
  /** tracked = tables/intensity (primary, secondary); loose = bullets (warm-up, cool-down). */
  logging: 'tracked' | 'loose';
  /** Free-text description, e.g. warm-up routine prose. */
  description?: string;
  groups: ExerciseGroup[];
}

/** Home-screen tab. Absent means inferred from kind/name (lib/templateGroups.ts). */
export type TemplateGroup = 'upper' | 'lower' | 'rest';

export interface Template {
  id: string;
  userId: UserId;
  name: string;
  /** `cardio` templates hold a single activity logged as duration + intensity.
   *  Modelling cardio as a template (one per activity, created on first use)
   *  rather than a separate record type means history, markdown, sync, backup
   *  and copy-forward all work on it unchanged — and last week's duration is
   *  remembered per activity for free. */
  kind: 'gym' | 'micro' | 'cardio';
  /** Set by the user in the template editor; otherwise inferred. */
  group?: TemplateGroup;
  timeCapMin?: number;
  sections: Section[];
  updatedAt: number;
}

// ---- Sessions (schema defined now; logging flow lands in Milestone 2) ----

export interface LoggedSet {
  target: SetTarget;
  load: Load;
  side?: Side;
  actualReps?: number;
  actualSeconds?: number;
  /** Optional per-set override of the exercise-level intensity. */
  intensityOverride?: number;
  mainWork?: boolean;
  /** Warm-up/ramp-in set — toggleable mid-session, copies forward. */
  warmup?: boolean;
  note?: string;
  done: boolean;
}

export interface SessionExercise {
  exerciseId: string;
  /** See GroupMember.byFeel. Copied forward with the exercise. */
  byFeel?: boolean;
  intensity: number;
  variationNote?: string;
  restAfterSec: number;
  sets: LoggedSet[];
  /** Added mid-session to this instance only — not copied forward. Cleared if promoted into the template. */
  addedAdHoc?: boolean;
  /** Skipped for today; history records the skip, copy-forward resets it. */
  skipped?: boolean;
  /** Sets taken off with "− remove set" today, most recent last, so "＋ add
   *  set" can put back exactly what was there (F9: "remove down to one, then
   *  add them back with the previous numbers"). Session-only: never rendered,
   *  never copied forward. */
  removedSets?: LoggedSet[];
}

export interface SessionGroup {
  members: SessionExercise[];
}

export interface SessionSection {
  kind: SectionKind;
  logging: 'tracked' | 'loose';
  description?: string;
  groups: SessionGroup[];
  done?: boolean;
}

/** A timestamped note about the workout itself, recorded mid-session — e.g.
 *  "pain in left shoulder on set 3". Kept as history; not app feedback. */
export interface Observation {
  at: number;
  text: string;
}

/** Where this workout sits in a training cycle.
 *
 *  `build` ramps, `peak` is the top of a cycle, `deload` is the lighter week
 *  that lets things recover before the next cycle starts. The point of naming
 *  it is that a deload's numbers must not be read as a failed build week —
 *  see the load rules in repo.ts. */
export type WeekType = 'build' | 'peak' | 'deload';

export interface Session {
  id: string;
  userId: UserId;
  templateId: string;
  /** ISO date, e.g. "2026-07-13". */
  date: string;
  startedAt: number;
  finishedAt?: number;
  startingFatigue?: number;
  overallEffort?: number;
  endingFatigue?: number;
  /** Where this workout sits in a training cycle; absent on sessions logged
   *  before cycles existed, which read as 'build'. */
  weekType?: WeekType;
  /** "Not today" was tapped on the deload suggestion for this workout, so it
   *  stays hidden (lib/deloadAdvice.ts). */
  deloadPromptDismissed?: boolean;
  /** How long the workout actually took, in minutes. Prefilled on the close
   *  screen from startedAt→now and then confirmed or corrected by hand: the
   *  clock can be wrong (a session started early, or left open afterwards),
   *  so the logged number is the one the user agreed to, not the measured one. */
  durationMin?: number;
  /** Optional heart-rate summary, mainly for cardio. Absent unless the user has a
   *  reading to hand — never block logging on a field a watch might not give. */
  avgHeartRate?: number;
  maxHeartRate?: number;
  notes?: string;
  status: 'active' | 'done';
  sections: SessionSection[];
  /** Notes captured during the session, in the order they were written. */
  observations?: Observation[];
  updatedAt: number;
}

/** A note about the APP (a bug, an annoyance), captured mid-workout when it is
 *  noticed and cleared once fixed. Deliberately separate from Observation:
 *  feedback is throwaway, observations are training history. */
export interface Feedback {
  id: string;
  userId: UserId;
  text: string;
  createdAt: number;
  /** The session it was raised during, when it was raised mid-workout. */
  sessionId?: string;
  resolved?: boolean;
  updatedAt: number;
}

// ---- Backup / restore (device-to-device portability; no backend needed) ----

/** A full dump of the store. The file that moves between devices/origins. */
export interface BackupFile {
  /** Discriminator so we can reject foreign JSON. */
  format: 'fitbuddy-backup';
  /** Bumped if the shape changes; import validates it. */
  version: 1;
  /** ms epoch when the export was taken. */
  exportedAt: number;
  data: {
    exercises: Exercise[];
    templates: Template[];
    sessions: Session[];
    /** Optional: absent in backups taken before feedback existed. */
    feedback?: Feedback[];
  };
}

/** How import reconciles the incoming file against local data. */
export type ImportMode = 'merge' | 'replace';

/** Per-table counts returned from an import, for a human-readable summary. */
export interface TableImportCounts {
  added: number;
  updated: number;
  skipped: number;
}

export interface ImportSummary {
  mode: ImportMode;
  exercises: TableImportCounts;
  templates: TableImportCounts;
  sessions: TableImportCounts;
  feedback: TableImportCounts;
}
