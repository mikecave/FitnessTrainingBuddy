import { describe, expect, it } from 'vitest';
import { shouldReloadForUpdate } from './appUpdate';

const base = { hadController: true, alreadyReloaded: false, inSession: false };

describe('shouldReloadForUpdate', () => {
  it('reloads when a new worker takes over an already-controlled page', () => {
    expect(shouldReloadForUpdate(base)).toBe(true);
  });

  it('does NOT reload on a first install — that would reload every first visit', () => {
    expect(shouldReloadForUpdate({ ...base, hadController: false })).toBe(false);
  });

  it('reloads at most once, so a misbehaving worker cannot loop', () => {
    expect(shouldReloadForUpdate({ ...base, alreadyReloaded: true })).toBe(false);
  });

  it('never reloads mid-workout — unconfirmed set inputs would be lost', () => {
    expect(shouldReloadForUpdate({ ...base, inSession: true })).toBe(false);
  });

  it('stays false when several reasons apply at once', () => {
    expect(
      shouldReloadForUpdate({ hadController: false, alreadyReloaded: true, inSession: true }),
    ).toBe(false);
  });
});
