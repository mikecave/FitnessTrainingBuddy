// Numeric entry with ▲▼ step arrows on the right.
//
// Two jobs, both learned from real gym use:
//  1. Never clip a digit. These fields live in crowded flex rows where every
//     sibling label carries `shrink-0`; the inputs did not, so on a narrow
//     phone they were the items that gave way and a leading digit scrolled out
//     of sight — editing a half-hidden "10" silently produced "110" reps.
//     Hence `shrink-0` plus a width sized for three digits.
//  2. ±1 tweaks without the keyboard, because mid-set the common edit is
//     "one more rep than last time".
//
// Input is capped at 3 digits (max 999) by the accept pattern, so an
// over-typed 4th digit is impossible rather than merely unlikely.

export function NumberField({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  decimal = false,
  placeholder,
  label,
  tone = 'panel',
}: {
  /** Held as a string so a mid-edit empty field is representable. */
  value: string;
  onChange: (next: string) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Allow one decimal place (loads in kg). */
  decimal?: boolean;
  placeholder?: string;
  /** Accessible name; the arrows derive theirs from it. */
  label: string;
  /** `row` sits on slate-800 rows, `panel` on slate-900 panels. */
  tone?: 'row' | 'panel';
}) {
  const field = tone === 'row' ? 'bg-slate-700' : 'bg-slate-800';
  const arrows = tone === 'row' ? 'bg-slate-600/70' : 'bg-slate-700/70';
  const accept = decimal ? /^\d{0,3}([.,]\d{0,2})?$/ : /^\d{0,3}$/;

  function bump(delta: number) {
    const parsed = Number(value.replace(',', '.'));
    const base = value === '' || !Number.isFinite(parsed) ? 0 : parsed;
    const next = Math.min(max, Math.max(min, base + delta));
    // Keep 0.5-step loads from drifting into 22.500000000000004.
    onChange(String(Math.round(next * 100) / 100));
  }

  return (
    <span className="flex shrink-0 items-stretch">
      <input
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '' || accept.test(raw)) onChange(raw.replace(',', '.'));
        }}
        className={`w-14 shrink-0 rounded-l ${field} px-1.5 py-1.5 text-center text-sm tabular-nums placeholder:text-slate-500`}
      />
      <span className={`flex shrink-0 flex-col overflow-hidden rounded-r ${arrows}`}>
        <button
          type="button"
          aria-label={`${label} up`}
          onClick={() => bump(step)}
          className="flex h-1/2 w-5 items-center justify-center text-[8px] leading-none text-slate-300 active:bg-slate-500"
        >
          ▲
        </button>
        <button
          type="button"
          aria-label={`${label} down`}
          onClick={() => bump(-step)}
          className="flex h-1/2 w-5 items-center justify-center text-[8px] leading-none text-slate-300 active:bg-slate-500"
        >
          ▼
        </button>
      </span>
    </span>
  );
}
