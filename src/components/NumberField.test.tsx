import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NumberField } from './NumberField';

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof NumberField>[0]> = {}) {
  const onChange = vi.fn();
  const label = props.label ?? 'Reps';
  render(<NumberField value="10" onChange={onChange} {...props} label={label} />);
  return { onChange, label, input: screen.getByLabelText(label) as HTMLInputElement };
}

describe('NumberField', () => {
  it('steps up and down by the step size', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByLabelText('Reps up'));
    expect(onChange).toHaveBeenCalledWith('11');
    fireEvent.click(screen.getByLabelText('Reps down'));
    expect(onChange).toHaveBeenCalledWith('9');
  });

  it('honours a custom step and avoids float drift on 2.5kg jumps', () => {
    const { onChange } = setup({ value: '20', label: 'Kilograms', step: 2.5, decimal: true });
    fireEvent.click(screen.getByLabelText('Kilograms up'));
    expect(onChange).toHaveBeenCalledWith('22.5');
  });

  it('clamps at min and max', () => {
    const atMin = setup({ value: '0' });
    fireEvent.click(screen.getByLabelText('Reps down'));
    expect(atMin.onChange).toHaveBeenCalledWith('0');
    cleanup();

    const atMax = setup({ value: '999' });
    fireEvent.click(screen.getByLabelText('Reps up'));
    expect(atMax.onChange).toHaveBeenCalledWith('999');
  });

  // The bug this component exists to prevent: a clipped leading digit meant an
  // edit of a half-visible "10" produced "110" reps without the user seeing it.
  it('refuses a 4th digit, so 10 can never silently become 110', () => {
    const { onChange, input } = setup();
    fireEvent.change(input, { target: { value: '110' } });
    expect(onChange).toHaveBeenCalledWith('110');
    onChange.mockClear();
    fireEvent.change(input, { target: { value: '1100' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never shrinks in a crowded flex row (the clipping cause)', () => {
    const { input } = setup();
    expect(input.className).toContain('shrink-0');
  });

  it('allows the field to be cleared mid-edit', () => {
    const { onChange, input } = setup({ value: '10' });
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('treats an empty field as 0 when stepping', () => {
    const { onChange } = setup({ value: '' });
    fireEvent.click(screen.getByLabelText('Reps up'));
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('accepts one decimal place only when decimal is set', () => {
    const dec = setup({ value: '20', label: 'Kilograms', decimal: true });
    fireEvent.change(dec.input, { target: { value: '22.5' } });
    expect(dec.onChange).toHaveBeenCalledWith('22.5');
    cleanup();

    const int = setup();
    fireEvent.change(int.input, { target: { value: '10.5' } });
    expect(int.onChange).not.toHaveBeenCalled();
  });
});
