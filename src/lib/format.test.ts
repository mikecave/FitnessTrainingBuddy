import { describe, expect, it } from 'vitest';
import { formatLoad, formatSets, formatTarget } from './format';
import { seedExercises, seedTemplates } from '../data/seed';

describe('formatLoad', () => {
  it('formats all load types', () => {
    expect(formatLoad({ type: 'kg', kg: 27.5 })).toBe('27.5kg');
    expect(formatLoad({ type: 'bw' })).toBe('BW');
    expect(formatLoad({ type: 'bw_plus_kg', kg: 12.5 })).toBe('BW+12.5kg');
    expect(formatLoad({ type: 'band' })).toBe('band');
    expect(formatLoad({ type: 'as_needed', note: '2kg / 1kg as needed' })).toBe('2kg / 1kg as needed');
  });
});

describe('formatTarget', () => {
  it('formats reps, amrap, duration', () => {
    expect(formatTarget({ type: 'reps', reps: 8 })).toBe('8r');
    expect(formatTarget({ type: 'reps', reps: 8 }, true)).toBe('8r/side');
    expect(formatTarget({ type: 'amrap' })).toBe('max reps');
    expect(formatTarget({ type: 'duration', seconds: 30 })).toBe('30s');
    expect(formatTarget({ type: 'duration', seconds: 300 })).toBe('5min');
  });
});

describe('formatSets', () => {
  it('collapses identical consecutive sets and marks main work', () => {
    const line = formatSets([
      { target: { type: 'reps', reps: 6 }, load: { type: 'bw' } },
      { target: { type: 'reps', reps: 4 }, load: { type: 'bw_plus_kg', kg: 10 } },
      { target: { type: 'reps', reps: 3 }, load: { type: 'bw_plus_kg', kg: 12.5 }, mainWork: true },
      { target: { type: 'reps', reps: 3 }, load: { type: 'bw_plus_kg', kg: 12.5 }, mainWork: true },
      { target: { type: 'reps', reps: 3 }, load: { type: 'bw_plus_kg', kg: 12.5 }, mainWork: true },
    ]);
    expect(line).toBe('6r @ BW · 4r @ BW+10kg · 3×3r @ BW+12.5kg ★');
  });

  it('marks warm-up sets with (w) and keeps them distinct from identical work sets', () => {
    const line = formatSets([
      { target: { type: 'reps', reps: 8 }, load: { type: 'kg', kg: 40 }, warmup: true },
      { target: { type: 'reps', reps: 8 }, load: { type: 'kg', kg: 40 }, warmup: true },
      { target: { type: 'reps', reps: 8 }, load: { type: 'kg', kg: 40 } },
      { target: { type: 'reps', reps: 5 }, load: { type: 'kg', kg: 80 }, mainWork: true },
    ]);
    expect(line).toBe('2×8r @ 40kg (w) · 8r @ 40kg · 5r @ 80kg ★');
  });
});

describe('seed integrity', () => {
  it('every exercise referenced by a template exists in the library', () => {
    const ids = new Set(seedExercises.map((e) => e.id));
    for (const t of seedTemplates) {
      for (const s of t.sections) {
        for (const g of s.groups) {
          for (const m of g.members) {
            expect(ids.has(m.exerciseId), `${t.name}: missing ${m.exerciseId}`).toBe(true);
          }
        }
      }
    }
  });

  it('has the three seed workouts', () => {
    expect(seedTemplates.map((t) => t.name)).toEqual([
      'Upper Body 1',
      'Lower Body 1',
      'Micro — Upper Body 1',
    ]);
  });

  it('deadlift has exactly 3 main work sets at 80kg', () => {
    const lower = seedTemplates.find((t) => t.id === 'tpl-lower-1')!;
    const deadlift = lower.sections
      .flatMap((s) => s.groups)
      .flatMap((g) => g.members)
      .find((m) => m.exerciseId === 'ex-deadlift')!;
    const main = deadlift.sets.filter((s) => s.mainWork);
    expect(main).toHaveLength(3);
    expect(main.every((s) => s.load.type === 'kg' && s.load.kg === 80)).toBe(true);
  });
});
