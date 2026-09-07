import { expect, it } from 'vitest';
import { visibleQualityPoint, focusedQualityWell } from './quality-display';
it('reveals only the exact existing Omit point and never changes role or selected-only preferences', () => {
  const point = { well: 'A1', manual_type: 'Omit' };
  const selected = new Set(['B1']);
  expect(visibleQualityPoint(point, 'A1', false, true, selected)).toBe(true);
  expect(visibleQualityPoint(point, null, false, true, selected)).toBe(false);
  expect(visibleQualityPoint({ well: 'A2', manual_type: null }, 'A1', false, true, selected)).toBe(false);
  expect(point.manual_type).toBe('Omit');
  expect([...selected]).toEqual(['B1']);
  expect(focusedQualityWell('A1', 'A1', selected)).toBe(true);
  expect(focusedQualityWell('A2', 'A1', selected)).toBe(false);
});
