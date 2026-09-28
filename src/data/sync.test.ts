import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSyncConfigured, maybeSync, setSyncToken, syncChangedData } from './sync';
import type { SyncResult } from './sync';

const NONE = { added: 0, updated: 0, skipped: 0 };

function result(over: Partial<SyncResult> = {}): SyncResult {
  return {
    pushed: 0,
    at: Date.now(),
    summary: {
      mode: 'merge',
      exercises: NONE,
      templates: NONE,
      sessions: NONE,
      feedback: NONE,
    },
    ...over,
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('sync configuration', () => {
  it('reports unconfigured until a key is stored', () => {
    expect(isSyncConfigured()).toBe(false);
    setSyncToken('abc123');
    expect(isSyncConfigured()).toBe(true);
  });

  it('treats a blank key as unconfigured, so whitespace does not look like setup', () => {
    setSyncToken('   ');
    expect(isSyncConfigured()).toBe(false);
  });
});

describe('maybeSync guards', () => {
  it('does nothing without a key, and never calls the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await maybeSync()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips a sync that just happened, so foregrounding does not spam the server', async () => {
    setSyncToken('abc123');
    localStorage.setItem('fitbuddy.lastSyncAt', String(Date.now()));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await maybeSync()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never throws when the network is unavailable — offline must be silent', async () => {
    setSyncToken('abc123');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(maybeSync()).resolves.toBeNull();
  });
});

describe('syncChangedData', () => {
  it('is false for a skipped sync or a no-op sync', () => {
    expect(syncChangedData(null)).toBe(false);
    expect(syncChangedData(result())).toBe(false);
  });

  it('is true when anything moved in either direction', () => {
    expect(syncChangedData(result({ pushed: 3 }))).toBe(true);
    expect(
      syncChangedData(
        result({
          summary: {
            mode: 'merge',
            exercises: NONE,
            templates: { added: 1, updated: 0, skipped: 0 },
            sessions: NONE,
            feedback: NONE,
          },
        }),
      ),
    ).toBe(true);
  });
});
