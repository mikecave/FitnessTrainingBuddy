import { useEffect, useMemo, useState } from 'react';
import { listDoneSessions, listTemplates } from '../data/repo';
import type { Session, Template } from '../data/types';
import { dayLabel, mondayOf, monthName, parseLocalDate, weekLabel } from '../lib/weeks';

type Tree = Map<number, Map<number, Map<string, Session[]>>>; // year -> month -> monday -> sessions

function buildTree(sessions: Session[]): Tree {
  const tree: Tree = new Map();
  for (const s of sessions) {
    const d = parseLocalDate(s.date);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const monday = mondayOf(s.date);
    if (!tree.has(year)) tree.set(year, new Map());
    const months = tree.get(year)!;
    if (!months.has(month)) months.set(month, new Map());
    const weeks = months.get(month)!;
    if (!weeks.has(monday)) weeks.set(monday, []);
    weeks.get(monday)!.push(s);
  }
  return tree;
}

const summaryChrome =
  'flex cursor-pointer list-none items-center gap-2 rounded-lg py-2 select-none [&::-webkit-details-marker]:hidden';

function Chevron() {
  return <span className="text-xs text-slate-500 transition-transform [details[open]>summary>&]:rotate-90">▶</span>;
}

export default function History({
  onOpenSession,
  onOpenProgress,
  onBack,
}: {
  onOpenSession: (id: string) => void;
  onOpenProgress: () => void;
  onBack: () => void;
}) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [templates, setTemplates] = useState<Map<string, Template>>(new Map());

  useEffect(() => {
    listDoneSessions().then(setSessions);
    listTemplates().then((all) => setTemplates(new Map(all.map((t) => [t.id, t]))));
  }, []);

  const tree = useMemo(() => (sessions ? buildTree(sessions) : null), [sessions]);
  const newest = sessions?.[0];
  const newestKeys = newest
    ? {
        year: parseLocalDate(newest.date).getFullYear(),
        month: parseLocalDate(newest.date).getMonth() + 1,
        monday: mondayOf(newest.date),
      }
    : null;

  if (!sessions || !tree) return null;

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-sky-400">
        ← Workouts
      </button>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">History</h1>
        {sessions.length > 0 && (
          <button
            onClick={onOpenProgress}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold active:bg-sky-500"
          >
            📈 Progress
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-slate-400">
        {sessions.length === 0
          ? 'No finished workouts yet — history appears here once you finish one.'
          : `${sessions.length} logged workout${sessions.length === 1 ? '' : 's'}. Tap through to the markdown for any session.`}
      </p>

      {[...tree.entries()].map(([year, months]) => (
        <details key={year} open={year === newestKeys?.year} className="mb-1">
          <summary className={`${summaryChrome} text-lg font-bold`}>
            <Chevron /> {year}
          </summary>
          <div className="ml-4 border-l border-slate-800 pl-3">
            {[...months.entries()].map(([month, weeks]) => (
              <details
                key={month}
                open={year === newestKeys?.year && month === newestKeys?.month}
                className="mb-1"
              >
                <summary className={`${summaryChrome} font-semibold`}>
                  <Chevron /> {monthName(month)}
                </summary>
                <div className="ml-4 border-l border-slate-800 pl-3">
                  {[...weeks.entries()].map(([monday, weekSessions]) => (
                    <details key={monday} open={monday === newestKeys?.monday} className="mb-1">
                      <summary className={`${summaryChrome} text-sm text-slate-300`}>
                        <Chevron /> {weekLabel(monday)}
                        <span className="text-xs text-slate-500">({weekSessions.length})</span>
                      </summary>
                      <div className="ml-4 flex flex-col gap-2 border-l border-slate-800 py-1 pl-3">
                        {weekSessions.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => onOpenSession(s.id)}
                            className="rounded-xl bg-slate-900 p-3 text-left active:bg-slate-800"
                          >
                            <div className="text-sm font-semibold">
                              {dayLabel(s.date)} — {templates.get(s.templateId)?.name ?? 'Workout'}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              effort {s.overallEffort ?? '—'}/10 · fatigue {s.endingFatigue ?? '—'}
                              /10 · .md ↗
                            </div>
                          </button>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
