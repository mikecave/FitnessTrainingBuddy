// The workout log as a set of files, for the nightly push into a personal
// wiki (functions/api/export.ts serves it; a GitHub Action in that repo
// writes it into areas/Sports and Fitness/Log/).
//
// Pure: takes the synced records, returns { path, content }. Each file is the
// same markdown mirror the app shows under History, with frontmatter on top.
// The frontmatter's `source: fitbuddy` is what lets the Action tell its own
// files from notes the user writes in that folder by hand — only files carrying it
// are ever rewritten or deleted there.

import type { Exercise, Session, Template } from '../data/types';
import { markdownFilename, sessionToMarkdown } from './markdown';

export interface LogFile {
  path: string;
  content: string;
}

/** The export runs in a UTC Worker, so the zone to render times in comes
 *  from the LOG_TIME_ZONE var (e.g. "Europe/London"); UTC if unset. */
export const LOG_TIME_ZONE = 'UTC';

export function buildLogFiles(
  sessions: Session[],
  templates: Template[],
  exerciseList: Exercise[],
  timeZone: string = LOG_TIME_ZONE,
): LogFile[] {
  const templateNames = new Map(templates.map((t) => [t.id, t.name]));
  const exercises = new Map(exerciseList.map((e) => [e.id, e]));

  // Oldest first, so when two workouts share a date and a name the earlier one
  // keeps the plain filename and the later one gets "-2". Stable across runs,
  // since startedAt never changes once a session exists.
  const done = sessions
    .filter((s) => s.status === 'done')
    .sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt);

  const used = new Set<string>();
  const files: LogFile[] = [];
  for (const session of done) {
    const name = templateNames.get(session.templateId) ?? 'Workout';
    let path = markdownFilename(session, name);
    for (let n = 2; used.has(path); n++) {
      path = markdownFilename(session, name).replace(/\.md$/, `-${n}.md`);
    }
    used.add(path);

    const frontmatter = [
      '---',
      'source: fitbuddy',
      `session: ${session.id}`,
      `date: ${session.date}`,
      `workout: ${JSON.stringify(name)}`,
      ...(session.weekType ? [`week: ${session.weekType}`] : []),
      'tags: [fitness-log]',
      '---',
      '',
    ].join('\n');
    files.push({
      path,
      content: frontmatter + sessionToMarkdown(session, name, exercises, timeZone),
    });
  }
  return files;
}
