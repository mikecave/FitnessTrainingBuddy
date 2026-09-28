import { useEffect, useMemo, useState } from 'react';
import { listExercises } from '../data/repo';
import type { Category, Exercise, Load, PlannedSet, SectionKind } from '../data/types';
import { NumberField } from './NumberField';

const SECTIONS: { kind: SectionKind; label: string }[] = [
  { kind: 'warmup', label: 'Warm-up' },
  { kind: 'primary', label: 'Primary' },
  { kind: 'secondary', label: 'Secondary' },
  { kind: 'cooldown', label: 'Cool-down' },
];

const CATEGORIES: Category[] = ['strength', 'rehab', 'flexibility', 'accessory', 'movement', 'breathing'];

export interface AddExerciseResult {
  sectionKind: SectionKind;
  name: string;
  /** Set when the name matched an existing library exercise. */
  existing?: Exercise;
  category: Category;
  unilateral: boolean;
  /** Undefined = bodyweight. */
  kg?: number;
  setCount: number;
  /** Reps for 'reps' sets, seconds for 'duration' sets. */
  amount: number;
  targetType: 'reps' | 'duration';
}

/** The form's uniform sets as template-ready planned sets. */
/** Sets for a newly added exercise.
 *
 *  Single-side movements get one row PER SIDE, alternating L, R, L, R… — so
 *  "3 sets" of a unilateral exercise is 6 rows, which is how the work is
 *  actually performed and lets each side be logged independently (reps and load
 *  often differ when one side is rehabbing). */
export function buildPlannedSets(result: AddExerciseResult): PlannedSet[] {
  const load: Load = result.kg !== undefined ? { type: 'kg', kg: result.kg } : { type: 'bw' };
  const target =
    result.targetType === 'duration'
      ? { type: 'duration' as const, seconds: result.amount }
      : { type: 'reps' as const, reps: result.amount };

  const unilateral = result.existing?.unilateral ?? result.unilateral;
  if (!unilateral) {
    return Array.from({ length: result.setCount }, () => ({ target, load }));
  }
  return Array.from({ length: result.setCount }, () => [
    { target, load, side: 'L' as const },
    { target, load, side: 'R' as const },
  ]).flat();
}

export default function AddExercise({
  onCancel,
  onAdd,
  fixedSectionKind,
  submitLabel = 'Add to workout',
  title = 'Add exercise',
}: {
  onCancel: () => void;
  onAdd: (result: AddExerciseResult) => void;
  /** Lock the target section (e.g. pairing into an existing group) — hides the section picker. */
  fixedSectionKind?: SectionKind;
  submitLabel?: string;
  title?: string;
}) {
  const [library, setLibrary] = useState<Exercise[]>([]);
  const [sectionKind, setSectionKind] = useState<SectionKind | null>(fixedSectionKind ?? null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('accessory');
  const [unilateral, setUnilateral] = useState(false);
  const [kg, setKg] = useState('');
  const [setCount, setSetCount] = useState(2);
  const [amount, setAmount] = useState(8);
  const [targetType, setTargetType] = useState<'reps' | 'duration'>('reps');

  useEffect(() => {
    listExercises().then(setLibrary);
  }, []);

  const existing = useMemo(
    () => library.find((e) => e.name.toLowerCase() === name.trim().toLowerCase()),
    [library, name],
  );

  const canAdd = sectionKind !== null && name.trim().length > 0;

  return (
    <div className="rounded-xl bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold">{title}</span>
        <button onClick={onCancel} className="text-sm text-slate-400">
          Cancel
        </button>
      </div>

      {!fixedSectionKind && (
        <div className="mb-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Section</div>
          <div className="grid grid-cols-4 gap-1.5">
            {SECTIONS.map((s) => (
              <button
                key={s.kind}
                onClick={() => setSectionKind(s.kind)}
                className={`rounded-lg py-2 text-xs font-medium ${
                  sectionKind === s.kind ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Exercise</div>
        <input
          list="exercise-library"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Search or type a new name"
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500"
        />
        <datalist id="exercise-library">
          {library.map((e) => (
            <option key={e.id} value={e.name} />
          ))}
        </datalist>
        {existing && <div className="mt-1 text-xs text-emerald-400">In library ✓</div>}
      </div>

      {!existing && name.trim() && (
        <div className="mb-3 flex items-center gap-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="rounded-lg bg-slate-800 px-2 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={unilateral}
              onChange={(e) => setUnilateral(e.target.checked)}
            />
            single-side
          </label>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        <NumberField
          value={String(setCount)}
          onChange={(v) => setSetCount(v === '' ? 1 : Number(v))}
          label="Number of sets"
          min={1}
        />
        <span className="shrink-0 whitespace-nowrap text-slate-500">sets ×</span>
        <NumberField
          value={String(amount)}
          onChange={(v) => setAmount(v === '' ? 1 : Number(v))}
          label={targetType === 'duration' ? 'Seconds per set' : 'Reps per set'}
          step={targetType === 'duration' ? 5 : 1}
          min={1}
        />
        <select
          value={targetType}
          onChange={(e) => {
            const next = e.target.value as 'reps' | 'duration';
            setTargetType(next);
            // sensible default when flipping modes: 8 reps vs 30 seconds
            setAmount(next === 'duration' ? 30 : 8);
          }}
          className="rounded-lg bg-slate-800 px-2 py-2"
        >
          <option value="reps">reps</option>
          <option value="duration">sec</option>
        </select>
        <span className="shrink-0 text-slate-500">@</span>
        <NumberField
          value={kg}
          onChange={setKg}
          label="Kilograms"
          step={2.5}
          decimal
          placeholder="BW"
        />
        <span className="shrink-0 text-slate-500">kg</span>
      </div>

      <button
        disabled={!canAdd}
        onClick={() =>
          onAdd({
            sectionKind: sectionKind!,
            name: name.trim(),
            existing,
            category,
            unilateral,
            kg: kg === '' ? undefined : Number(kg),
            setCount,
            amount,
            targetType,
          })
        }
        className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold disabled:opacity-40 active:bg-sky-500"
      >
        {submitLabel}
      </button>
    </div>
  );
}
