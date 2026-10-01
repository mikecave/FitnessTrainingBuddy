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
/** Why the last lock attempt failed, in the browser's own words — shown to
 *  the user, since "it didn't work" can't be debugged from here. */
let lastError = '';
/** Whether we put the page into fullscreen to get the lock, so unlocking
 *  only exits a fullscreen we started. */
let enteredFullscreen = false;

export function getLockError(): string {
  return lastError;
}
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
function tryLock(orientation: OrientationWithLock): Promise<void> {
  // Some browsers neither grant nor refuse — the promise just never settles —
  // so give up after a moment and treat that as a refusal.
  return Promise.race([
    orientation.lock!('portrait'),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('no answer from the browser')), LOCK_TIMEOUT_MS),
    ),
  ]);
}

/** Apply the stored preference. Called at start-up and on every return to the
 *  foreground, because Android can drop a lock while the app is backgrounded.
 *
 *  `fromTap`: the call comes from a button press, so fullscreen may be
 *  requested. Chrome on Android refuses lock() outside fullscreen even in the
 *  installed app on some setups (2026-10-01: the user hit exactly that), so a
 *  refused lock falls back to fullscreen + lock. Fullscreen needs a user
 *  gesture, which is why the automatic re-apply can't do it. */
export async function applyRotationLock({ fromTap = false } = {}): Promise<LockStatus> {
  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
    | OrientationWithLock
    | undefined;
  if (!isLockPreferred()) {
    orientation?.unlock?.();
    if (enteredFullscreen && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    enteredFullscreen = false;
    setStatus('unlocked');
    return status;
  }
  if (!orientation?.lock) {
    lastError = 'this browser has no rotation lock';
    setStatus('unsupported');
    return status;
  }
  try {
    await tryLock(orientation);
    lastError = '';
    setStatus('locked');
    return status;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }
  if (fromTap && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      enteredFullscreen = true;
      await tryLock(orientation);
      lastError = '';
      setStatus('locked');
      return status;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  setStatus('unsupported');
  return status;
}

export function setRotationLock(locked: boolean): Promise<LockStatus> {
  savePreference(locked);
  return applyRotationLock({ fromTap: true });
}
