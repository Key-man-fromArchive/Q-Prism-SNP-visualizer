import { WellType } from '@/types/api';

/** Validate popup/input values without weakening the API's finite type set. */
export function parseWellType(value: unknown): WellType | undefined {
  return Object.values(WellType).find((known) => known === value);
}
