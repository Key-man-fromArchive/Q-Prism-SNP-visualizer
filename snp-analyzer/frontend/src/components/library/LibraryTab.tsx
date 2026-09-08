// @TASK feat/library-hub - Top-level "라이브러리 / Library" tab shell
// @SPEC Consolidates the standalone Marker Catalog tab and the Plate Setup
//       surface's layout-library panel into ONE top-level, session-free tab
//       with two sub-surfaces. Mirrors AnalysisWorkspace's 2-surface
//       role="tablist" pattern for consistency.
// @TEST e2e/marker-catalog-shot.spec.ts, e2e/p4-s3-layout.spec.ts

import { useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { MarkerCatalogTab } from "@/components/catalog/MarkerCatalogTab";
import { LayoutsLibraryPanel } from "@/components/library/LayoutsLibraryPanel";
import { navigateTabs } from '@/lib/tab-keyboard';

type LibrarySurface = "catalog" | "layouts";

export function LibraryTab() {
  const { t } = useI18n();
  const [activeSurface, setActiveSurface] = useState<LibrarySurface>("catalog");

  return (
    <div>
      <div
        role="tablist"
        onKeyDown={navigateTabs}
        aria-label={t.tabLibrary}
        className="flex gap-1 px-6 pt-3 border-b border-border bg-surface"
      >
        <button
          type="button"
          role="tab"
          id="library-subtab-catalog"
          data-testid="library-subtab-catalog"
          aria-selected={activeSurface === "catalog"}
          aria-controls="library-panel-catalog"
          tabIndex={activeSurface === 'catalog' ? 0 : -1}
          onClick={() => setActiveSurface("catalog")}
          className={`px-4 py-2 rounded-t-md text-sm font-medium cursor-pointer ${
            activeSurface === "catalog"
              ? "bg-bg text-primary border border-b-0 border-border"
              : "text-text-muted hover:text-text"
          }`}
        >
          {t.tabMarkerCatalog}
        </button>
        <button
          type="button"
          role="tab"
          id="library-subtab-layouts"
          data-testid="library-subtab-layouts"
          aria-selected={activeSurface === "layouts"}
          aria-controls="library-panel-layouts"
          tabIndex={activeSurface === 'layouts' ? 0 : -1}
          onClick={() => setActiveSurface("layouts")}
          className={`px-4 py-2 rounded-t-md text-sm font-medium cursor-pointer ${
            activeSurface === "layouts"
              ? "bg-bg text-primary border border-b-0 border-border"
              : "text-text-muted hover:text-text"
          }`}
        >
          {t.libSubtabLayouts}
        </button>
      </div>

      <div
        data-testid="library-panel-catalog"
        id="library-panel-catalog"
        role="tabpanel"
        aria-labelledby="library-subtab-catalog"
        className={activeSurface === "catalog" ? "" : "hidden"}
      >
        <MarkerCatalogTab />
      </div>

      <div
        data-testid="library-panel-layouts"
        id="library-panel-layouts"
        role="tabpanel"
        aria-labelledby="library-subtab-layouts"
        className={activeSurface === "layouts" ? "" : "hidden"}
      >
        {activeSurface === 'layouts' && <LayoutsLibraryPanel />}
      </div>
    </div>
  );
}
