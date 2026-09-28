// Seed data: an example programme of three workouts (upper, lower, micro).
// Deterministic ids so seeding is idempotent; runtime-created records use ULIDs instead.

import {
  CURRENT_USER,
  type Exercise,
  type Load,
  type PlannedSet,
  type SetTarget,
  type Template,
} from './types';

// Deliberately fixed and in the past: seed records must always LOSE a
// last-write-wins merge against anything the user has actually edited. With
// Date.now() here, a freshly-seeded device (a reinstall, a new browser, a test
// run) stamped the built-in templates with "now" and a cloud sync would then
// overwrite real edits with factory defaults.
const SEED_STAMP = Date.UTC(2026, 6, 13); // 2026-07-13, when the seed was authored

// ---- helpers to keep the seed readable ----
const kg = (n: number): Load => ({ type: 'kg', kg: n });
const bw: Load = { type: 'bw' };
const bwPlus = (n: number): Load => ({ type: 'bw_plus_kg', kg: n });
const band: Load = { type: 'band' };

const reps = (n: number): SetTarget => ({ type: 'reps', reps: n });
const amrap: SetTarget = { type: 'amrap' };
const secs = (n: number): SetTarget => ({ type: 'duration', seconds: n });
const loose: SetTarget = { type: 'loose' };

const set = (target: SetTarget, load: Load, mainWork = false): PlannedSet => ({
  target,
  load,
  ...(mainWork ? { mainWork } : {}),
});
const setsOf = (count: number, target: SetTarget, load: Load, mainWork = false): PlannedSet[] =>
  Array.from({ length: count }, () => set(target, load, mainWork));

const ex = (
  id: string,
  name: string,
  category: Exercise['category'],
  opts: Partial<Pick<Exercise, 'unilateral' | 'stickyModifier' | 'notes'>> = {},
): Exercise => ({
  id,
  userId: CURRENT_USER,
  name,
  category,
  unilateral: opts.unilateral ?? false,
  ...(opts.stickyModifier ? { stickyModifier: opts.stickyModifier } : {}),
  ...(opts.notes ? { notes: opts.notes } : {}),
  defaultIntensity: 7,
  updatedAt: SEED_STAMP,
});

// ---- exercise library ----
export const seedExercises: Exercise[] = [
  // shared / upper
  ex('ex-pull-ups', 'Pull-ups', 'strength'),
  ex('ex-bench-press', 'Bench press', 'strength'),
  ex('ex-horizontal-row', 'Horizontal rows', 'strength', { unilateral: true }),
  ex('ex-military-press', 'Military press', 'strength', { unilateral: true }),
  ex('ex-concentration-curls', 'Concentration curls (seated)', 'accessory', { unilateral: true }),
  ex('ex-external-rotation-band', 'External rotation (band)', 'rehab', { unilateral: true }),
  ex('ex-tricep-kickbacks', 'Tricep kickbacks', 'accessory', { unilateral: true }),
  ex('ex-side-lying-capsule-stretch', 'Side-lying shoulder capsule stretch', 'flexibility', { unilateral: true }),
  ex('ex-shoulder-overhead-exploration', 'Shoulder overhead exploration', 'flexibility', { unilateral: true }),
  ex('ex-prone-capsule-stretch', 'Prone capsule stretch', 'flexibility', { unilateral: true }),
  ex('ex-pectoral-stretch', 'Pectoral stretch', 'flexibility', { unilateral: true }),
  // lower
  ex('ex-deadlift', 'Deadlifts', 'strength'),
  ex('ex-rdl-elevated', 'Romanian deadlifts (elevated)', 'strength'),
  ex('ex-step-ups', 'Step-ups', 'strength', { unilateral: true }),
  ex('ex-diagonal-stretch', 'Diagonal stretch', 'flexibility'),
  ex('ex-jefferson-curl', 'Jefferson curl', 'flexibility'),
  ex('ex-single-leg-hip-thrust', 'Single-leg hip thrusts', 'strength', {
    unilateral: true,
    stickyModifier: 'pause at the top',
  }),
  ex('ex-calf-raises', 'Calf raises', 'accessory'),
  ex('ex-tibialis-raises', 'Tibialis raises (against wall)', 'accessory'),
  ex('ex-pancake-stretch', 'Pancake stretch', 'flexibility'),
  ex('ex-couch-stretch', 'Couch stretch', 'flexibility'),
  ex('ex-inversion-straddle', 'Inversion — legs against wall, straddle stretch', 'flexibility', {
    notes: 'With 5 min of 4-7-8 breathing',
  }),
  // micro
  ex('ex-push-ups', 'Push-ups', 'strength', {
    notes: 'Variation chosen ad hoc to make the target reps tough',
  }),
  ex('ex-lower-trap-raises', 'Lower trap raises', 'rehab'),
  ex('ex-internal-rotation-capsule-stretch', 'Internal rotation capsule stretch', 'rehab', {
    unilateral: true,
  }),
  ex('ex-back-to-wall-overhead-reach', 'Back-to-wall overhead reach', 'rehab'),
];

