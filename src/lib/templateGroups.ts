// Home-screen tabs: Upper / Lower / The rest (2026-09-24).
//
// A template's group is stored when the user sets one (Edit → Group), and
// otherwise inferred, so existing workouts sort themselves with no setup:
// micro workouts go to "The rest" even when they're upper-body rehab, since
// they're the short home sessions and not an alternative to a gym day.

import type { Session, Template, TemplateGroup } from '../data/types';

export const GROUPS: { value: TemplateGroup; label: string }[] = [
  { value: 'upper', label: 'Upper' },
  { value: 'lower', label: 'Lower' },
  { value: 'rest', label: 'The rest' },
];

export function groupOf(t: Pick<Template, 'group' | 'kind' | 'name'>): TemplateGroup {
  if (t.group) return t.group;
  if (t.kind === 'micro') return 'rest';
  if (/lower/i.test(t.name)) return 'lower';
  if (/upper/i.test(t.name)) return 'upper';
  return 'rest';
}

/** Most recent finished workout date per template. */
export function lastDoneByTemplate(sessions: Session[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const s of sessions) {
    if (s.status !== 'done') continue;
    const prev = last.get(s.templateId);
    if (!prev || s.date > prev) last.set(s.templateId, s.date);
  }
  return last;
}

/** The tab to open on: whichever of Upper and Lower was trained least
 *  recently, since the user alternates them. "The rest" is never "due" — it's
 *  rehab and short sessions, done whenever. Never trained counts as oldest. */
export function dueGroup(templates: Template[], lastDone: Map<string, string>): TemplateGroup {
  const latest = (g: TemplateGroup) =>
    templates
      .filter((t) => groupOf(t) === g)
      .map((t) => lastDone.get(t.id) ?? '')
      .reduce((a, b) => (b > a ? b : a), '');
  const hasUpper = templates.some((t) => groupOf(t) === 'upper');
  const hasLower = templates.some((t) => groupOf(t) === 'lower');
  if (!hasUpper && !hasLower) return 'rest';
  if (!hasLower) return 'upper';
  if (!hasUpper) return 'lower';
  return latest('lower') < latest('upper') ? 'lower' : 'upper';
}

/** "today", "yesterday", "3 days ago", "never". */
export function daysAgo(date: string | undefined, today: string): string {
  if (!date) return 'never';
  const ms = Date.parse(`${today}T00:00:00`) - Date.parse(`${date}T00:00:00`);
  const days = Math.round(ms / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
