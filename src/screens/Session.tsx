import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addExerciseToTemplate,
  addFeedback,
  addObservation,
  cancelSession,
  createExercise,
  exerciseMap,
  finishSession,
  getActiveSession,
  getTemplate,
  removeExerciseFromTemplate,
  setSessionWeekType,
  listSessionsForTemplate,
  listTemplates,
  regroupTemplate,
  updateExercise,
  updateSession,
} from '../data/repo';
import type {
  Exercise,
  Load,
  LoggedSet,
  Session as SessionData,
  SessionExercise,
  SessionSection,
  SectionKind,
  Template,
  WeekType,
} from '../data/types';
import { formatLoad, formatTarget } from '../lib/format';
import { describeOutstanding, isFullyLogged, sessionProgress } from '../lib/sessionProgress';
import {
  addMemberToSessionGroup,
  addRound,
  findGroupOf,
  joinGroups,
  loggedSetCount,
  memberToGroupMember,
  removeMemberAt,
  splitMember,
  withExtraSet,
  withoutLastSet,
  type GroupPos,
  type SessionPath,
} from '../lib/sessionEdits';
import { Stepper } from '../components/Stepper';
import AddExercise, { buildPlannedSets, type AddExerciseResult } from '../components/AddExercise';
import { NumberField } from '../components/NumberField';
import { RotationLockButton } from '../components/RotationLockButton';
import { maybeSync } from '../data/sync';
import { isByFeel } from '../lib/logging';
import { deloadAdvice } from '../lib/deloadAdvice';

const SECTION_LABELS: Record<SectionKind, string> = {
  warmup: 'Warm-up',
  primary: 'Primary',
  secondary: 'Secondary',
  cooldown: 'Cool-down',
};

const DEFAULT_RATING = 7;
const DEFAULT_REST_SEC = 60;
const SECTION_ORDER: SectionKind[] = ['warmup', 'primary', 'secondary', 'cooldown'];

type Path = SessionPath;

function samePath(a: Path | null, b: Path): boolean {
  return a !== null && a.si === b.si && a.gi === b.gi && a.mi === b.mi;
}

/** A superset changed today, awaiting "keep it in the template?". Keyed on an
 *  exercise in the changed group, not its position: positions shift with every
 *  structural edit, the exercise does not. */
type RegroupPrompt = { exerciseId: string; message: string };

/** A just-added ad-hoc exercise awaiting the promote decision. */
type PromotePrompt = { path: Path; sectionKind: SectionKind; exerciseName: string };

function updateMember(
  session: SessionData,
  path: Path,
  fn: (m: SessionExercise) => SessionExercise,
): SessionData {
  return {
    ...session,
    sections: session.sections.map((sec, si) =>
      si !== path.si
        ? sec
        : {
            ...sec,
            groups: sec.groups.map((g, gi) =>
              gi !== path.gi
                ? g
                : { ...g, members: g.members.map((m, mi) => (mi === path.mi ? fn(m) : m)) },
            ),
          },
    ),
  };
}

function updateSet(
  session: SessionData,
  path: Path & { seti: number },
  fn: (s: LoggedSet) => LoggedSet,
): SessionData {
  return updateMember(session, path, (m) => ({
    ...m,
    sets: m.sets.map((s, seti) => (seti === path.seti ? fn(s) : s)),
  }));
}

function toggleLooseMemberDone(member: SessionExercise): SessionExercise {
  const makeDone = !member.sets.every((s) => s.done);
  return {
    ...member,
    sets: member.sets.map((s) => ({
      ...s,
      done: makeDone,
      actualReps: makeDone ? (s.target.type === 'reps' ? s.target.reps : s.actualReps) : undefined,
      actualSeconds: makeDone
        ? s.target.type === 'duration'
          ? s.target.seconds
          : s.actualSeconds
        : undefined,
    })),
  };
}

