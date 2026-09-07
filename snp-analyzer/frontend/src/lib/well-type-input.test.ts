import { expect, it } from 'vitest';
import { parseWellType } from './well-type-input';
import { WellType } from '@/types/api';

it.each(Object.values(WellType))('accepts declared well type %s', (value) => {
  expect(parseWellType(value)).toBe(value);
});
it.each(['', 'ntc', 'Arbitrary', null, 42])('rejects unknown well type %s', (value) => {
  expect(parseWellType(value)).toBeUndefined();
});
