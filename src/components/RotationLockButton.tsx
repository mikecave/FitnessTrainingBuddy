import { useEffect, useState } from 'react';
import {
  getLockStatus,
  isLockPreferred,
  onLockStatus,
  setRotationLock,
  type LockStatus,
} from '../lib/rotationLock';

/** 🔒 / 🔓 toggle for the rotation lock. Shown on Home and in the workout
 *  header. If the browser refuses the lock (a Chrome tab rather than the
 *  installed app), it says so instead of pretending to be locked. */
export function RotationLockButton() {
  const [status, setStatus] = useState<LockStatus>(getLockStatus);
  const [hint, setHint] = useState(false);

  useEffect(() => onLockStatus(setStatus), []);

  const locked = status === 'locked';
  const wantsLock = isLockPreferred();

  return (
    <span className="relative">
      <button
        onClick={async () => {
          // When the lock is refused, a tap retries it and explains, rather
          // than quietly flipping the preference off.
          const next = await setRotationLock(status === 'unsupported' ? true : !wantsLock);
          setHint(next === 'unsupported');
          if (next === 'unsupported') setTimeout(() => setHint(false), 4000);
        }}
        aria-label={locked ? 'Rotation locked — tap to allow rotation' : 'Rotation unlocked — tap to lock to portrait'}
        aria-pressed={locked}
        className={`rounded-lg px-3 py-1.5 text-sm font-semibold active:bg-slate-700 ${
          locked ? 'bg-slate-800 text-slate-300' : 'bg-amber-500/20 text-amber-300'
        }`}
      >
        {locked ? '🔒' : '🔓'}
      </button>
      {hint && (
        <span className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg bg-slate-800 p-2 text-xs text-slate-300 shadow-lg">
          Rotation lock only works in the installed app — open FitBuddy from its home-screen icon.
        </span>
      )}
    </span>
  );
}
