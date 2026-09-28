// Rest-timer countdown primitive. Elapsed-time based (Date.now() diffing)
// rather than a naive per-tick decrement, so background/inactive tabs don't
// drift. No UI, sound, or vibration here — those are Session-screen concerns.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RestTimer {
  remaining: number;
  running: boolean;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const TICK_MS = 100;

export function useRestTimer(seconds: number): RestTimer {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(false);
  const endAtRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearTick();
    endAtRef.current = null;
    setRunning(false);
  }, [clearTick]);

  const tick = useCallback(() => {
    const endAt = endAtRef.current;
    if (endAt === null) return;
    const msLeft = endAt - Date.now();
    if (msLeft <= 0) {
      setRemaining(0);
      stop();
      return;
    }
    setRemaining(Math.ceil(msLeft / 1000));
  }, [stop]);

  const start = useCallback(() => {
    clearTick();
    endAtRef.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
    setRunning(true);
    intervalRef.current = setInterval(tick, TICK_MS);
  }, [clearTick, seconds, tick]);

  const reset = useCallback(() => {
    clearTick();
    endAtRef.current = null;
    setRunning(false);
    setRemaining(seconds);
  }, [clearTick, seconds]);

  useEffect(() => clearTick, [clearTick]);

  return { remaining, running, start, stop, reset };
}
