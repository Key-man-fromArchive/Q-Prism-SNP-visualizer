import { expect, it } from 'vitest';
import { clientPoint, textCustomdata } from './plot-coordinates';

const axis = { _length: 100, range: [0, 10] as [number, number] };
it('maps a point with optional offsets and inverted y coordinates', () => {
  expect(clientPoint(axis, axis, { left: 10, top: 20 }, 60, 45)).toEqual({ x: 5, y: 7.5 });
  expect(clientPoint({ ...axis, _offset: 5 }, axis, { left: 10, top: 20 }, 65, 45)).toEqual({ x: 5, y: 7.5 });
});
it('rejects missing ranges, zero-size axes, and out-of-plot coordinates', () => {
  expect(clientPoint(undefined, axis, { left: 0, top: 0 }, 50, 50)).toBeNull();
  expect(clientPoint({ _length: 100 }, axis, { left: 0, top: 0 }, 50, 50)).toBeNull();
  expect(clientPoint(axis, { ...axis, _length: 0 }, { left: 0, top: 0 }, 50, 50)).toBeNull();
  expect(clientPoint(axis, axis, { left: 0, top: 0 }, -1, 50)).toBeNull();
  expect(clientPoint(axis, axis, { left: 0, top: 0 }, 50, 101)).toBeNull();
});
it('accepts only string selection identifiers', () => {
  expect(textCustomdata('A1')).toBe('A1');
  expect(textCustomdata(1)).toBeUndefined();
});
