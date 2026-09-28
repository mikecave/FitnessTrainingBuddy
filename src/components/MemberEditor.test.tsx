import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MemberEditor, { type MemberEditorResult } from './MemberEditor';
import type { Exercise, GroupMember } from '../data/types';

const exercise: Exercise = {
  id: 'ex-1',
  userId: 'mike',
  name: 'Front squat',
  category: 'strength',
  unilateral: false,
  defaultIntensity: 7,
  updatedAt: 0,
};

const member: GroupMember = {
  exerciseId: 'ex-1',
  restAfterSec: 90,
  sets: [{ target: { type: 'reps', reps: 8 }, load: { type: 'kg', kg: 60 } }],
};

function renderEditor(onAutoSave: (r: MemberEditorResult) => void) {
  return render(
    <MemberEditor
      exercise={exercise}
      member={member}
      sectionByFeel={false}
      showIntensity
      onCancel={() => {}}
      onSave={() => {}}
      onAutoSave={onAutoSave}
      autoSaveIntervalMs={60_000}
    />,
  );
}

describe('MemberEditor auto-save', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('saves a dirty draft after the interval elapses, then stays quiet while clean', () => {
    const onAutoSave = vi.fn();
    renderEditor(onAutoSave);

    fireEvent.change(screen.getByDisplayValue('Front squat'), {
      target: { value: 'Front squat (heels raised)' },
    });

    vi.advanceTimersByTime(60_000);
    expect(onAutoSave).toHaveBeenCalledTimes(1);
    expect(onAutoSave.mock.calls[0][0].name).toBe('Front squat (heels raised)');

    // nothing changed since — the next ticks must not re-save
    vi.advanceTimersByTime(180_000);
    expect(onAutoSave).toHaveBeenCalledTimes(1);
  });

  it('does not save when nothing changed', () => {
    const onAutoSave = vi.fn();
    renderEditor(onAutoSave);

    vi.advanceTimersByTime(300_000);
    expect(onAutoSave).not.toHaveBeenCalled();
  });

  it('does not save an invalid draft (blank name)', () => {
    const onAutoSave = vi.fn();
    renderEditor(onAutoSave);

    fireEvent.change(screen.getByDisplayValue('Front squat'), { target: { value: '   ' } });
    vi.advanceTimersByTime(60_000);
    expect(onAutoSave).not.toHaveBeenCalled();
  });

  it('flushes a dirty draft immediately when the app is backgrounded', () => {
    const onAutoSave = vi.fn();
    renderEditor(onAutoSave);

    fireEvent.change(screen.getByDisplayValue('Front squat'), {
      target: { value: 'Front squat paused' },
    });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onAutoSave).toHaveBeenCalledTimes(1);
    expect(onAutoSave.mock.calls[0][0].name).toBe('Front squat paused');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});
