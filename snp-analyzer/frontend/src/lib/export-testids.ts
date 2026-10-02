/** Stable `data-testid` values for the export UI, shared by components and E2E. */
export const EXPORT_TEST_IDS = {
  dialog: 'export-dialog',
  markerList: 'export-marker-list',
  markerSelectAll: 'export-marker-select-all',
  markerOption: 'export-marker-option',
  formatPdf: 'export-format-pdf',
  formatCsv: 'export-format-csv',
  formatXlsx: 'export-format-xlsx',
  formatPptx: 'export-format-pptx',
  formatPngZip: 'export-format-png-zip',
  submit: 'export-submit',
  status: 'export-status',
} as const;

export type ExportTestId = (typeof EXPORT_TEST_IDS)[keyof typeof EXPORT_TEST_IDS];
