import { describe, expect, it } from 'vitest';
import { clampRating } from './Stepper';

describe('clampRating', () => {
  it('rounds to the nearest step', () => {
    expect(clampRating(7.3)).toBe(7.5);
    expect(clampRating(7.2)).toBe(7);
  });

  it('clamps to min/max', () => {
    expect(clampRating(0.5)).toBe(1);
    expect(clampRating(11)).toBe(10);
  });
});
