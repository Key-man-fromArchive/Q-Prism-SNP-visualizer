import { isRecord } from './recovery-payload';

function strings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => typeof value[key] === 'string');
}
function numbers(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
}
export function validUser(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return strings(value, ['id', 'username', 'role', 'created_at']) && typeof value.is_active === 'boolean'
    && (value.display_name === null || typeof value.display_name === 'string');
}
function validDashboardSession(value: unknown): boolean {
  return isRecord(value) && strings(value, ['session_id', 'instrument', 'raw_filename', 'created_at'])
    && numbers(value, ['num_wells', 'num_cycles']);
}
function validDashboardProject(value: unknown): boolean {
  return isRecord(value) && strings(value, ['id', 'name', 'created_at']) && numbers(value, ['session_count']);
}
export function validDashboardUser(value: unknown): boolean {
  if (!isRecord(value) || !validUser(value)) return false;
  return numbers(value, ['session_count', 'project_count', 'total_data_points'])
    && Array.isArray(value.sessions) && value.sessions.every(validDashboardSession)
    && Array.isArray(value.projects) && value.projects.every(validDashboardProject);
}
function nullableStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => value[key] === null || typeof value[key] === 'string');
}
function nullableNumbers(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => value[key] === null || (typeof value[key] === 'number' && Number.isFinite(value[key])));
}
function validStringMap(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).every(([key, entry]) => key.length > 0 && typeof entry === 'string');
}
function validThresholdConfig(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const required = ['ntc_threshold', 'allele1_ratio_max', 'allele2_ratio_min'];
  const optionalNumbers = ['ntc_fam_max', 'ntc_allele2_max', 'offset', 'dosage_max'];
  return numbers(value, required)
    && optionalNumbers.every(key => value[key] === undefined || value[key] === null || (typeof value[key] === 'number' && Number.isFinite(value[key])))
    && (value.boundaries === undefined || value.boundaries === null || (Array.isArray(value.boundaries) && value.boundaries.every(item => typeof item === 'number' && Number.isFinite(item))));
}
function validMarkerIdentity(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' && value.id.length > 0
    && typeof value.name === 'string' && value.name.length > 0;
}
function validMarkerWells(value: Record<string, unknown>): boolean {
  return Array.isArray(value.wells) && value.wells.every(well => typeof well === 'string' && well.length > 0);
}
function validMarkerPloidy(value: Record<string, unknown>): boolean {
  return typeof value.ploidy === 'number' && Number.isInteger(value.ploidy) && value.ploidy >= 1;
}
function validOptionalMarkerSettings(value: Record<string, unknown>): boolean {
  return (value.threshold_config === undefined || value.threshold_config === null || validThresholdConfig(value.threshold_config))
    && (value.color === undefined || value.color === null || typeof value.color === 'string')
    && (value.catalog_id === undefined || value.catalog_id === null || (typeof value.catalog_id === 'string' && value.catalog_id.length > 0));
}
function validMarkerOptions(value: Record<string, unknown>): boolean {
  return validMarkerPloidy(value) && validOptionalMarkerSettings(value);
}
function validLayoutMarker(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return validMarkerIdentity(value) && validMarkerWells(value) && validMarkerOptions(value);
}
function validLayoutPlate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { rows, cols } = value;
  return numbers(value, ['rows', 'cols']) && typeof rows === 'number' && typeof cols === 'number'
    && Number.isInteger(rows) && Number.isInteger(cols) && rows >= 0 && cols >= 0;
}
function validLayoutSnapshot(value: unknown): boolean {
  if (!isRecord(value) || value.schema_version !== 1 || !validLayoutPlate(value.plate)) return false;
  return Array.isArray(value.markers) && value.markers.every(validLayoutMarker)
    && (value.well_types === undefined || validStringMap(value.well_types))
    && (value.sample_ids === undefined || validStringMap(value.sample_ids));
}
export function validSavedLayout(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['id', 'owner_user_id', 'name'].every(key => typeof value[key] === 'string' && value[key].length > 0)
    && strings(value, ['created_at', 'updated_at'])
    && validLayoutSnapshot(value.snapshot);
}
export function validLayoutList(value: unknown): boolean {
  return validManagementList(value, 'layouts', validSavedLayout);
}
function validCalibration(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.defined_ratio_points)) return false;
  return strings(value, ['notes']) && nullableStrings(value, ['verified_at'])
    && ['controls_present', 'amplification_verified'].every(key => typeof value[key] === 'boolean')
    && value.defined_ratio_points.every(point => isRecord(point) && numbers(point, ['ratio', 'expected_dosage']));
}
function validValidation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['none', 'provisional', 'validated'].includes(String(value.status)) && strings(value, ['notes'])
    && nullableStrings(value, ['ground_truth_method']) && numbers(value, ['n_compared']) && nullableNumbers(value, ['concordance']);
}
export function validCatalogEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return strings(value, ['id', 'owner_user_id', 'name', 'interpretation_notes']) && numbers(value, ['default_ploidy'])
    && nullableStrings(value, ['target_gene', 'snp_id', 'allele1_base', 'allele2_base', 'chemistry', 'color', 'asg_target_id', 'created_at', 'updated_at'])
    && nullableNumbers(value, ['expected_dosage_classes']) && ['putative', 'validated'].includes(String(value.dosage_trust))
    && validCalibration(value.calibration) && validValidation(value.validation);
}
export function validManagementList(value: unknown, field: string, validate: (item: unknown) => boolean): boolean {
  return isRecord(value) && Array.isArray(value[field]) && value[field].every(validate);
}
export function validProjectListItem(value: unknown): boolean {
  return isRecord(value) && strings(value, ['id', 'name', 'created_at']) && numbers(value, ['session_count']);
}
function validProjectSession(value: unknown): boolean {
  return isRecord(value) && strings(value, ['session_id', 'instrument', 'raw_filename']) && numbers(value, ['num_wells', 'num_cycles']);
}
export function validProject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return strings(value, ['id', 'name', 'created_at']) && Array.isArray(value.session_ids) && value.session_ids.every(id => typeof id === 'string')
    && Array.isArray(value.sessions) && value.sessions.every(validProjectSession);
}
function validPlateSummary(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.genotypes)) return false;
  return strings(value, ['session_id', 'instrument', 'raw_filename']) && numbers(value, ['num_wells', 'ntc_count', 'unknown_count', 'mean_quality'])
    && Object.values(value.genotypes).every(count => typeof count === 'number' && Number.isFinite(count));
}
export function validProjectSummary(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.concordance)) return false;
  return strings(value, ['project_id', 'project_name']) && Array.isArray(value.plates) && value.plates.every(validPlateSummary)
    && numbers(value.concordance, ['concordant_wells', 'total_compared'])
    && nullableNumbers(value.concordance, ['percentage']);
}
