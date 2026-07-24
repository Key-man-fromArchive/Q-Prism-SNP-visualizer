import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  parseImportPreview: vi.fn(),
}));

import { ImportMappingWizard } from "./ImportMappingWizard";
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

function renderWizard(preview: ImportPreview) {
  return render(
    <ImportMappingWizard
      file={new File(["x"], "run.csv")}
      preview={preview}
      previewIssues={[]}
      previewing={false}
      onPreviewAgain={vi.fn()}
      onCancel={vi.fn()}
      onImported={vi.fn()}
    />
  );
}

describe("ImportMappingWizard (guided flow)", () => {
  beforeEach(() => vi.clearAllMocks());

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
