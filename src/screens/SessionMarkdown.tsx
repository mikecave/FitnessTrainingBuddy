import { useEffect, useState } from 'react';
import { exerciseMap, getSession, getTemplate, setSessionDate } from '../data/repo';
import { markdownFilename, sessionToMarkdown } from '../lib/markdown';

/** The markdown mirror for one logged session: view, copy, download. */
export default function SessionMarkdown({
  sessionId,
  onBack,
  backLabel = 'History',
}: {
  sessionId: string;
  onBack: () => void;
  backLabel?: string;
}) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [filename, setFilename] = useState('session.md');
  const [copied, setCopied] = useState(false);
  const [date, setDate] = useState('');

  async function load() {
    const session = await getSession(sessionId);
    if (!session) {
      setMarkdown('Session not found.');
      return;
    }
    const [template, exercises] = await Promise.all([
      getTemplate(session.templateId),
      exerciseMap(),
    ]);
    const name = template?.name ?? 'Workout';
    setMarkdown(sessionToMarkdown(session, name, exercises));
    setFilename(markdownFilename(session, name));
    setDate(session.date);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /** Correct the date of a workout logged late, or logged on the wrong day. */
  async function changeDate(next: string) {
    if (!next || next === date) return;
    setDate(next);
    await setSessionDate(sessionId, next);
    await load();
  }

  if (markdown === null) return null;

  function download() {
    const blob = new Blob([markdown!], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    await navigator.clipboard.writeText(markdown!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-sky-400">
        ← {backLabel}
      </button>
      {date && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => void changeDate(e.target.value)}
            aria-label="Workout date"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm"
          />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-sm text-slate-400">{filename}</span>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={copy}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-300 active:bg-slate-700"
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button
            onClick={download}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold active:bg-sky-500"
          >
            Download
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-slate-200">
        {markdown}
      </pre>
    </div>
  );
}
