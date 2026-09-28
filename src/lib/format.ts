// Compact human-readable formatting for loads/sets. Reused later by the
// markdown mirror generator, so keep it pure and tested.

import type { Load, PlannedSet, SetTarget } from '../data/types';

export function formatLoad(load: Load): string {
  switch (load.type) {
    case 'kg':
      return `${load.kg}kg`;
    case 'bw':
      return 'BW';
    case 'bw_plus_kg':
      return `BW+${load.kg}kg`;
    case 'band':
      return 'band';
    case 'as_needed':
      return load.note ?? 'as needed';
  }
}

export function formatTarget(target: SetTarget, perSide = false): string {
  const side = perSide ? '/side' : '';
  switch (target.type) {
    case 'reps':
      return `${target.reps}r${side}`;
    case 'amrap':
      return `max reps${side}`;
    case 'duration':
      return target.seconds % 60 === 0 ? `${target.seconds / 60}min` : `${target.seconds}s`;
    case 'loose':
      return '';
  }
}

function sameSet(a: PlannedSet, b: PlannedSet): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** "2×6r @ BW (w) · 4r @ BW+10kg · 3×3r @ BW+15kg ★" (★ = main work sets, (w) = warm-up sets)
 *
 *  Single-side work is stored one row per side (L, R, L, R…). A summary reads
 *  better as the per-side prescription than as every row, so we summarise from
 *  one side and mark it "/side". Note this shows the first side's numbers, which
 *  is the prescription; the per-side detail lives in the logged set table. */
export function formatSets(sets: PlannedSet[], perSide = false): string {
  const firstSided = sets.find((s) => s.side);
  if (firstSided) {
    const oneSide = sets.filter((s) => s.side === firstSided.side);
    return formatSetList(oneSide, true);
  }
  return formatSetList(sets, perSide);
}

function formatSetList(sets: PlannedSet[], perSide: boolean): string {
  const parts: string[] = [];
  let i = 0;
  while (i < sets.length) {
    let j = i;
    while (j + 1 < sets.length && sameSet(sets[j + 1], sets[i])) j++;
    const n = j - i + 1;
    const s = sets[i];
    const target = formatTarget(s.target, perSide && s.target.type !== 'duration');
    const count = n > 1 ? `${n}×` : '';
    let body = target
      ? `${count}${target} @ ${formatLoad(s.load)}`
      : `${count ? `${count} ` : ''}${formatLoad(s.load)}`.trim();
    if (s.warmup) body += ' (w)';
    parts.push(s.mainWork ? `${body} ★` : body);
    i = j + 1;
  }
  return parts.join(' · ');
}
