// Markdown mirror generator — renders a logged session in the approved
// seed-workout format. Pure, so it can later feed the
// continuous file mirror (File System Access API / Obsidian folder).

import type { Exercise, Feedback, LoggedSet, Session, SessionExercise } from '../data/types';
import { isByFeel } from './logging';
import { formatLoad, formatSets, formatTarget } from './format';

const SECTION_TITLES: Record<string, string> = {
  warmup: 'Warm-up',
  primary: 'Primary',
  secondary: 'Secondary',
  cooldown: 'Cool-down',
};

const WEEK_LABELS: Record<string, string> = {
  build: 'build week',
  peak: 'peak week',
  deload: 'deload week',
};

/** `timeZone` is left to the device in the app. The server-side export must
 *  pass one: a Cloudflare Worker runs in UTC, which would put a 13:05 London
 *  start at 12:05 in the file. Always 24-hour, as in the seed workouts — a
 *  Worker's default locale is en-US and would otherwise write "01:05 PM". */
function fmtTime(ts: number, timeZone?: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
}

function repsCell(set: LoggedSet, unilateral: boolean): string {
  // With an explicit side the Side column already says which, so "/ side" would
  // double up. It stays for legacy rows, where one row did mean both sides.
  const side = unilateral && !set.side ? ' / side' : '';
  const warmupMark = set.warmup ? ' (w)' : '';
  if (!set.done) return `—${warmupMark}`;
  if (set.actualSeconds !== undefined) {
    const secs =
      set.actualSeconds >= 60 && set.actualSeconds % 60 === 0
        ? `${set.actualSeconds / 60}min`
        : `${set.actualSeconds}s`;
    return `${secs}${warmupMark}`;
  }
  if (set.actualReps !== undefined) return `${set.actualReps}${side}${warmupMark}`;
  return `${formatTarget(set.target, unilateral) || '✓'}${warmupMark}`;
}

/** | Set | Load | Reps | with consecutive identical sets collapsed ("1–3").
 *
 *  Single-side work gains a Side column and numbers each PAIR once, so three
 *  sets each side read as 1 L, 1 R, 2 L, 2 R, 3 L, 3 R. Collapsing is disabled
 *  there: alternating sides mean neighbouring rows are rarely identical, and
 *  seeing each side's actual numbers is the point. */
function setTable(member: SessionExercise, unilateral: boolean): string {
  const sided = member.sets.some((s) => s.side);

  if (sided) {
    const rows: string[] = ['| Set | Side | Load | Reps |', '|---|---|---|---|'];
    let pair = 0;
    for (const [i, set] of member.sets.entries()) {
      // A new pair starts on each L, or whenever the side repeats.
      if (set.side === 'L' || i === 0 || member.sets[i - 1].side === set.side) pair++;
      rows.push(
        `| ${pair} | ${set.side ?? '—'} | ${formatLoad(set.load)} | ${repsCell(set, unilateral)} |`,
      );
    }
    return rows.join('\n');
  }

  const rows: string[] = ['| Set | Load | Reps |', '|---|---|---|'];
  const cells = member.sets.map((s) => ({ load: formatLoad(s.load), reps: repsCell(s, unilateral) }));
  let i = 0;
  while (i < cells.length) {
    let j = i;
    while (
      j + 1 < cells.length &&
      cells[j + 1].load === cells[i].load &&
      cells[j + 1].reps === cells[i].reps
    ) {
      j++;
    }
    const label = j > i ? `${i + 1}–${j + 1}` : `${i + 1}`;
    rows.push(`| ${label} | ${cells[i].load} | ${cells[i].reps} |`);
    i = j + 1;
  }
  return rows.join('\n');
}

function exerciseHeading(
  n: number,
  member: SessionExercise,
  exercise: Exercise,
  tracked: boolean,
): string {
  const mods = [
    exercise.unilateral ? 'single-side' : null,
    exercise.stickyModifier ?? null,
    member.variationNote ?? null,
  ]
    .filter(Boolean)
    .join(', ');
  const parts = [`**${n}. ${exercise.name}**`];
  if (mods) parts.push(mods);
  if (tracked) parts.push(`intensity ${member.intensity}/10`);
  return parts.join(' — ');
}

