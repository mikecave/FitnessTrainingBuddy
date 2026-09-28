import { describe, expect, it } from 'vitest';
import { markdownFilename, sessionToMarkdown } from './markdown';
import { dayLabel, mondayOf, weekLabel } from './weeks';
import type { Exercise, Session } from '../data/types';

const exercises = new Map<string, Exercise>([
  [
    'ex-pull',
    {
      id: 'ex-pull',
      userId: 'mike',
      name: 'Pull-ups',
      category: 'strength',
      unilateral: false,
      defaultIntensity: 7,
      updatedAt: 0,
    },
  ],
  [
    'ex-row',
    {
      id: 'ex-row',
      userId: 'mike',
      name: 'Horizontal rows',
      category: 'strength',
      unilateral: true,
      defaultIntensity: 7,
      updatedAt: 0,
    },
  ],
  [
    'ex-stretch',
    {
      id: 'ex-stretch',
      userId: 'mike',
      name: 'Pectoral stretch',
      category: 'flexibility',
      unilateral: false,
      defaultIntensity: 7,
      updatedAt: 0,
    },
  ],
]);

const session: Session = {
  id: 's1',
  userId: 'mike',
  templateId: 'tpl-x',
  date: '2026-08-10',
  startedAt: new Date(2026, 7, 10, 13, 5).getTime(),
  finishedAt: new Date(2026, 7, 10, 14, 10).getTime(),
  startingFatigue: 3,
  overallEffort: 8,
  endingFatigue: 5,
  notes: 'strong day',
  status: 'done',
  updatedAt: 0,
  sections: [
    {
      kind: 'warmup',
      logging: 'loose',
      description: 'Joint rotations (~10 min)',
      groups: [],
    },
    {
      kind: 'primary',
      logging: 'tracked',
      groups: [
        {
          members: [
            {
              exerciseId: 'ex-pull',
              intensity: 8,
              restAfterSec: 90,
              sets: [
                { target: { type: 'reps', reps: 6 }, load: { type: 'bw' }, warmup: true, done: true, actualReps: 6 },
                { target: { type: 'reps', reps: 3 }, load: { type: 'bw_plus_kg', kg: 12.5 }, mainWork: true, done: true, actualReps: 3 },
                { target: { type: 'reps', reps: 3 }, load: { type: 'bw_plus_kg', kg: 12.5 }, mainWork: true, done: true, actualReps: 3 },
                { target: { type: 'reps', reps: 3 }, load: { type: 'bw_plus_kg', kg: 12.5 }, mainWork: true, done: false },
              ],
            },
            {
              exerciseId: 'ex-row',
              intensity: 7.5,
              restAfterSec: 90,
              sets: [
                { target: { type: 'reps', reps: 8 }, load: { type: 'kg', kg: 25 }, done: true, actualReps: 8 },
              ],
            },
          ],
        },
      ],
    },
    {
      kind: 'secondary',
      logging: 'tracked',
      groups: [
        {
          members: [
            {
              exerciseId: 'ex-row',
              intensity: 7,
              restAfterSec: 60,
              skipped: true,
              sets: [{ target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 10 }, done: false }],
            },
          ],
        },
      ],
    },
    {
      kind: 'cooldown',
      logging: 'loose',
      groups: [
        {
          members: [
            {
              exerciseId: 'ex-stretch',
              intensity: 7,
              restAfterSec: 0,
              sets: [
                { target: { type: 'duration', seconds: 30 }, load: { type: 'bw' }, done: true, actualSeconds: 30 },
                { target: { type: 'duration', seconds: 30 }, load: { type: 'bw' }, done: true, actualSeconds: 30 },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('sessionToMarkdown', () => {
  const md = sessionToMarkdown(session, 'Upper Body 1', exercises);

  it('renders header, sections, and session close in the seed format', () => {
    expect(md).toContain('# Upper Body 1 — 2026-08-10');
    expect(md).toContain('## Warm-up');
    expect(md).toContain('Joint rotations (~10 min)');
    expect(md).toContain('**Starting fatigue:** 3/10');
    expect(md).toContain('## Session close');
    expect(md).toContain('- Overall effort: 8/10');
    expect(md).toContain('- Ending fatigue: 5/10');
    expect(md).toContain('- Notes: strong day');
  });

  it('renders supersets with shared-rest note and continuous exercise numbering', () => {
    expect(md).toContain('### Superset A — 90s rest after each movement');
    expect(md).toContain('**1. Pull-ups** — intensity 8/10');
    expect(md).toContain('**2. Horizontal rows** — single-side — intensity 7.5/10');
  });

  it('leaves skipped exercises out entirely, renumbering what remains', () => {
    expect(md).not.toContain('skipped today');
    // the secondary section held only the skipped exercise, so it goes too
    expect(md).not.toContain('## Secondary');
    // ...and the cool-down stretch moves up from 4 to 3
    expect(md).toContain('**3. Pectoral stretch**');
  });

  it('renders set tables with collapsing, warm-up marks, per-side reps, and un-done dashes', () => {
    expect(md).toContain('| 1 | BW | 6 (w) |');
    expect(md).toContain('| 2–3 | BW+12.5kg | 3 |');
    expect(md).toContain('| 4 | BW+12.5kg | — |');
    expect(md).toContain('| 1 | 25kg | 8 / side |');
  });

  it('renders loose cool-down items as bullets with a done tick', () => {
    expect(md).toContain('- **3. Pectoral stretch** — 2×30s @ BW ✓');
  });

  it('renders workout length when it was recorded, and omits the line when not', () => {
    expect(md).not.toContain('- Duration:');
    const timed = sessionToMarkdown({ ...session, durationMin: 72 }, 'Upper Body 1', exercises);
    expect(timed).toContain('- Duration: 72 min');
  });

  it('drops a superset heading when skips leave only one movement', () => {
    const halfSkipped: Session = {
      ...session,
      sections: session.sections.map((sec) =>
        sec.kind === 'primary'
          ? {
              ...sec,
              groups: [
                {
                  members: sec.groups[0].members.map((m, i) =>
                    i === 1 ? { ...m, skipped: true } : m,
                  ),
                },
              ],
            }
          : sec,
      ),
    };
    const out = sessionToMarkdown(halfSkipped, 'Upper Body 1', exercises);
    expect(out).not.toContain('### Superset');
    expect(out).toContain('**1. Pull-ups** — intensity 8/10');
  });

  it('keeps a description-only section, which has content beyond its exercises', () => {
    // the seed templates' warm-up is exactly this shape: a description and no
    // tracked groups. Dropping it would lose a prescription.
    expect(md).toContain('## Warm-up');
    expect(md).toContain('Joint rotations (~10 min)');
  });

  it('keeps an emptied warm-up section when it carries the starting fatigue', () => {
    const allSkipped: Session = {
      ...session,
      sections: session.sections.map((sec) => ({
        ...sec,
        groups: sec.groups.map((g) => ({ members: g.members.map((m) => ({ ...m, skipped: true })) })),
      })),
    };
    const out = sessionToMarkdown(allSkipped, 'Upper Body 1', exercises);
    expect(out).toContain('## Warm-up');
    expect(out).toContain('**Starting fatigue:** 3/10');
    expect(out).not.toContain('## Primary');
    expect(out).not.toContain('## Cool-down');
  });

  it('builds a dated slug filename', () => {
    expect(markdownFilename(session, 'Upper Body 1')).toBe('2026-08-10-upper-body-1.md');
  });
});

describe('week helpers', () => {
  it('mondayOf maps any weekday to that week\'s Monday', () => {
    expect(mondayOf('2026-08-10')).toBe('2026-08-10'); // a Monday
    expect(mondayOf('2026-08-13')).toBe('2026-08-10'); // Thursday
    expect(mondayOf('2026-08-16')).toBe('2026-08-10'); // Sunday stays in the Monday-started week
    expect(mondayOf('2026-08-09')).toBe('2026-08-03'); // the Sunday before
  });

  it('labels weeks Monday–Sunday and days with weekday names', () => {
    expect(weekLabel('2026-08-10')).toBe('Mon 10 Aug – Sun 16 Aug');
    expect(dayLabel('2026-08-13')).toBe('Thu 13 Aug');
  });
});

describe('single-side set tables', () => {
  it('adds a Side column and numbers each L/R pair once', () => {
    const exercise: Exercise = {
      id: 'ex-slp',
      userId: 'mike',
      name: 'Single-leg press',
      category: 'strength',
      unilateral: true,
      defaultIntensity: 7,
      updatedAt: 0,
    };
    const session: Session = {
      id: 's1',
      userId: 'mike',
      templateId: 't1',
      date: '2026-08-18',
      startedAt: Date.parse('2026-08-18T09:00:00Z'),
      status: 'done',
      sections: [
        {
          kind: 'primary',
          logging: 'tracked',
          groups: [
            {
              members: [
                {
                  exerciseId: 'ex-slp',
                  intensity: 7,
                  restAfterSec: 60,
                  sets: [
                    { target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 12 }, side: 'L', actualReps: 10, done: true },
                    { target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 12 }, side: 'R', actualReps: 7, done: true },
                    { target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 12 }, side: 'L', actualReps: 9, done: true },
                    { target: { type: 'reps', reps: 10 }, load: { type: 'kg', kg: 12 }, side: 'R', actualReps: 6, done: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
      updatedAt: 0,
    };

    const md = sessionToMarkdown(session, 'Legs', new Map([['ex-slp', exercise]]));
    expect(md).toContain('| Set | Side | Load | Reps |');
    expect(md).toContain('| 1 | L | 12kg | 10 |');
    expect(md).toContain('| 1 | R | 12kg | 7 |');
    expect(md).toContain('| 2 | L | 12kg | 9 |');
    expect(md).toContain('| 2 | R | 12kg | 6 |');
    // the explicit Side column replaces the old "/ side" suffix
    expect(md).not.toContain('/ side');
  });
});

describe('by-feel rendering in the markdown mirror', () => {
  const exercise: Exercise = {
    id: 'ex-bp', userId: 'mike', name: 'Band pull-apart', category: 'movement',
    unilateral: false, defaultIntensity: 7, updatedAt: 0,
  };

  function sessionWith(byFeel: boolean | undefined): Session {
    return {
      id: 's1', userId: 'mike', templateId: 't1', date: '2026-09-15',
      startedAt: Date.parse('2026-09-15T09:00:00Z'), status: 'done', updatedAt: 0,
      sections: [{
        kind: 'warmup', logging: 'loose',
        groups: [{ members: [{
          exerciseId: 'ex-bp', intensity: 7, restAfterSec: 30,
          ...(byFeel === undefined ? {} : { byFeel }),
          sets: [{ target: { type: 'reps', reps: 15 }, load: { type: 'band' }, actualReps: 15, done: true }],
        }] }],
      }],
    };
  }

  it('renders a prescribed warm-up exercise as a set table', () => {
    const md = sessionToMarkdown(sessionWith(false), 'Upper', new Map([['ex-bp', exercise]]));
    expect(md).toContain('| Set | Load | Reps |');
  });

  it('keeps a by-feel exercise as a one-line bullet', () => {
    const md = sessionToMarkdown(sessionWith(undefined), 'Upper', new Map([['ex-bp', exercise]]));
    expect(md).not.toContain('| Set | Load | Reps |');
    expect(md).toContain('Band pull-apart');
  });
});
