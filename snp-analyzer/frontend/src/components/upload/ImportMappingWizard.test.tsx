import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  parseImportPreview: vi.fn(),
}));

import { ImportMappingWizard } from "./ImportMappingWizard";
import { parseImportPreview } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { useUploadJobStore } from '@/stores/upload-job-store';
import type { ImportParseResponse } from '@/types/api';
import type { ImportPreview } from "@/types/api";

// A well-formed generic "long" preview whose suggested mapping is complete
// (well/cycle/dye/rfu + WT/MT1 role binding) → the flow should reach Import.
function validLongPreview(): ImportPreview {
  return {
    preview_id: "pv1",
    parser_id: "generic-long",
    filename: "run.csv",
    candidate_tables: [],
    inferred_delimiter: ",",
    decimal_separator: ".",
    header_row: 0,
    first_data_row: 1,
    inferred_headers: ["Well", "Cycle", "Dye", "RFU"],
    column_candidates: { well: ["Well"], cycle: ["Cycle"], dye: ["Dye"], rfu: ["RFU"] },
    sample_rows: [
      { Well: "A1", Cycle: "1", Dye: "FAM", RFU: "100" },
      { Well: "A1", Cycle: "1", Dye: "HEX", RFU: "40" },
    ],
    channel_candidates: [],
    assay_mode_candidates: ["wt_mt"],
    warnings: [],
    suggested_mapping: {
      assay_mode: "wt_mt",
      normalization_mode: "none",
      channel_roles: { FAM: "WT", HEX: "MT1" },
      delimiter: ",",
      decimal_separator: ".",
      header_row: 0,
      first_data_row: 1,
      well_column: "Well",
      cycle_column: "Cycle",
      sample_column: null,
      target_column: null,
      dye_column: "Dye",
      role_column: null,
      rfu_column: "RFU",
      rfu_columns: {},
    },
    metadata: {},
  } as ImportPreview;
}

function renderWizard(preview: ImportPreview, onImported = vi.fn()) {
  return render(
    <ImportMappingWizard
      file={new File(["x"], "run.csv")}
      preview={preview}
      previewIssues={[]}
      previewing={false}
      onPreviewAgain={vi.fn()}
      onCancel={vi.fn()}
      onImported={onImported}
    />
  );
}

describe("ImportMappingWizard (guided flow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUploadJobStore.getState().reset();
    useLanguageStore.getState().setLanguage('en');
    useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: null, role: 'admin' } });
  });
  async function submit() {
    for (let step = 0; step < 3; step++) await userEvent.click(screen.getByTestId('wizard-next'));
    await userEvent.click(screen.getByTestId('wizard-import'));
  }
  it.each([{ code: 'role_missing', step: 3 }, { code: 'column_missing', step: 2 }, { code: 'other', step: 4 }])('retains validation $code and routes to step $step', async ({ code, step }) => {
    vi.mocked(parseImportPreview).mockResolvedValue({ status: 'validation_failed', issues: [{ code, message: 'Synthetic validation' }] } as ImportParseResponse);
    renderWizard(validLongPreview()); await submit();
    expect(screen.getByTestId(`wizard-step-${step}`)).toHaveAttribute('aria-current', 'step');
    expect(useUploadJobStore.getState().jobs[0]).toMatchObject({ stage: 'failed', reason: 'invalid' });
  });
  it('publishes confirmed mapped success and records only its session metadata', async () => {
    const response = { session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'VIC', num_wells: 96,
      num_cycles: 40, has_rox: false, suggested_cycle: 40, well_groups: null, data_windows: null };
    vi.mocked(parseImportPreview).mockResolvedValue(response);
    const imported = vi.fn(); renderWizard(validLongPreview(), imported); await submit();
    expect(imported).toHaveBeenCalledWith(response);
    expect(useUploadJobStore.getState().jobs[0]).toMatchObject({ stage: 'success', sessionId: 'synthetic' });
  });
  it('does not expose an unsupported response private message', async () => {
    vi.mocked(parseImportPreview).mockResolvedValue({ status: 'unsupported_analysis_mode', message: 'private-secret' } as ImportParseResponse);
    renderWizard(validLongPreview()); await submit();
    expect(screen.queryByText(/private-secret/)).not.toBeInTheDocument();
    expect(screen.getByText('The request was rejected. Check the selected file or input.')).toBeVisible();
  });
  it('keeps mapping but never renders a secret-bearing parse failure', async () => {
    vi.mocked(parseImportPreview).mockRejectedValue(new Error('token=private-secret'));
    renderWizard(validLongPreview());
    await submit();
    expect(screen.queryByText(/private-secret/)).not.toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-4')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(/outcome is unknown/i)).toBeVisible();
  });
  it('does not publish a held parse success after owner replacement', async () => {
    let resolve!: (value: ImportParseResponse) => void;
    vi.mocked(parseImportPreview).mockReturnValue(new Promise(done => { resolve = done; }));
    const imported = vi.fn();
    renderWizard(validLongPreview(), imported);
    await submit();
    act(() => useAuthStore.getState().setUser({ id: 'other', username: 'other', display_name: null, role: 'admin' }));
    await act(async () => resolve({ session_id: 'late', instrument: 'Synthetic', allele2_dye: 'VIC',
      num_wells: 96, num_cycles: 40, has_rox: false, suggested_cycle: 40 } as ImportParseResponse));
    expect(imported).not.toHaveBeenCalled();
  });

  it("starts on step 1 and shows a 4-step indicator", () => {
    renderWizard(validLongPreview());
    expect(screen.getByTestId("wizard-step-1")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("wizard-step-4")).toBeInTheDocument();
    // Next present on step 1, Import not yet
    expect(screen.getByTestId("wizard-next")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-import")).not.toBeInTheDocument();
  });

  it("advances through steps to Import, which is enabled for a valid mapping", async () => {
    renderWizard(validLongPreview());
    const next = () => screen.getByTestId("wizard-next");
    await userEvent.click(next()); // -> step 2 (columns)
    await userEvent.click(next()); // -> step 3 (roles)
    await userEvent.click(next()); // -> step 4 (review)
    const importBtn = screen.getByTestId("wizard-import");
    expect(importBtn).toBeEnabled();
  });

  it("blocks Next on step 2 when required columns are unmapped", async () => {
    const p = validLongPreview();
    // No suggestion + no headers -> buildInitialMapping leaves well/cycle unset
    p.suggested_mapping = null;
    p.inferred_headers = [];
    p.column_candidates = {};
    p.sample_rows = [];
    renderWizard(p);
    await userEvent.click(screen.getByTestId("wizard-next")); // step 2
    expect(screen.getByTestId("wizard-next")).toBeDisabled();
  });
});
