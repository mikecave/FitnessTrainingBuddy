import { describe, expect, it } from 'vitest';
import { isByFeel } from './logging';

const loose = { logging: 'loose' as const };
const tracked = { logging: 'tracked' as const };

describe('isByFeel', () => {
  it('inherits the section when the exercise says nothing (existing data)', () => {
    expect(isByFeel(loose, {})).toBe(true);
    expect(isByFeel(tracked, {})).toBe(false);
  });

  it('lets a warm-up exercise carry real numbers', () => {
    expect(isByFeel(loose, { byFeel: false })).toBe(false);
  });

  it('lets a tracked exercise be logged by feel', () => {
    expect(isByFeel(tracked, { byFeel: true })).toBe(true);
  });
});
