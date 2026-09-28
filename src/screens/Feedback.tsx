import { useEffect, useState } from 'react';
import {
  deleteResolvedFeedback,
  getSession,
  listFeedback,
  listTemplates,
  setFeedbackResolved,
} from '../data/repo';
import { feedbackToMarkdown } from '../lib/markdown';
import type { Feedback as FeedbackItem } from '../data/types';

/** App-feedback inbox.
 *
 *  The point of this screen is the Copy button: feedback is captured on the
 *  phone mid-workout, and the fastest route back into a Claude prompt is the
 *  clipboard. No file to move, no export/import round trip, works offline. */
export default function Feedback({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [showResolved, setShowResolved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reload(includeResolved = showResolved) {
    const list = await listFeedback(includeResolved);
    setItems(list);

    // Label each item with the workout it was raised during.
    const templates = await listTemplates();
    const names = new Map(templates.map((t) => [t.id, t.name]));
    const map = new Map<string, string>();
    for (const id of new Set(list.map((f) => f.sessionId).filter(Boolean) as string[])) {
      const session = await getSession(id);
      if (session) map.set(id, `${names.get(session.templateId) ?? 'workout'} ${session.date}`);
    }
    setLabels(map);
  }

  useEffect(() => {
    void reload(showResolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved]);

  const open = items?.filter((f) => !f.resolved) ?? [];
  const markdown = feedbackToMarkdown(open, labels);

  async function copyAll() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fitbuddy-feedback.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (items === null) return null;

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-sky-400">
        ← Home
      </button>

      <h1 className="mb-1 text-2xl font-bold">App feedback</h1>
      <p className="mb-6 text-sm text-slate-400">
        {open.length === 0
          ? 'Nothing outstanding. Notes you add during a workout show up here.'
          : `${open.length} open item${open.length === 1 ? '' : 's'}. Copy them into Claude to get them fixed, then mark them done.`}
      </p>

      {open.length > 0 && (
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => void copyAll()}
            className="flex-1 rounded-xl bg-sky-600 py-3 text-sm font-bold active:bg-sky-500"
          >
            {copied ? 'Copied ✓' : 'Copy all as markdown'}
          </button>
          <button
            onClick={download}
            className="shrink-0 rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-300 active:bg-slate-700"
          >
            .md
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {items.map((f) => (
          <div
            key={f.id}
            className={`rounded-xl p-4 ${f.resolved ? 'bg-slate-900/60' : 'bg-slate-800'}`}
          >
            <div className={`text-sm ${f.resolved ? 'text-slate-500 line-through' : ''}`}>
              {f.text}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
              <span>
                {new Date(f.createdAt).toLocaleDateString()}
                {f.sessionId && labels.get(f.sessionId) ? ` · ${labels.get(f.sessionId)}` : ''}
              </span>
              <button
                onClick={async () => {
                  await setFeedbackResolved(f.id, !f.resolved);
                  void reload();
                }}
                className="shrink-0 whitespace-nowrap text-sky-400"
              >
                {f.resolved ? 'reopen' : 'mark fixed'}
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-slate-500">No feedback recorded.</p>}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 text-xs">
        <button onClick={() => setShowResolved((v) => !v)} className="text-slate-400 underline">
          {showResolved ? 'Hide fixed items' : 'Show fixed items'}
        </button>
        {showResolved && items.some((f) => f.resolved) && (
          <button
            onClick={async () => {
              await deleteResolvedFeedback();
              void reload();
            }}
            className="text-rose-300"
          >
            Delete fixed items
          </button>
        )}
      </div>
    </div>
  );
}
