import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRestTimer } from './restTimer';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRestTimer', () => {
  it('starts at the given duration, not running', () => {
    const { result } = renderHook(() => useRestTimer(90));
    expect(result.current.remaining).toBe(90);
    expect(result.current.running).toBe(false);
  });

  it('counts down based on elapsed time once started', () => {
    const { result } = renderHook(() => useRestTimer(90));
    act(() => result.current.start());

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current.running).toBe(true);
    expect(result.current.remaining).toBe(60);
  });

  it('is not fooled by a single large jump (no per-tick drift accumulation)', () => {
    const { result } = renderHook(() => useRestTimer(90));
    act(() => result.current.start());

    act(() => {
      vi.advanceTimersByTime(45_300);
    });

    expect(result.current.remaining).toBe(45);
  });

  it('clamps at 0 and stops automatically', () => {
    const { result } = renderHook(() => useRestTimer(10));
    act(() => result.current.start());

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(result.current.remaining).toBe(0);
    expect(result.current.running).toBe(false);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.remaining).toBe(0);
  });

  it('stop pauses without resetting the remaining time', () => {
    const { result } = renderHook(() => useRestTimer(90));
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    act(() => result.current.stop());
    expect(result.current.running).toBe(false);
    const paused = result.current.remaining;

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(result.current.remaining).toBe(paused);
  });

  it('reset returns to the initial duration and stays stopped', () => {
    const { result } = renderHook(() => useRestTimer(90));
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    act(() => result.current.reset());
    expect(result.current.remaining).toBe(90);
    expect(result.current.running).toBe(false);
  });

  it('starting again restarts a fresh countdown from the full duration', () => {
    const { result } = renderHook(() => useRestTimer(10));
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current.remaining).toBe(0);

    act(() => result.current.start());
    expect(result.current.remaining).toBe(10);
    expect(result.current.running).toBe(true);
  });
});
