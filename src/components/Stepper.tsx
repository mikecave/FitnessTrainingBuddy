// +/- stepper for 1-10 ratings (effort, fatigue, intensity), 0.5 increments.

export function clampRating(v: number, min = 1, max = 10, step = 0.5): number {
  return Math.min(max, Math.max(min, Math.round(v / step) * step));
}

export function Stepper({
  label,
  value,
  onChange,
  min = 1,
  max = 10,
  step = 0.5,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      {label && <span className="text-sm text-slate-400">{label}</span>}
      <div className="flex items-center gap-1 rounded-full bg-slate-800 p-1">
        <button
          type="button"
          onClick={() => onChange(clampRating(value - step, min, max, step))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-lg leading-none active:bg-slate-600"
        >
          −
        </button>
        <span className="w-10 text-center text-sm font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(clampRating(value + step, min, max, step))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-lg leading-none active:bg-slate-600"
        >
          +
        </button>
      </div>
    </div>
  );
}
