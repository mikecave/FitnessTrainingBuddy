import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRotationLock, isLockPreferred, setRotationLock } from './rotationLock';

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
