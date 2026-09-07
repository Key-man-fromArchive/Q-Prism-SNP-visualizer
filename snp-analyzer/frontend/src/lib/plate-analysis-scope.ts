type MarkerMembership = { wells: readonly string[] };

/** Input inventory only: measurements, plot filters and selection are not this denominator. */
export function plateAnalysisScope(wellIds: readonly string[] | undefined, markers: readonly MarkerMembership[], types: Readonly<Record<string, string>>) {
  if (!Array.isArray(wellIds) || !wellIds.every(well => typeof well === 'string')) return null;
  const wells = [...new Set(wellIds)];
  const scoped = markers.some(marker => marker.wells.length > 0);
  const assigned = new Set(markers.flatMap(marker => marker.wells));
  const unassigned = scoped ? wells.filter(well => !assigned.has(well)).length : 0;
  const empty = wells.filter(well => types[well] === 'Empty').length;
  const omit = wells.filter(well => types[well] === 'Omit').length;
  const eligible = wells.filter(well => (!scoped || assigned.has(well)) && types[well] !== 'Empty' && types[well] !== 'Omit').length;
  return { mode: scoped ? 'markers' : 'whole', total: wells.length, unassigned, empty, omit, eligible };
}
