import { describe, expect, it } from 'vitest';
import { daysAgo, dueGroup, groupOf } from './templateGroups';
import type { Template } from '../data/types';

const t = (id: string, name: string, kind: Template['kind'] = 'gym', group?: Template['group']) =>
  ({ id, name, kind, ...(group ? { group } : {}), sections: [] }) as unknown as Template;

describe('groupOf', () => {
  it('infers from kind and name, and a stored group wins', () => {
    expect(groupOf(t('1', 'Upper Body - Push /Pull'))).toBe('upper');
    expect(groupOf(t('2', 'Lower Body 1 Home'))).toBe('lower');
    expect(groupOf(t('3', 'Micro Upper Body Rehab', 'micro'))).toBe('rest');
    expect(groupOf(t('4', 'Full body'))).toBe('rest');
    expect(groupOf(t('5', 'Full body', 'gym', 'upper'))).toBe('upper');
  });
});

describe('dueGroup', () => {
  const all = [t('u', 'Upper A'), t('l', 'Lower A'), t('m', 'Micro', 'micro')];
  it('opens on whichever of upper/lower was trained longer ago', () => {
    expect(dueGroup(all, new Map([['u', '2026-09-22'], ['l', '2026-09-14']]))).toBe('lower');
    expect(dueGroup(all, new Map([['u', '2026-09-10'], ['l', '2026-09-14'], ['m', '2026-01-01']]))).toBe('upper');
  });
  it('treats never-trained as due', () => {
    expect(dueGroup(all, new Map([['u', '2026-09-22']]))).toBe('lower');
  });
});

describe('daysAgo', () => {
  it('reads naturally', () => {
    expect(daysAgo('2026-09-24', '2026-09-24')).toBe('today');
    expect(daysAgo('2026-09-23', '2026-09-24')).toBe('yesterday');
    expect(daysAgo('2026-09-14', '2026-09-24')).toBe('10 days ago');
    expect(daysAgo(undefined, '2026-09-24')).toBe('never');
  });
});