// ---- templates ----
const WARMUP_DESC =
  'Joint rotations · hanging · squat mobilizations · t-spine mobilizations (~12 min)';

const upperBody1: Template = {
  id: 'tpl-upper-1',
  userId: CURRENT_USER,
  name: 'Upper Body 1',
  kind: 'gym',
  updatedAt: SEED_STAMP,
  sections: [
    { kind: 'warmup', logging: 'loose', description: WARMUP_DESC, groups: [] },
    {
      kind: 'primary',
      logging: 'tracked',
      groups: [
        {
          // Superset A
          members: [
            {
              exerciseId: 'ex-pull-ups',
              restAfterSec: 90,
              intensity: 8,
              sets: [
                set(reps(6), bw),
                set(reps(4), bwPlus(5)),
                ...setsOf(3, reps(3), bwPlus(10), true),
              ],
            },
            {
              exerciseId: 'ex-bench-press',
              restAfterSec: 90,
              intensity: 8,
              sets: [
                set(reps(10), kg(30)),
                set(reps(10), kg(40)),
                ...setsOf(2, reps(6), kg(40)),
              ],
            },
          ],
        },
        {
          // Superset B
          members: [
            {
              exerciseId: 'ex-horizontal-row',
              restAfterSec: 90,
              intensity: 7.5,
              sets: setsOf(2, reps(8), kg(20)),
            },
            {
              exerciseId: 'ex-military-press',
              restAfterSec: 90,
              intensity: 8,
              sets: setsOf(2, reps(6), kg(12.5)),
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
              exerciseId: 'ex-concentration-curls',
              restAfterSec: 60,
              intensity: 8,
              sets: setsOf(2, reps(10), kg(10)),
            },
          ],
        },
        {
          members: [
            {
              exerciseId: 'ex-external-rotation-band',
              restAfterSec: 60,
              sets: setsOf(2, reps(12), band),
            },
          ],
        },
        {
          members: [
            {
              exerciseId: 'ex-tricep-kickbacks',
              restAfterSec: 60,
              sets: setsOf(2, reps(8), kg(5)),
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
            { exerciseId: 'ex-side-lying-capsule-stretch', restAfterSec: 0, sets: [set(loose, kg(1))] },
          ],
        },
        {
          members: [
            {
              exerciseId: 'ex-shoulder-overhead-exploration',
              restAfterSec: 0,
              sets: [set(loose, { type: 'as_needed', note: '2kg / 1kg as needed' })],
            },
          ],
        },
        { members: [{ exerciseId: 'ex-prone-capsule-stretch', restAfterSec: 0, sets: [set(loose, bw)] }] },
        { members: [{ exerciseId: 'ex-pectoral-stretch', restAfterSec: 0, sets: [set(loose, bw)] }] },
      ],
    },
  ],
};

const lowerBody1: Template = {
  id: 'tpl-lower-1',
  userId: CURRENT_USER,
  name: 'Lower Body 1',
  kind: 'gym',
  updatedAt: SEED_STAMP,
  sections: [
    { kind: 'warmup', logging: 'loose', description: WARMUP_DESC, groups: [] },
    {
      kind: 'primary',
      logging: 'tracked',
      groups: [
        {
          // straight sets: ramp into main work
          members: [
            {
              exerciseId: 'ex-deadlift',
              restAfterSec: 90,
              intensity: 7,
              sets: [
                set(reps(10), kg(40)),
                set(reps(5), kg(60)),
                set(reps(5), kg(70)),
                set(reps(2), kg(75)),
                ...setsOf(3, reps(3), kg(80), true),
              ],
            },
          ],
        },
        {
          members: [
            {
              exerciseId: 'ex-rdl-elevated',
              restAfterSec: 90,
              intensity: 8,
              sets: setsOf(2, reps(6), kg(50)),
            },
          ],
        },
        {
          // Superset A
          members: [
            { exerciseId: 'ex-step-ups', restAfterSec: 90, intensity: 6.5, sets: setsOf(3, reps(8), bw) },
            { exerciseId: 'ex-diagonal-stretch', restAfterSec: 90, intensity: 7, sets: setsOf(3, reps(8), bw) },
          ],
        },
        {
          // Superset B
          members: [
            { exerciseId: 'ex-jefferson-curl', restAfterSec: 90, sets: setsOf(3, reps(8), kg(10)) },
            { exerciseId: 'ex-single-leg-hip-thrust', restAfterSec: 90, sets: setsOf(3, reps(12), bw) },
          ],
        },
      ],
    },
    {
      kind: 'secondary',
      logging: 'tracked',
      groups: [
        {
          // asymmetric-rest superset: calf raises 0s -> tibialis 60s -> repeat
          members: [
            { exerciseId: 'ex-calf-raises', restAfterSec: 0, sets: setsOf(3, reps(12), kg(30)) },
            { exerciseId: 'ex-tibialis-raises', restAfterSec: 60, sets: setsOf(3, reps(20), bw) },
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
              exerciseId: 'ex-pancake-stretch',
              restAfterSec: 0,
              sets: [set(loose, { type: 'as_needed', note: '12kg weights and BW' })],
            },
          ],
        },
        { members: [{ exerciseId: 'ex-couch-stretch', restAfterSec: 0, sets: [set(loose, bw)] }] },
        {
          members: [
            { exerciseId: 'ex-inversion-straddle', restAfterSec: 0, sets: [set(secs(300), bw)] },
          ],
        },
      ],
    },
  ],
};

