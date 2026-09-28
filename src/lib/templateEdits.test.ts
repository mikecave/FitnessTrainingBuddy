import { describe, expect, it } from 'vitest';
import { regroupInTemplate } from './templateEdits';
import type { GroupMember, Template } from '../data/types';

function gm(exerciseId: string, reps = 8): GroupMember {
  return { exerciseId, restAfterSec: 60, sets: [{ target: { type: 'reps', reps }, load: { type: 'bw' } }] };
}

function template(primary: GroupMember[][], secondary: GroupMember[][] = []): Template {
  return {
    id: 't1',
    userId: 'mike',
    name: 'Gym A',
    kind: 'gym',
    sections: [
      { kind: 'primary', logging: 'tracked', groups: primary.map((members) => ({ members })) },
      { kind: 'secondary', logging: 'tracked', groups: secondary.map((members) => ({ members })) },
    ],
    updatedAt: 0,
  };
}

const shape = (t: Template) =>
  t.sections.map((s) => s.groups.map((g) => g.members.map((m) => m.exerciseId)));

describe('regroupInTemplate', () => {
  it('pairs two straight sets into a superset where the first one was', () => {
    const t = template([[gm('a')], [gm('b')], [gm('c')]]);
    expect(shape(regroupInTemplate(t, 'primary', [gm('a'), gm('c')]))).toEqual([[['a', 'c'], ['b']], []]);
  });

  it('unpairing leaves the exercise directly below its old superset', () => {
    const t = template([[gm('a'), gm('b')], [gm('c')]]);
    expect(shape(regroupInTemplate(t, 'primary', [gm('b')]))).toEqual([[['a'], ['b'], ['c']], []]);
  });

  it('keeps the template prescription for exercises already in it', () => {
    const t = template([[gm('a', 10)], [gm('b', 10)]]);
    const out = regroupInTemplate(t, 'primary', [gm('a', 3), gm('b', 3)]);
    expect(out.sections[0].groups[0].members.map((m) => m.sets[0].target)).toEqual([
      { type: 'reps', reps: 10 },
      { type: 'reps', reps: 10 },
    ]);
  });

  it('adds an exercise new to the template with the prescription given', () => {
    const t = template([[gm('a')]]);
    const out = regroupInTemplate(t, 'primary', [gm('a'), gm('new', 12)]);
    expect(shape(out)).toEqual([[['a', 'new']], []]);
    expect(out.sections[0].groups[0].members[1].sets[0].target).toEqual({ type: 'reps', reps: 12 });
  });

  it('moves an exercise across sections without leaving a copy behind', () => {
    const t = template([[gm('a')]], [[gm('x')], [gm('y')]]);
    expect(shape(regroupInTemplate(t, 'primary', [gm('a'), gm('x')]))).toEqual([[['a', 'x']], [['y']]]);
  });

  it('creates the section when the template lacks it', () => {
    const t = { ...template([[gm('a')]]), sections: template([[gm('a')]]).sections.slice(0, 1) };
    const out = regroupInTemplate(t, 'cooldown', [gm('z')]);
    expect(out.sections.map((s) => [s.kind, s.logging])).toEqual([['primary', 'tracked'], ['cooldown', 'loose']]);
  });
});
