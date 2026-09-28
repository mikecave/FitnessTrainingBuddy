// Rotation lock (F8). The user rests the phone on its side mid-set and the app
// rotates; the layout only really works in portrait.
//
// The Screen Orientation API can pin the app to portrait, but Chrome on Android
// only honours lock() in fullscreen or in an INSTALLED web app (opened from the
// home-screen icon) — in a normal tab it rejects. So the preference is stored,
// and whether the lock actually took is reported separately, so the button can
// say so rather than silently doing nothing.
//
// The manifest deliberately sets no `orientation`: unlock() returns to the
// manifest default, so a portrait default would make "unlocked" do nothing.

const KEY = 'fitbuddy.rotationLocked';
const LOCK_TIMEOUT_MS = 1500;

export type LockStatus = 'locked' | 'unlocked' | 'unsupported';

type OrientationWithLock = ScreenOrientation & {
  lock?: (orientation: 'portrait') => Promise<void>;
};

/** Locked unless the user has turned it off: rotating mid-set is the problem. */
export function isLockPreferred(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

function savePreference(locked: boolean): void {
  try {
    localStorage.setItem(KEY, String(locked));
  } catch {
    // Private mode etc.: the lock still applies for this visit.
  }
}

let status: LockStatus = 'unlocked';
const listeners = new Set<(s: LockStatus) => void>();

export function getLockStatus(): LockStatus {
  return status;
}

export function onLockStatus(fn: (s: LockStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(next: LockStatus): void {
  status = next;
  for (const fn of listeners) fn(next);
}

/** Apply the stored preference. Called at start-up and on every return to the
 *  foreground, because Android can drop a lock while the app is backgrounded. */
export async function applyRotationLock(): Promise<LockStatus> {
  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
    | OrientationWithLock
    | undefined;
  if (!isLockPreferred()) {
    orientation?.unlock?.();
    setStatus('unlocked');
    return status;
  }
  if (!orientation?.lock) {
    setStatus('unsupported');
    return status;
  }
  try {
    // Some browsers neither grant nor refuse — the promise just never
    // settles — so give up after a moment and call that unsupported.
    await Promise.race([
      orientation.lock('portrait'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), LOCK_TIMEOUT_MS)),
    ]);
    setStatus('locked');
  } catch {
    setStatus('unsupported');
  }
  return status;
}

export function setRotationLock(locked: boolean): Promise<LockStatus> {
  savePreference(locked);
  return applyRotationLock();
}