const microUpper1: Template = {
  id: 'tpl-micro-upper-1',
  userId: CURRENT_USER,
  name: 'Micro — Upper Body 1',
  kind: 'micro',
  timeCapMin: 30,
  updatedAt: SEED_STAMP,
  sections: [
    // no warm-up: sections are optional per template
    {
      kind: 'primary',
      logging: 'tracked',
      groups: [
        {
          // Superset A
          members: [
            {
              exerciseId: 'ex-pull-ups',
              restAfterSec: 90,
              intensity: 8,
              sets: [
                set(reps(6), bw),
                set(reps(3), bwPlus(5)),
                ...setsOf(2, reps(3), bwPlus(7.5)),
                set(amrap, bw),
              ],
            },
            {
              exerciseId: 'ex-push-ups',
              restAfterSec: 90,
              intensity: 6.5,
              variationNote: 'variation chosen to make 10r tough',
              sets: setsOf(5, reps(10), bw),
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
            { exerciseId: 'ex-lower-trap-raises', restAfterSec: 60, sets: setsOf(3, reps(8), kg(2)) },
          ],
        },
        {
          members: [
            { exerciseId: 'ex-external-rotation-band', restAfterSec: 60, sets: setsOf(3, reps(12), band) },
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
              exerciseId: 'ex-internal-rotation-capsule-stretch',
              restAfterSec: 0,
              sets: setsOf(2, reps(8), kg(1)),
            },
          ],
        },
        {
          members: [
            { exerciseId: 'ex-back-to-wall-overhead-reach', restAfterSec: 0, sets: setsOf(2, secs(30), bw) },
          ],
        },
      ],
    },
  ],
};

export const seedTemplates: Template[] = [upperBody1, lowerBody1, microUpper1];
