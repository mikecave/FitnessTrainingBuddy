import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRotationLock, getLockError, isLockPreferred, setRotationLock } from './rotationLock';

function mockOrientation(lock?: () => Promise<void>) {
  const unlock = vi.fn();
  Object.defineProperty(screen, 'orientation', {
    configurable: true,
    value: { lock, unlock },
  });
  return unlock;
}

afterEach(() => localStorage.clear());

describe('rotation lock', () => {
  it('is locked by default', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    mockOrientation(lock);
    expect(isLockPreferred()).toBe(true);
    expect(await applyRotationLock()).toBe('locked');
    expect(lock).toHaveBeenCalledWith('portrait');
  });

  it('reports unsupported when the browser refuses (a tab, not the installed app)', async () => {
    mockOrientation(() => Promise.reject(new Error('NotSupportedError')));
    expect(await applyRotationLock()).toBe('unsupported');
  });

  it('turning it off unlocks and is remembered', async () => {
    const unlock = mockOrientation(vi.fn().mockResolvedValue(undefined));
    expect(await setRotationLock(false)).toBe('unlocked');
    expect(unlock).toHaveBeenCalled();
    expect(isLockPreferred()).toBe(false);
  });
});

describe('rotation lock that never answers', () => {
  it('times out to unsupported', async () => {
    vi.useFakeTimers();
    mockOrientation(() => new Promise(() => {}));
    const result = applyRotationLock();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe('unsupported');
    vi.useRealTimers();
  });
});

describe('fullscreen fallback', () => {
  it('on a tap, a refused lock retries in fullscreen', async () => {
    const lock = vi
      .fn()
      .mockRejectedValueOnce(new Error('The page needs to be fullscreen in order to call lock()'))
      .mockResolvedValueOnce(undefined);
    mockOrientation(lock);
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen });

    expect(await setRotationLock(true)).toBe('locked');
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it('the automatic re-apply never forces fullscreen, and reports the reason', async () => {
    mockOrientation(() => Promise.reject(new Error('The page needs to be fullscreen')));
    const requestFullscreen = vi.fn();
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen });

    expect(await applyRotationLock()).toBe('unsupported');
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(getLockError()).toMatch(/fullscreen/);
  });
});
