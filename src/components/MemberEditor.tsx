import { useEffect, useRef, useState } from 'react';
import type { Exercise, GroupMember, PlannedSet, Side } from '../data/types';
import { formatLoad } from '../lib/format';
import { Stepper } from './Stepper';
import { NumberField } from './NumberField';

export interface MemberEditorResult {
  /** Library-level exercise name (a change renames it everywhere). */
  name: string;
  member: GroupMember;
}

export const AUTOSAVE_INTERVAL_MS = 60_000;

/** In-place editor for one exercise slot in a template: name, per-set prescription, rest, intensity, variation note.
 *
 * Gym-proof: while open, a dirty draft auto-saves every 60s and immediately
 * when the app is backgrounded (phone lock / app switch), via onAutoSave. */
export default function MemberEditor({
  exercise,
  member,
  showIntensity,
  sectionByFeel,
  onCancel,
  onSave,
  onAutoSave,
  autoSaveIntervalMs = AUTOSAVE_INTERVAL_MS,
}: {
  exercise: Exercise;
  member: GroupMember;
  showIntensity: boolean;
  /** What this exercise's section defaults to, so the toggle can offer the
   *  opposite and only store a flag when it actually differs. */
  sectionByFeel: boolean;
  onCancel: () => void;
  onSave: (result: MemberEditorResult) => void;
  /** Persist the draft without closing the editor. Omit to disable auto-save. */
  onAutoSave?: (result: MemberEditorResult) => void;
  autoSaveIntervalMs?: number;
}) {
  const [name, setName] = useState(exercise.name);
  const [rest, setRest] = useState(member.restAfterSec);
  const [intensity, setIntensity] = useState(member.intensity ?? exercise.defaultIntensity);
  const [variationNote, setVariationNote] = useState(member.variationNote ?? '');
  const [sets, setSets] = useState<PlannedSet[]>(() => structuredClone(member.sets));
  const [byFeel, setByFeel] = useState(member.byFeel ?? sectionByFeel);
  const [autoSavedAt, setAutoSavedAt] = useState<string | null>(null);

  function buildResult(): MemberEditorResult | null {
    if (!name.trim() || sets.length === 0) return null;
    return {
      name: name.trim(),
      member: {
        exerciseId: member.exerciseId,
        // Only stored when it differs from the section, so the common case
        // stays absent and existing records are untouched.
        ...(byFeel !== sectionByFeel ? { byFeel } : {}),
        restAfterSec: rest,
        ...(showIntensity
          ? { intensity }
          : member.intensity !== undefined
            ? { intensity: member.intensity }
            : {}),
        ...(variationNote.trim() ? { variationNote: variationNote.trim() } : {}),
        sets,
      },
    };
  }

  // The interval reads the freshest draft through refs so it never works from
  // a stale closure, and only writes when something actually changed.
  const draftRef = useRef<MemberEditorResult | null>(null);
  draftRef.current = buildResult();
  const autoSaveRef = useRef(onAutoSave);
  autoSaveRef.current = onAutoSave;
  const lastSavedRef = useRef<string | null>(null);

  useEffect(() => {
    lastSavedRef.current = JSON.stringify(draftRef.current);
    if (!autoSaveRef.current) return;

    const flushIfDirty = () => {
      const result = draftRef.current;
      if (!result) return;
      const snapshot = JSON.stringify(result);
      if (snapshot === lastSavedRef.current) return;
      lastSavedRef.current = snapshot;
      autoSaveRef.current?.(result);
      setAutoSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };

    const timer = setInterval(flushIfDirty, autoSaveIntervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushIfDirty();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveIntervalMs]);

  function patchSet(i: number, fn: (s: PlannedSet) => PlannedSet) {
    setSets(sets.map((s, j) => (j === i ? fn(s) : s)));
  }

  function setAmount(i: number, raw: string) {
    const n = Math.max(0, Number(raw) || 0);
    patchSet(i, (s) =>
      s.target.type === 'duration'
        ? { ...s, target: { type: 'duration', seconds: n } }
        : { ...s, target: { type: 'reps', reps: n } },
    );
  }

  function setUnit(i: number, unit: 'reps' | 'duration') {
    patchSet(i, (s) => {
      if (s.target.type !== 'reps' && s.target.type !== 'duration') return s;
      if (s.target.type === unit) return s;
      // sensible default when flipping modes, same as the add form
      return {
        ...s,
        target: unit === 'duration' ? { type: 'duration', seconds: 30 } : { type: 'reps', reps: 8 },
      };
    });
  }

  function setKg(i: number, raw: string) {
    patchSet(i, (s) => {
      if (raw === '') {
        return { ...s, load: { type: 'bw' } };
      }
      const kg = Number(raw);
      if (!Number.isFinite(kg)) return s;
      return {
        ...s,
        load: s.load.type === 'bw_plus_kg' ? { type: 'bw_plus_kg', kg } : { type: 'kg', kg },
      };
    });
  }

  return (
    <div className="rounded-lg bg-slate-800/60 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Exercise name</div>
      <input
        id="member-editor-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mb-3 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
      />

      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setByFeel(false)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            !byFeel ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          Sets &amp; reps
        </button>
        <button
          onClick={() => setByFeel(true)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            byFeel ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          By feel
        </button>
      </div>

      {byFeel ? (
        <p className="mb-3 text-xs text-slate-500">
          Logged with a single tick — no numbers to fill in. The prescription below is kept in
          case you switch back.
        </p>
      ) : null}

      <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Sets</div>
      <div className="mb-3 flex flex-col gap-2">
        {sets.map((set, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            {set.side && (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  set.side === 'L' ? 'bg-sky-500/20 text-sky-300' : 'bg-violet-500/20 text-violet-300'
                }`}
              >
                {set.side}
              </span>
            )}
            {set.target.type === 'amrap' ? (
              <span className="w-14 shrink-0 text-center text-xs text-slate-400">max</span>
            ) : set.target.type === 'loose' ? (
              <span className="w-14 shrink-0 text-center text-xs text-slate-400">—</span>
            ) : (
              <NumberField
                value={String(set.target.type === 'duration' ? set.target.seconds : set.target.reps)}
                onChange={(v) => setAmount(i, v)}
                label={set.target.type === 'duration' ? `Set ${i + 1} seconds` : `Set ${i + 1} reps`}
                step={set.target.type === 'duration' ? 5 : 1}
              />
            )}
            {(set.target.type === 'reps' || set.target.type === 'duration') && (
              <select
                value={set.target.type}
                onChange={(e) => setUnit(i, e.target.value as 'reps' | 'duration')}
                className="shrink-0 rounded bg-slate-800 px-1 py-1.5 text-xs"
              >
                <option value="reps">reps</option>
                <option value="duration">sec</option>
              </select>
            )}
            {set.load.type === 'band' || set.load.type === 'as_needed' ? (
              <span className="text-xs text-slate-400">{formatLoad(set.load)}</span>
            ) : (
              <>
                {set.load.type === 'bw_plus_kg' && (
                  <span className="shrink-0 text-xs text-slate-500">BW+</span>
                )}
                <NumberField
                  value={set.load.type === 'bw' ? '' : String(set.load.kg)}
                  onChange={(v) => setKg(i, v)}
                  label={`Set ${i + 1} kilograms`}
                  step={2.5}
                  decimal
                  placeholder="BW"
                />
                <span className="shrink-0 text-xs text-slate-500">kg</span>
              </>
            )}
            {set.mainWork && <span className="text-xs text-amber-300">★</span>}
            <button
              onClick={() =>
                patchSet(i, (s) => {
                  const { warmup, ...rest } = s;
                  return warmup ? rest : { ...rest, warmup: true };
                })
              }
              aria-label={set.warmup ? `Set ${i + 1} is warm-up (tap to unmark)` : `Mark set ${i + 1} as warm-up`}
              className={`ml-auto shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
                set.warmup ? 'bg-amber-500/25 text-amber-300' : 'bg-slate-700 text-slate-500'
              }`}
            >
              W
            </button>
            <button
              onClick={() => setSets(sets.filter((_, j) => j !== i))}
              disabled={sets.length === 1}
              aria-label={`Remove set ${i + 1}`}
              className="shrink-0 text-xs text-rose-300 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              const last = sets[sets.length - 1];
              if (last?.side) {
                // Sided work grows a pair at a time so L and R stay in step.
                const { side: _unused, ...base } = structuredClone(last);
                setSets([...sets, { ...base, side: 'L' }, { ...base, side: 'R' }]);
              } else {
                setSets([...sets, structuredClone(last)]);
              }
            }}
            className="self-start text-xs text-sky-400"
          >
            ＋ add set
          </button>
          {exercise.unilateral && !sets.some((x) => x.side) && (
            // Conversion path for single-side exercises created before sides
            // existed, where one row meant "this many reps per side".
            <button
              onClick={() =>
                setSets(
                  sets.flatMap((x) => [
                    { ...structuredClone(x), side: 'L' as Side },
                    { ...structuredClone(x), side: 'R' as Side },
                  ]),
                )
              }
              className="self-start text-xs text-violet-300"
            >
              ⇄ split into L/R
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-slate-500">Rest</span>
        <NumberField
          value={String(rest)}
          onChange={(v) => setRest(v === '' ? 0 : Number(v))}
          label="Rest seconds"
          step={15}
        />
        <span className="text-xs text-slate-500">s</span>
        {showIntensity && (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">Intensity</span>
            <Stepper value={intensity} onChange={setIntensity} />
          </span>
        )}
      </div>

      <input
        value={variationNote}
        onChange={(e) => setVariationNote(e.target.value)}
        placeholder="Variation note (optional)"
        className="mb-3 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg bg-slate-800 py-2 text-sm font-medium active:bg-slate-700"
        >
          Cancel
        </button>
        <button
          disabled={!name.trim() || sets.length === 0}
          onClick={() => {
            const result = buildResult();
            if (result) onSave(result);
          }}
          className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-bold disabled:opacity-40 active:bg-sky-500"
        >
          Save
        </button>
      </div>
      {autoSavedAt && (
        <div className="mt-2 text-right text-xs text-slate-500">auto-saved {autoSavedAt}</div>
      )}
    </div>
  );
}