export function sessionToMarkdown(
  session: Session,
  templateName: string,
  exercises: Map<string, Exercise>,
  timeZone?: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${templateName} — ${session.date}`);
  lines.push('');
  const times = [`started ${fmtTime(session.startedAt, timeZone)}`];
  if (session.finishedAt) times.push(`finished ${fmtTime(session.finishedAt, timeZone)}`);
  // The week type belongs in the header rather than the close block: reading
  // back through history, "was this a deload?" is the first question that
  // makes the numbers underneath make sense.
  const week = session.weekType ? `${WEEK_LABELS[session.weekType]} — ` : '';
  lines.push(`*Logged session — ${week}${times.join(', ')}.*`);

  let exerciseNo = 0;
  let supersetLetter = 'A'.charCodeAt(0);

  for (const section of session.sections) {
    // Skipped exercises are dropped from the mirror entirely rather than
    // rendered as "skipped today": the file is a record of what was trained,
    // and a list of non-events made it harder to read. The skip is still in
    // the data (and still resets on copy-forward) — it just isn't history.
    // Filtering here also renumbers what remains and collapses a superset that
    // lost a member back to plain sets.
    const groups = section.groups
      .map((group) => ({
        ...group,
        members: group.members.filter(
          (m) => !m.skipped && exercises.has(m.exerciseId),
        ),
      }))
      .filter((group) => group.members.length > 0);

    // A section with nothing left to show goes too — but only if the heading
    // was all it had. A warm-up always carries the starting-fatigue reading
    // (session data, not exercise data), and a section description is a real
    // prescription the user wrote ("Joint rotations · hanging (~12 min)"), so
    // either one keeps the section in the file.
    const hasContentBesidesExercises = section.kind === 'warmup' || Boolean(section.description);
    if (groups.length === 0 && !hasContentBesidesExercises) continue;

    lines.push('');
    lines.push(`## ${SECTION_TITLES[section.kind]}`);
    if (section.description) {
      lines.push('');
      lines.push(section.description);
    }
    if (section.kind === 'warmup') {
      lines.push('');
      lines.push(`**Starting fatigue:** ${session.startingFatigue ?? '—'}/10`);
    }

    for (const group of groups) {
      const isSuperset = group.members.length > 1;
      if (isSuperset) {
        const rests = new Set(group.members.map((m) => m.restAfterSec));
        const restNote =
          rests.size === 1 ? ` — ${group.members[0].restAfterSec}s rest after each movement` : '';
        lines.push('');
        lines.push(`### Superset ${String.fromCharCode(supersetLetter++)}${restNote}`);
      }

      for (const member of group.members) {
        const exercise = exercises.get(member.exerciseId);
        if (!exercise) continue;
        exerciseNo++;

        if (isByFeel(section, member)) {
          const allDone = member.sets.length > 0 && member.sets.every((s) => s.done);
          const prescription = formatSets(member.sets, exercise.unilateral);
          lines.push(
            `- ${exerciseHeading(exerciseNo, member, exercise, false)} — ${prescription}${allDone ? ' ✓' : ''}`,
          );
          continue;
        }

        lines.push('');
        lines.push(exerciseHeading(exerciseNo, member, exercise, true));
        lines.push(setTable(member, exercise.unilateral));
      }
    }
  }

  if (session.observations?.length) {
    lines.push('');
    lines.push('## Notes during the workout');
    lines.push('');
    for (const o of session.observations) {
      lines.push(`- ${fmtTime(o.at, timeZone)} — ${o.text}`);
    }
  }

  lines.push('');
  lines.push('## Session close');
  lines.push('');
  lines.push(`- Overall effort: ${session.overallEffort ?? '—'}/10`);
  if (session.avgHeartRate || session.maxHeartRate) {
    const hr = [
      session.avgHeartRate ? `avg ${session.avgHeartRate}` : null,
      session.maxHeartRate ? `max ${session.maxHeartRate}` : null,
    ].filter(Boolean);
    lines.push(`- Heart rate: ${hr.join(', ')} bpm`);
  }
  lines.push(`- Ending fatigue: ${session.endingFatigue ?? '—'}/10`);
  if (session.durationMin !== undefined) lines.push(`- Duration: ${session.durationMin} min`);
  if (session.notes) lines.push(`- Notes: ${session.notes}`);
  lines.push('');
  return lines.join('\n');
}

export function markdownFilename(session: Session, templateName: string): string {
  const slug = templateName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${session.date}-${slug}.md`;
}

/** Render app-feedback notes as markdown, shaped to be pasted straight into a
 *  Claude prompt: one bullet per item, newest last so the list reads
 *  chronologically, with the workout each was raised during. */
export function feedbackToMarkdown(
  items: Feedback[],
  sessionLabels: Map<string, string> = new Map(),
): string {
  if (items.length === 0) return 'No app feedback recorded.';
  const lines = ['# FitBuddy app feedback', ''];
  const oldestFirst = [...items].sort((a, b) => a.createdAt - b.createdAt);
  for (const item of oldestFirst) {
    const where = item.sessionId ? sessionLabels.get(item.sessionId) : undefined;
    const stamp = new Date(item.createdAt).toISOString().slice(0, 10);
    lines.push(`- ${item.text}${where ? ` _(during ${where})_` : ''} — noted ${stamp}`);
  }
  lines.push('');
  return lines.join('\n');
}