function WarmupBubble({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={active ? 'Warm-up set (tap to unmark)' : 'Mark as warm-up set'}
      className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
        active ? 'bg-amber-500/25 text-amber-300' : 'bg-slate-700 text-slate-500'
      }`}
    >
      W
    </button>
  );
}

function ConfirmableSetRow({
  set,
  unilateral,
  onConfirm,
  onEdit,
  onToggleWarmup,
}: {
  set: LoggedSet;
  unilateral: boolean;
  onConfirm: (actuals: { reps?: number; seconds?: number }, load: Load) => void;
  onEdit: () => void;
  onToggleWarmup: () => void;
}) {
  const isDuration = set.target.type === 'duration';
  const showKgInput = set.load.type === 'kg' || set.load.type === 'bw_plus_kg';
  const initialAmount = isDuration
    ? (set.actualSeconds ?? (set.target.type === 'duration' ? set.target.seconds : undefined))
    : (set.actualReps ?? (set.target.type === 'reps' ? set.target.reps : undefined));
  const initialKg =
    set.load.type === 'kg' || set.load.type === 'bw_plus_kg' ? set.load.kg : undefined;

  // Held as state (not refs) so the ▲▼ arrows can drive the value. Re-synced
  // when the underlying set changes — tapping Edit on a done set, or a new
  // session copying different numbers forward into this row.
  const [amount, setAmount] = useState(initialAmount?.toString() ?? '');
  const [kg, setKg] = useState(initialKg?.toString() ?? '');
  useEffect(() => setAmount(initialAmount?.toString() ?? ''), [initialAmount]);
  useEffect(() => setKg(initialKg?.toString() ?? ''), [initialKg]);

  if (set.done) {
    return (
      <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-sm">
        <span className="text-emerald-300">
          ✓{set.side ? ` ${set.side}` : ''}{' '}
          {set.actualSeconds !== undefined
            ? `${set.actualSeconds}s`
            : set.actualReps !== undefined
              ? `${set.actualReps}r${unilateral && !set.side ? '/side' : ''}`
              : formatTarget(set.target)}{' '}
          @ {formatLoad(set.load)}
          {set.warmup && <span className="ml-1.5 text-xs text-amber-300/80">(w)</span>}
        </span>
        <button onClick={onEdit} className="text-xs text-sky-400">
          Edit
        </button>
      </div>
    );
  }

  return (
    // Tight gaps on purpose: at phone width a BW+kg row (reps, BW+, kg, W, ✓)
    // is within a few pixels of the card edge, and gap-2 pushed ✓ past it.
    <div className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-2 max-[379px]:gap-1">
      {set.side && (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
            set.side === 'L' ? 'bg-sky-500/20 text-sky-300' : 'bg-violet-500/20 text-violet-300'
          }`}
        >
          {set.side}
        </span>
      )}
      <NumberField
        value={amount}
        onChange={setAmount}
        label={isDuration ? 'Seconds' : 'Reps'}
        step={isDuration ? 5 : 1}
        placeholder={set.target.type === 'amrap' ? 'reps' : undefined}
        tone="row"
      />
      <span className="text-xs text-slate-500 shrink-0">
        {isDuration ? 's' : `r${unilateral && !set.side ? '/side' : ''}`}
      </span>
      {showKgInput ? (
        <>
          {set.load.type === 'bw_plus_kg' && <span className="text-xs text-slate-500 shrink-0">BW+</span>}
          <NumberField
            value={kg}
            onChange={setKg}
            label="Kilograms"
            step={2.5}
            decimal
            tone="row"
          />
          {/* Dropped on narrow phones (<380px), where it is what pushes ✓
              off the card; every load here is kg, so nothing is lost. */}
          <span className="shrink-0 text-xs text-slate-500 max-[379px]:hidden">kg</span>
        </>
      ) : (
        <span className="text-xs text-slate-400 truncate">{formatLoad(set.load)}</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <WarmupBubble active={!!set.warmup} onToggle={onToggleWarmup} />
        <button
          onClick={() => {
            const amountNum = amount === '' ? undefined : Number(amount);
            let load = set.load;
            if (showKgInput && kg !== '') {
              const kgNum = Number(kg);
              load =
                set.load.type === 'bw_plus_kg'
                  ? { type: 'bw_plus_kg', kg: kgNum }
                  : { type: 'kg', kg: kgNum };
            }
            onConfirm(isDuration ? { seconds: amountNum } : { reps: amountNum }, load);
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold active:bg-emerald-500"
        >
          ✓
        </button>
      </span>
    </div>
  );
}

const WEEK_TYPES: { value: WeekType; label: string }[] = [
  { value: 'build', label: 'Build' },
  { value: 'peak', label: 'Peak' },
  { value: 'deload', label: 'Deload' },
];

/** Where this workout sits in the cycle, switchable mid-session because that is
 *  when the user knows: they arrive, feel wrecked, and today becomes a deload.
 *  Switching re-derives the sets they haven't lifted yet — a deload starts at 60%
 *  of what they were last lifting, with the rep scheme from their last deload. */
function WeekTypePicker({
  value,
  onChange,
}: {
  value: WeekType;
  onChange: (next: WeekType) => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="shrink-0 text-xs uppercase tracking-wide text-slate-500">Week</span>
      <div className="flex gap-1" role="group" aria-label="Week in cycle">
        {WEEK_TYPES.map((w) => {
          const active = w.value === value;
          return (
            <button
              key={w.value}
              onClick={() => !active && onChange(w.value)}
              aria-pressed={active}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                active
                  ? w.value === 'deload'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-sky-500/20 text-sky-300'
                  : 'bg-slate-800 text-slate-500 active:bg-slate-700'
              }`}
            >
              {w.label}
            </button>
          );
        })}
      </div>
      {value === 'deload' && (
        <span className="text-xs text-amber-300/70">60% · half the sets · unlogged only</span>
      )}
    </div>
  );
}

/** Two-step delete, because this one is not undoable: removing an exercise
 *  mid-workout throws away whatever was logged against it. The template option
 *  is offered only when the exercise is actually in the template — for an
 *  ad-hoc add there is nothing there to remove. */
function RemoveConfirm({
  name,
  loggedSets,
  inTemplate,
  onCancel,
  onRemove,
}: {
  name: string;
  loggedSets: number;
  inTemplate: boolean;
  onCancel: () => void;
  onRemove: (alsoTemplate: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-rose-500/30 bg-slate-900 p-3">
      <p className="mb-1 text-sm font-semibold text-rose-300">Remove {name}?</p>
      <p className="mb-3 text-xs text-slate-400">
        {loggedSets > 0
          ? `${loggedSets} logged set${loggedSets === 1 ? '' : 's'} will be discarded. `
          : ''}
        {inTemplate
          ? 'Removing it today leaves the template alone, so it comes back next time.'
          : 'This exercise is not in the template, so it only affects today.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-semibold active:bg-slate-700"
        >
          Keep it
        </button>
        <button
          onClick={() => onRemove(false)}
          className="flex-1 rounded-xl bg-rose-600 py-3 text-sm font-bold active:bg-rose-500"
        >
          Just today
        </button>
        {inTemplate && (
          <button
            onClick={() => onRemove(true)}
            className="w-full rounded-xl border border-rose-500/40 py-3 text-sm font-semibold text-rose-300 active:bg-rose-500/10"
          >
            Remove from the template too
          </button>
        )}
      </div>
    </div>
  );
}

function LooseMemberRow({
  exercise,
  member,
  onToggle,
  onRemove,
  onUnpair,
}: {
  exercise: Exercise;
  member: SessionExercise;
  onToggle: () => void;
  onRemove: () => void;
  /** Present only inside a superset. */
  onUnpair?: () => void;
}) {
  const done = member.sets.length > 0 && member.sets.every((s) => s.done);
  return (
    <div className="flex items-stretch gap-1">
      <button
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-left"
      >
        <div className="min-w-0">
          <div className={`text-sm font-medium ${done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
            {exercise.name}
          </div>
          <div className="text-xs text-slate-500">
            {member.sets
              .map((s) => `${formatTarget(s.target, exercise.unilateral)} @ ${formatLoad(s.load)}`)
              .join(' · ')}
          </div>
        </div>
        <span className={`shrink-0 text-lg ${done ? 'text-emerald-400' : 'text-slate-600'}`}>
          {done ? '✓' : '○'}
        </span>
      </button>
      {onUnpair && (
        <button
          onClick={onUnpair}
          aria-label={`Take ${exercise.name} out of the superset`}
          className="shrink-0 rounded-lg bg-slate-800 px-2 text-sm text-violet-300 active:bg-slate-700"
        >
          ⇣
        </button>
      )}
      <button
        onClick={onRemove}
        aria-label={`Remove ${exercise.name}`}
        className="shrink-0 rounded-lg bg-slate-800 px-2 text-sm text-slate-500 active:bg-slate-700"
      >
        ✕
      </button>
    </div>
  );
}

/** Elapsed minutes since the session was started, as the close screen's opening
 *  offer for workout length. Rounded to the nearest minute and floored at 1. */
function elapsedMinutes(startedAt: number, now = Date.now()): number {
  return Math.max(1, Math.round((now - startedAt) / 60000));
}

function SessionCloseForm({
  startedAt,
  onBack,
  onSubmit,
}: {
  startedAt: number;
  onBack: () => void;
  onSubmit: (close: {
    overallEffort: number;
    endingFatigue: number;
    durationMin?: number;
    notes?: string;
  }) => void;
}) {
  const [overallEffort, setOverallEffort] = useState(DEFAULT_RATING);
  const [endingFatigue, setEndingFatigue] = useState(DEFAULT_RATING);
  // Prefilled from the clock, but freely editable: the app's own start/finish
  // stamps are often wrong in practice (logging started late, phone left on the
  // bench afterwards), so this asks rather than assumes. Computed once on mount
  // so the field cannot shift under the user while they are typing in it.
  const [durationMin, setDurationMin] = useState(() => String(elapsedMinutes(startedAt)));
  const [notes, setNotes] = useState('');

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-sky-400">
        ← Back to workout
      </button>
      <h1 className="mb-6 text-2xl font-bold">Finish workout</h1>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-xl bg-slate-900 p-4">
          <span>Overall effort</span>
          <Stepper value={overallEffort} onChange={setOverallEffort} />
        </div>
        <div className="flex items-center justify-between rounded-xl bg-slate-900 p-4">
          <span>Ending fatigue</span>
          <Stepper value={endingFatigue} onChange={setEndingFatigue} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-900 p-4">
          <span className="shrink-0">
            Workout length
            <span className="ml-1 text-xs text-slate-500">min</span>
          </span>
          <NumberField
            value={durationMin}
            onChange={setDurationMin}
            step={5}
            min={1}
            label="Workout length in minutes"
          />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          rows={3}
          className="rounded-xl bg-slate-900 p-4 text-sm placeholder:text-slate-500"
        />
      </div>

      <button
        onClick={() =>
          onSubmit({
            overallEffort,
            endingFatigue,
            durationMin: Number(durationMin) > 0 ? Number(durationMin) : undefined,
            notes: notes.trim() || undefined,
          })
        }
        className="mt-8 w-full rounded-2xl bg-emerald-600 py-4 text-lg font-bold active:bg-emerald-500"
      >
        Save & finish
      </button>
    </div>
  );
}

function samePos(a: GroupPos | null, b: GroupPos): boolean {
  return a !== null && a.si === b.si && a.gi === b.gi;
}

/** The superset controls at the foot of each exercise card (F7).
 *
 *  Pairing is tap-then-tap rather than drag-onto: "⛓ superset with…" arms this
 *  card, and every other card offers "Superset with this". Drag is already the
 *  reorder gesture, and telling "drop onto" from "drop between" apart
 *  mid-workout on a phone was the unreliable part.
 *
 *  After any change the card asks whether to keep it in the template, since
 *  the template decides next week's grouping. */
function GroupSupersetControls({
  pos,
  isSuperset,
  tickOnly,
  joining,
  adding,
  sectionKind,
  prompt,
  onStartJoin,
  onCancelJoin,
  onJoinHere,
  onStartAdd,
  onCancelAdd,
  onAdd,
  onKeepInTemplate,
  onJustToday,
}: {
  pos: GroupPos;
  isSuperset: boolean;
  /** Only by-feel ticks (most of a warm-up or cool-down): the footer is hidden
   *  there to keep checklists compact, but the card can still be a partner. */
  tickOnly: boolean;
  joining: GroupPos | null;
  adding: boolean;
  sectionKind: SectionKind;
  prompt: RegroupPrompt | null;
  onStartJoin: () => void;
  onCancelJoin: () => void;
  onJoinHere: () => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onAdd: (result: AddExerciseResult) => void;
  onKeepInTemplate: (prompt: RegroupPrompt) => void;
  onJustToday: () => void;
}) {
  if (joining) {
    if (samePos(joining, pos)) {
      return (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-violet-500/15 px-3 py-2 text-xs text-violet-200">
          <span>Now tap the exercise to superset with</span>
          <button onClick={onCancelJoin} className="shrink-0 font-semibold text-sky-400">
            Cancel
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={onJoinHere}
        className="mt-3 w-full rounded-lg bg-violet-600 py-2.5 text-sm font-bold active:bg-violet-500"
      >
        ⛓ Superset with this
      </button>
    );
  }

  if (adding) {
    return (
      <div className="mt-3 border-t border-slate-800 pt-3">
        <AddExercise
          title={isSuperset ? 'Add to superset' : 'Pair into a superset'}
          fixedSectionKind={sectionKind}
          submitLabel="Add to superset"
          onCancel={onCancelAdd}
          onAdd={onAdd}
        />
      </div>
    );
  }

  return (
    <>
      {prompt && (
        <div className="mt-3 rounded-lg border border-violet-500/30 p-3">
          <p className="mb-2 text-xs text-slate-300">
            {prompt.message} Keep it in the template for next time?
          </p>
          <div className="flex gap-2">
            <button
              onClick={onJustToday}
              className="flex-1 rounded-lg bg-slate-800 py-2 text-xs font-semibold active:bg-slate-700"
            >
              Just today
            </button>
            <button
              onClick={() => onKeepInTemplate(prompt)}
              className="flex-1 rounded-lg bg-violet-600 py-2 text-xs font-bold active:bg-violet-500"
            >
              Keep in template
            </button>
          </div>
        </div>
      )}
      {!tickOnly && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-800/60 pt-2 text-xs">
          <button onClick={onStartJoin} className="whitespace-nowrap text-violet-300">
            ⛓ superset with…
          </button>
          <button onClick={onStartAdd} className="whitespace-nowrap text-violet-300">
            {isSuperset ? '＋ add exercise to superset' : '＋ pair a new exercise'}
          </button>
        </div>
      )}
    </>
  );
}

/** Group card in a live session, reorderable by its ⠿ handle.
 *  An exercise added mid-workout lands at the bottom of its section; this is how
 *  it gets moved up to where it is actually being performed. Same dnd-kit
 *  pointer-sensor setup as the template editor, so the gesture is identical and
 *  works on touch. */
function SortableSessionGroup({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl bg-slate-900 p-4 ${isDragging ? 'z-10 opacity-80 ring-1 ring-sky-500' : ''}`}
    >
      <div className="flex gap-2">
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="shrink-0 cursor-grab touch-none self-start pt-0.5 text-xl text-slate-500 active:cursor-grabbing"
        >
          ⠿
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export default function Session({ onExit }: { onExit: () => void }) {
  const [session, setSession] = useState<SessionData | null | undefined>(undefined);
  const [template, setTemplate] = useState<Template | null>(null);
  const [exercises, setExercises] = useState<Map<string, Exercise>>(new Map());
  const [closing, setClosing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingIncomplete, setConfirmingIncomplete] = useState(false);
  const [removing, setRemoving] = useState<Path | null>(null);
  const [adding, setAdding] = useState(false);
  const [promote, setPromote] = useState<PromotePrompt | null>(null);
  const [otherTemplates, setOtherTemplates] = useState<Template[] | null>(null);
  const [editingDescOf, setEditingDescOf] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<Path | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [observationDraft, setObservationDraft] = useState('');
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [savedFlash, setSavedFlash] = useState<'workout' | 'app' | null>(null);
  // Superset editing (F7). `joining` is the group waiting for the user to tap the
  // one it should be supersetted with.
  const [joining, setJoining] = useState<GroupPos | null>(null);
  const [addingToGroup, setAddingToGroup] = useState<GroupPos | null>(null);
  const [regroupPrompt, setRegroupPrompt] = useState<RegroupPrompt | null>(null);
  /** Earlier workouts of this template, for the deload suggestion. */
  const [templateHistory, setTemplateHistory] = useState<SessionData[]>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    getActiveSession().then((s) => {
      setSession(s ?? null);
      if (s) getTemplate(s.templateId).then((t) => setTemplate(t ?? null));
      if (s) listSessionsForTemplate(s.templateId).then(setTemplateHistory);
    });
    exerciseMap().then(setExercises);
  }, []);

  if (session === undefined) return null;

  if (session === null) {
    return (
      <div>
        <p className="text-slate-400">No active session.</p>
        <button onClick={onExit} className="mt-4 text-sm text-sky-400">
          ← Workouts
        </button>
      </div>
    );
  }

  function persist(next: SessionData) {
    setSession(next);
    void updateSession(next);
  }

  /** Reorder groups within one section. Session-only: the template keeps its
   *  own order, and copy-forward carries this order into the next session. */
  function handleDragEnd(si: number, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !session) return;
    const from = Number(String(active.id).slice(1));
    const to = Number(String(over.id).slice(1));
    persist({
      ...session,
      sections: session.sections.map((sec, i) =>
        i === si ? { ...sec, groups: arrayMove(sec.groups, from, to) } : sec,
      ),
    });
  }

  /** Save a note about the workout onto the session (history + markdown). */
  async function saveObservation() {
    if (!observationDraft.trim() || !session) return;
    await addObservation(session.id, observationDraft);
    setObservationDraft('');
    setSavedFlash('workout');
    setTimeout(() => setSavedFlash(null), 2000);
    const fresh = await getActiveSession();
    if (fresh) setSession(fresh);
  }

  /** Save a note about the APP — collected on the Feedback screen for later. */
  async function saveFeedback() {
    if (!feedbackDraft.trim()) return;
    await addFeedback(feedbackDraft, session?.id);
    setFeedbackDraft('');
    setSavedFlash('app');
    setTimeout(() => setSavedFlash(null), 2000);
  }

  /** Fix a mistyped exercise name mid-workout. Renames the library entry, so it
   *  is corrected everywhere it appears rather than just in this session. */
  async function commitRename(exercise: Exercise) {
    const next = renameDraft.trim();
    setRenaming(null);
    if (!next || next === exercise.name) return;
    await updateExercise(exercise.id, { name: next });
    setExercises((prev) => new Map(prev).set(exercise.id, { ...exercise, name: next }));
  }

  async function handleFinish(close: {
    overallEffort: number;
    endingFatigue: number;
    durationMin?: number;
    notes?: string;
  }) {
    await finishSession(session!.id, close);
    // Push the finished workout straight away rather than waiting for the next
    // app start: a session that exists only on this phone is a session at risk.
    void maybeSync({ force: true });
    onExit();
  }

  /** The exercise an Add form picked (created in the library if new), as a
   *  today-only session member. */
  async function newAdHocMember(
    result: AddExerciseResult,
  ): Promise<{ exercise: Exercise; member: SessionExercise }> {
    const exercise =
      result.existing ??
      (await createExercise({
        name: result.name,
        category: result.category,
        unilateral: result.unilateral,
      }));
    setExercises(new Map(exercises).set(exercise.id, exercise));

    // One source of truth for set construction, so a session add and a template
    // add produce the same shape (including L/R rows for single-side work).
    const member: SessionExercise = {
      exerciseId: exercise.id,
      intensity: exercise.defaultIntensity,
      restAfterSec: DEFAULT_REST_SEC,
      sets: buildPlannedSets({ ...result, existing: exercise }).map((planned) => ({
        ...planned,
        done: false,
      })),
      addedAdHoc: true,
    };
    return { exercise, member };
  }

  async function handleAdd(result: AddExerciseResult) {
    const { exercise, member } = await newAdHocMember(result);

    const sections = [...session!.sections];
    let si = sections.findIndex((s) => s.kind === result.sectionKind);
    if (si === -1) {
      const newSection: SessionSection = {
        kind: result.sectionKind,
        logging:
          result.sectionKind === 'primary' || result.sectionKind === 'secondary' ? 'tracked' : 'loose',
        groups: [],
      };
      si = sections.findIndex(
        (s) => SECTION_ORDER.indexOf(s.kind) > SECTION_ORDER.indexOf(result.sectionKind),
      );
      if (si === -1) si = sections.length;
      sections.splice(si, 0, newSection);
    }
    sections[si] = { ...sections[si], groups: [...sections[si].groups, { members: [member] }] };

    persist({ ...session!, sections });
    setAdding(false);
    setPromote({
      path: { si, gi: sections[si].groups.length - 1, mi: 0 },
      sectionKind: result.sectionKind,
      exerciseName: exercise.name,
    });
  }

  /** Is this exercise part of the template, in the section it sits in today?
   *  Decides whether the confirm offers "remove from the template too". */
  function isInTemplate(path: Path): boolean {
    const section = session!.sections[path.si];
    const member = section?.groups[path.gi]?.members[path.mi];
    if (!template || !member) return false;
    return template.sections.some(
      (s) =>
        s.kind === section.kind &&
        s.groups.some((g) => g.members.some((m) => m.exerciseId === member.exerciseId)),
    );
  }

  async function handleWeekType(next: WeekType) {
    setSession(await setSessionWeekType(session!.id, next));
  }

  async function handleRemove(path: Path, alsoTemplate: boolean) {
    const section = session!.sections[path.si];
    const member = section.groups[path.gi].members[path.mi];
    setRemoving(null);

    if (alsoTemplate) {
      await removeExerciseFromTemplate(session!.templateId, section.kind, member.exerciseId);
      // Re-read so a later confirm doesn't still offer to remove it again.
      setTemplate((await getTemplate(session!.templateId)) ?? null);
    }
    persist(removeMemberAt(session!, path));
  }

  /** Superset `joining` with the group the user tapped. The tapped one stays put
   *  and the other's exercises join it. */
  function handleJoin(into: GroupPos) {
    if (!joining) return;
    const anchor = session!.sections[into.si].groups[into.gi].members[0];
    persist(joinGroups(session!, joining, into));
    setJoining(null);
    setRegroupPrompt({ exerciseId: anchor.exerciseId, message: 'Superset made for today.' });
  }

  function handleUnpair(path: Path, exercise: Exercise) {
    persist(splitMember(session!, path));
    setRegroupPrompt({
      exerciseId: exercise.id,
      message: `${exercise.name} taken out of the superset for today.`,
    });
  }

  /** Add an exercise straight into a superset (or pair one with straight sets). */
  async function handleAddToGroup(pos: GroupPos, result: AddExerciseResult) {
    const { exercise, member } = await newAdHocMember(result);
    persist(addMemberToSessionGroup(session!, pos, member));
    setAddingToGroup(null);
    setRegroupPrompt({
      exerciseId: exercise.id,
      message: `${exercise.name} added to the superset for today.`,
    });
  }

  /** Make the template group these exercises the way today's session does, so
   *  next week starts with the same superset. Exercises new to the template are
   *  added to it, so they stop being "today only". */
  async function keepGroupingInTemplate(prompt: RegroupPrompt) {
    setRegroupPrompt(null);
    const pos = findGroupOf(session!, prompt.exerciseId);
    if (!pos) return;
    const section = session!.sections[pos.si];
    const group = section.groups[pos.gi];
    await regroupTemplate(session!.templateId, section.kind, group.members.map(memberToGroupMember));
    setTemplate((await getTemplate(session!.templateId)) ?? null);
    persist({
      ...session!,
      sections: session!.sections.map((sec, si) =>
        si !== pos.si
          ? sec
          : {
              ...sec,
              groups: sec.groups.map((g, gi) =>
                gi !== pos.gi
                  ? g
                  : { ...g, members: g.members.map((m) => ({ ...m, addedAdHoc: undefined })) },
              ),
            },
      ),
    });
  }

  async function handlePromote(templateId: string) {
    const { path, sectionKind } = promote!;
    const member = session!.sections[path.si].groups[path.gi].members[path.mi];
    await addExerciseToTemplate(templateId, sectionKind, memberToGroupMember(member));
    // Promoting into THIS session's template makes the exercise part of the
    // programme, so it must copy forward: clear the ad-hoc flag. Promoting
    // into a different template leaves this instance session-only.
    if (templateId === session!.templateId) {
      persist(updateMember(session!, path, (m) => ({ ...m, addedAdHoc: undefined })));
    }
    setPromote(null);
    setOtherTemplates(null);
  }

  // Recomputed each render so a starting-fatigue change can bring it up.
  const deload =
    (session.weekType ?? 'build') !== 'deload' && !session.deloadPromptDismissed
      ? deloadAdvice(
          session,
          templateHistory,
          session.sections.flatMap((sec) =>
            sec.groups.flatMap((g) =>
              g.members.filter((m) => !isByFeel(sec, m)).map((m) => m.exerciseId),
            ),
          ),
        )
      : null;

  // What is still outstanding, recomputed each render so the Finish button is
  // always judging the current state of the log.
  const progress = sessionProgress(session);

  if (closing) {
    return (
      <SessionCloseForm
        startedAt={session.startedAt}
        onBack={() => setClosing(false)}
        onSubmit={handleFinish}
      />
    );
  }

  return (
    <div>
      <button onClick={onExit} className="mb-4 text-sm text-sky-400">
        ← Workouts <span className="text-slate-600">(stays active)</span>
      </button>
      <h1 className="mb-1 text-2xl font-bold">{template?.name ?? 'Workout'}</h1>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Started{' '}
          {new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {session.observations?.length ? ` · ${session.observations.length} note(s)` : ''}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <RotationLockButton />
          <button
            onClick={() => setNotesOpen((v) => !v)}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 active:bg-slate-700"
          >
            {notesOpen ? 'Close notes' : '✎ Note'}
          </button>
        </div>
      </div>

      {joining && (
        // The card being paired may be scrolled out of view while the user looks
        // for its partner, so the way out stays pinned on screen.
        <div className="sticky top-0 z-20 -mx-4 mb-3 flex items-center justify-between gap-2 bg-violet-700 px-4 py-2 text-sm">
          <span>Pick the exercise to superset with</span>
          <button onClick={() => setJoining(null)} className="shrink-0 font-semibold underline">
            Cancel
          </button>
        </div>
      )}

      <WeekTypePicker
        value={session.weekType ?? 'build'}
        onChange={(next) => void handleWeekType(next)}
      />

      {deload?.suggest && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-slate-900 p-3">
          <p className="mb-1 text-sm font-semibold text-amber-300">Time for a deload?</p>
          <ul className="mb-3 list-disc pl-5 text-xs text-slate-300">
            {deload.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={() => persist({ ...session, deloadPromptDismissed: true })}
              className="flex-1 rounded-lg bg-slate-800 py-2 text-xs font-semibold active:bg-slate-700"
            >
              Not today
            </button>
            <button
              onClick={() => void handleWeekType('deload')}
              className="flex-1 rounded-lg bg-amber-600 py-2 text-xs font-bold active:bg-amber-500"
            >
              Make it a deload
            </button>
          </div>
        </div>
      )}

      {notesOpen && (
        <div className="mb-6 flex flex-col gap-4 rounded-xl bg-slate-900 p-4">
          {/* Two boxes on purpose: one is training history, the other is a
              to-fix list for the app. Mixing them would bury both. */}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              About this workout
            </div>
            <p className="mb-2 text-xs text-slate-500">
              Saved with the workout — e.g. "pain in left shoulder on set 3".
            </p>
            <textarea
              value={observationDraft}
              onChange={(e) => setObservationDraft(e.target.value)}
              rows={2}
              placeholder="How it felt, niggles, anything worth remembering…"
              aria-label="Note about this workout"
              className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500"
            />
            <button
              onClick={() => void saveObservation()}
              disabled={!observationDraft.trim()}
              className="mt-2 w-full rounded-lg bg-sky-600 py-2 text-sm font-semibold disabled:opacity-40 active:bg-sky-500"
            >
              {savedFlash === 'workout' ? 'Saved ✓' : 'Save workout note'}
            </button>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              About the app
            </div>
            <p className="mb-2 text-xs text-slate-500">
              Something wrong or annoying? Collected on the Feedback screen to
              hand back to Claude later.
            </p>
            <textarea
              value={feedbackDraft}
              onChange={(e) => setFeedbackDraft(e.target.value)}
              rows={2}
              placeholder="What went wrong with the app…"
              aria-label="Note about the app"
              className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500"
            />
            <button
              onClick={() => void saveFeedback()}
              disabled={!feedbackDraft.trim()}
              className="mt-2 w-full rounded-lg bg-amber-600 py-2 text-sm font-semibold disabled:opacity-40 active:bg-amber-500"
            >
              {savedFlash === 'app' ? 'Saved ✓' : 'Save app feedback'}
            </button>
          </div>

          {session.observations?.length ? (
            <div className="border-t border-slate-800 pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Notes so far
              </div>
              <ul className="flex flex-col gap-1 text-xs text-slate-300">
                {session.observations.map((o, i) => (
                  <li key={i}>
                    <span className="text-slate-500">
                      {new Date(o.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>{' '}
                    {o.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {session.sections.map((section, si) => (
        <section key={si} className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
            {SECTION_LABELS[section.kind]}
          </h2>
          {(section.description !== undefined || section.kind === 'warmup') &&
            (editingDescOf === si ? (
              <textarea
                autoFocus
                defaultValue={section.description ?? ''}
                rows={3}
                onBlur={(e) => {
                  const text = e.target.value.trim();
                  persist({
                    ...session,
                    sections: session.sections.map((s, i) =>
                      i === si ? { ...s, description: text || undefined } : s,
                    ),
                  });
                  setEditingDescOf(null);
                }}
                className="mb-2 w-full rounded-lg bg-slate-800 p-3 text-sm text-slate-200"
              />
            ) : (
              <button
                onClick={() => setEditingDescOf(si)}
                className="mb-2 block w-full text-left text-sm text-slate-300"
              >
                {section.description ?? <span className="text-slate-500">Add notes…</span>}{' '}
                <span className="text-xs text-slate-500">✎</span>
              </button>
            ))}

          {section.kind === 'warmup' && (
            <div className="mb-3 flex items-center justify-between rounded-xl bg-slate-900 p-4">
              <span className="text-sm">Starting fatigue</span>
              <Stepper
                value={session.startingFatigue ?? DEFAULT_RATING}
                onChange={(v) => persist({ ...session, startingFatigue: v })}
              />
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => handleDragEnd(si, e)}
          >
            <SortableContext
              items={section.groups.map((_, gi) => `g${gi}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-3">
                {section.groups.map((group, gi) => (
                  <SortableSessionGroup key={gi} id={`g${gi}`}>
                {group.members.length > 1 && (
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-violet-300">
                      Superset
                    </span>
                    <button
                      onClick={() => persist(addRound(session, { si, gi }))}
                      className="rounded bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-300 active:bg-violet-500/30"
                    >
                      ＋ round
                    </button>
                  </div>
                )}
                {group.members.map((member, mi) => {
                  const exercise = exercises.get(member.exerciseId);
                  if (!exercise) return null;
                  const path: Path = { si, gi, mi };

                  if (samePath(removing, path)) {
                    return (
                      <div key={mi} className={mi > 0 ? 'mt-3' : ''}>
                        <RemoveConfirm
                          name={exercise.name}
                          loggedSets={loggedSetCount(session, path)}
                          inTemplate={isInTemplate(path)}
                          onCancel={() => setRemoving(null)}
                          onRemove={(alsoTemplate) => void handleRemove(path, alsoTemplate)}
                        />
                      </div>
                    );
                  }

                  if (isByFeel(section, member)) {
                    return (
                      <div key={mi} className={mi > 0 ? 'mt-2' : ''}>
                        <LooseMemberRow
                          exercise={exercise}
                          member={member}
                          onToggle={() => persist(updateMember(session, path, toggleLooseMemberDone))}
                          onRemove={() => setRemoving(path)}
                          onUnpair={
                            group.members.length > 1 ? () => handleUnpair(path, exercise) : undefined
                          }
                        />
                      </div>
                    );
                  }

                  if (member.skipped) {
                    return (
                      <div
                        key={mi}
                        className={`flex items-center justify-between gap-2 ${mi > 0 ? 'mt-4 border-t border-slate-800 pt-4' : ''}`}
                      >
                        <span className="font-semibold text-slate-500 line-through">
                          {exercise.name}
                        </span>
                        <span className="flex shrink-0 items-baseline gap-3">
                          <button
                            onClick={() =>
                              persist(updateMember(session, path, (m) => ({ ...m, skipped: undefined })))
                            }
                            className="text-xs text-sky-400"
                          >
                            skipped today · undo
                          </button>
                          <button
                            onClick={() => setRemoving(path)}
                            aria-label={`Remove ${exercise.name}`}
                            className="text-xs text-slate-500"
                          >
                            ✕ remove
                          </button>
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div key={mi} className={mi > 0 ? 'mt-4 border-t border-slate-800 pt-4' : ''}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold">
                            {renaming?.si === si && renaming?.gi === gi && renaming?.mi === mi ? (
                              <input
                                autoFocus
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                onBlur={() => void commitRename(exercise)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void commitRename(exercise);
                                  if (e.key === 'Escape') setRenaming(null);
                                }}
                                aria-label="Exercise name"
                                className="w-full rounded bg-slate-800 px-2 py-1 text-sm font-semibold"
                              />
                            ) : (
                              <button
                                onClick={() => {
                                  setRenameDraft(exercise.name);
                                  setRenaming({ si, gi, mi });
                                }}
                                aria-label={`Rename ${exercise.name}`}
                                className="text-left"
                              >
                                {exercise.name}
                                <span className="ml-1.5 align-middle text-xs text-slate-500">✎</span>
                              </button>
                            )}
                            {member.addedAdHoc && (
                              <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300 align-middle">
                                today only
                              </span>
                            )}
                          </div>
                          {(exercise.unilateral || exercise.stickyModifier || member.variationNote) && (
                            <div className="text-xs text-slate-500">
                              {[
                                exercise.unilateral ? 'single-side' : null,
                                exercise.stickyModifier,
                                member.variationNote,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </div>
                        <Stepper
                          value={member.intensity}
                          onChange={(v) =>
                            persist(updateMember(session, path, (m) => ({ ...m, intensity: v })))
                          }
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        {member.sets.map((set, seti) => (
                          <ConfirmableSetRow
                            key={seti}
                            set={set}
                            unilateral={exercise.unilateral}
                            onConfirm={(actuals, load) =>
                              persist(
                                updateSet(session, { ...path, seti }, (s) => ({
                                  ...s,
                                  actualReps: actuals.reps,
                                  actualSeconds: actuals.seconds,
                                  load,
                                  done: true,
                                })),
                              )
                            }
                            onEdit={() =>
                              persist(updateSet(session, { ...path, seti }, (s) => ({ ...s, done: false })))
                            }
                            onToggleWarmup={() =>
                              persist(
                                updateSet(session, { ...path, seti }, (s) => {
                                  const { warmup, ...rest } = s;
                                  return warmup ? rest : { ...rest, warmup: true };
                                }),
                              )
                            }
                          />
                        ))}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1.5">
                          rest
                          <NumberField
                            value={String(member.restAfterSec)}
                            onChange={(v) =>
                              persist(
                                updateMember(session, path, (m) => ({
                                  ...m,
                                  restAfterSec: v === '' ? 0 : Number(v),
                                })),
                              )
                            }
                            label={`${exercise.name} rest seconds`}
                            step={15}
                            tone="row"
                          />
                          s
                        </span>
                        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                          {member.sets.length > (member.sets.at(-1)?.side ? 2 : 1) &&
                            !member.sets.at(-1)!.done && (
                            <button
                              onClick={() => persist(updateMember(session, path, withoutLastSet))}
                              className="whitespace-nowrap text-sky-400"
                            >
                              − remove set
                            </button>
                          )}
                          <button
                            onClick={() => persist(updateMember(session, path, withExtraSet))}
                            className="whitespace-nowrap text-sky-400"
                          >
                            ＋ add set
                          </button>
                          {group.members.length > 1 && (
                            <button
                              onClick={() => handleUnpair(path, exercise)}
                              aria-label={`Take ${exercise.name} out of the superset`}
                              className="whitespace-nowrap text-violet-300"
                            >
                              ⇣ unpair
                            </button>
                          )}
                          <button
                            onClick={() =>
                              persist(updateMember(session, path, (m) => ({ ...m, skipped: true })))
                            }
                            className="whitespace-nowrap text-slate-500 underline decoration-dotted"
                          >
                            skip today
                          </button>
                          <button
                            onClick={() => setRemoving(path)}
                            aria-label={`Remove ${exercise.name}`}
                            className="whitespace-nowrap text-rose-400/80"
                          >
                            ✕ remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                    <GroupSupersetControls
                      pos={{ si, gi }}
                      isSuperset={group.members.length > 1}
                      tickOnly={group.members.every((m) => isByFeel(section, m))}
                      joining={joining}
                      adding={addingToGroup?.si === si && addingToGroup.gi === gi}
                      sectionKind={section.kind}
                      prompt={
                        regroupPrompt &&
                        samePos(findGroupOf(session, regroupPrompt.exerciseId), { si, gi })
                          ? regroupPrompt
                          : null
                      }
                      onStartJoin={() => {
                        setJoining({ si, gi });
                        setAddingToGroup(null);
                      }}
                      onCancelJoin={() => setJoining(null)}
                      onJoinHere={() => handleJoin({ si, gi })}
                      onStartAdd={() => {
                        setAddingToGroup({ si, gi });
                        setJoining(null);
                      }}
                      onCancelAdd={() => setAddingToGroup(null)}
                      onAdd={(result) => void handleAddToGroup({ si, gi }, result)}
                      onKeepInTemplate={(p) => void keepGroupingInTemplate(p)}
                      onJustToday={() => setRegroupPrompt(null)}
                    />
                  </SortableSessionGroup>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      ))}

      <div className="mt-6">
        {adding ? (
          <AddExercise onCancel={() => setAdding(false)} onAdd={handleAdd} />
        ) : promote ? (
          <div className="rounded-xl bg-slate-900 p-4">
            <div className="mb-3 text-sm">
              Added <span className="font-semibold">{promote.exerciseName}</span> — keep it?
            </div>
            {otherTemplates ? (
              <div className="flex flex-col gap-2">
                {otherTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handlePromote(t.id)}
                    className="rounded-lg bg-slate-800 py-2 text-sm font-medium active:bg-slate-700"
                  >
                    Add to {t.name}
                  </button>
                ))}
                <button onClick={() => setOtherTemplates(null)} className="text-xs text-slate-400">
                  back
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setPromote(null)}
                  className="rounded-lg bg-slate-800 py-2 text-sm font-medium active:bg-slate-700"
                >
                  Just this session
                </button>
                <button
                  onClick={() => handlePromote(session.templateId)}
                  className="rounded-lg bg-sky-600 py-2 text-sm font-medium active:bg-sky-500"
                >
                  Add to {template?.name ?? 'this workout'}
                </button>
                <button
                  onClick={async () => {
                    const all = await listTemplates();
                    setOtherTemplates(all.filter((t) => t.id !== session.templateId));
                  }}
                  className="rounded-lg bg-slate-800 py-2 text-sm font-medium active:bg-slate-700"
                >
                  Add to another template…
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-xl border border-dashed border-slate-700 py-3 text-sm font-medium text-slate-400 active:bg-slate-900"
          >
            ＋ Add exercise
          </button>
        )}
      </div>

      {confirmingIncomplete ? (
        <div className="mt-6 rounded-2xl border border-amber-500/40 bg-slate-900 p-4">
          <p className="mb-1 text-sm font-semibold text-amber-300">This workout isn't finished</p>
          <p className="mb-3 text-sm text-slate-300">
            {describeOutstanding(progress)}. Save it as it is, or go back and log the rest?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmingIncomplete(false)}
              className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-semibold active:bg-slate-700"
            >
              Keep going
            </button>
            <button
              onClick={() => {
                setConfirmingIncomplete(false);
                setClosing(true);
              }}
              className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold active:bg-emerald-500"
            >
              Save anyway
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            // Unfinished workouts used to save silently. Skipping is still a
            // one-tap way past this: a skipped exercise is a decision, not a
            // hole, so it never triggers the prompt.
            if (isFullyLogged(progress)) setClosing(true);
            else setConfirmingIncomplete(true);
          }}
          className="mt-6 w-full rounded-2xl bg-emerald-600 py-4 text-lg font-bold active:bg-emerald-500"
        >
          Finish workout
        </button>
      )}

      {confirmingCancel ? (
        <div className="mt-3 rounded-2xl bg-slate-900 p-4">
          <p className="mb-3 text-sm text-slate-300">
            Discard this workout? Anything logged today will be lost.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmingCancel(false)}
              className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-semibold active:bg-slate-700"
            >
              Keep going
            </button>
            <button
              onClick={async () => {
                await cancelSession(session.id);
                onExit();
              }}
              className="flex-1 rounded-xl bg-rose-600 py-3 text-sm font-bold active:bg-rose-500"
            >
              Discard workout
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirmingCancel(true)}
          className="mt-3 w-full rounded-2xl border border-rose-500/30 py-3 text-sm font-semibold text-rose-300 active:bg-rose-500/10"
        >
          Cancel workout
        </button>
      )}
    </div>
  );
}
