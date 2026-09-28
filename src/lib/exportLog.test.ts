import { describe, expect, it } from 'vitest';
import { buildLogFiles } from './exportLog';
import type { Session, Template } from '../data/types';

function session(over: Partial<Session>): Session {
  return {
    id: 's1',
    userId: 'mike',
    templateId: 't1',
    date: '2026-09-22',
    // 12:05 UTC is 13:05 in London (BST, UTC+1).
    startedAt: Date.UTC(2026, 8, 22, 12, 5),
    status: 'done',
    sections: [],
    updatedAt: 1,
    ...over,
  };
}

const templates = [{ id: 't1', name: 'Gym A' } as Template];

describe('buildLogFiles', () => {
  it('writes finished workouts only, with fitbuddy frontmatter', () => {
    const files = buildLogFiles(
      [session({}), session({ id: 's2', status: 'active', date: '2026-09-23' })],
      templates,
      [],
    );
    expect(files.map((f) => f.path)).toEqual(['2026-09-22-gym-a.md']);
    expect(files[0].content).toMatch(/^---\nsource: fitbuddy\nsession: s1\n/);
    expect(files[0].content).toContain('# Gym A — 2026-09-22');
  });

  it('renders times in the configured zone, not the UTC the Worker runs in', () => {
    const [file] = buildLogFiles([session({})], templates, [], 'Europe/London');
    expect(file.content).toContain('started 13:05');
  });

  it('gives a second same-day, same-name workout its own file, stably', () => {
    const later = session({ id: 's2', startedAt: Date.UTC(2026, 8, 22, 18, 0) });
    const paths = (list: Session[]) => buildLogFiles(list, templates, []).map((f) => f.path);
    expect(paths([later, session({})])).toEqual(['2026-09-22-gym-a.md', '2026-09-22-gym-a-2.md']);
    // Input order must not decide which one is "-2".
    expect(paths([session({}), later])).toEqual(paths([later, session({})]));
  });
});
