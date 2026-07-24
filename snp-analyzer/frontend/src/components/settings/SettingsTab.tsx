import { useEffect, useState, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { useI18n } from "@/hooks/use-i18n";
import { Button, Card } from "@/components/shared/ui";
import {
  getPresets,
  createPreset,
  deletePreset as apiDeletePreset,
  runClustering as apiRunClustering,
} from "@/lib/api";
import type { PresetResponse } from "@/types/api";

export function SettingsTab() {
  const { t } = useI18n();
  const [presets, setPresets] = useState<PresetResponse[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [newPresetName, setNewPresetName] = useState("");
  const [clusterLoading, setClusterLoading] = useState(false);

  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const sessionId = useSessionStore((s) => s.sessionId);

  const {
    useRox, setUseRox,
    fixAxis, setFixAxis,
    xMin, setXMin, xMax, setXMax,
    yMin, setYMin, yMax, setYMax,
    clusterAlgorithm, setClusterAlgorithm,
    ntcThreshold, setNtcThreshold,
    allele1RatioMax, setAllele1RatioMax,
    allele2RatioMin, setAllele2RatioMin,
    nClusters, setNClusters,
    showAutoCluster, setShowAutoCluster,
    showManualTypes, setShowManualTypes,
    resetToDefaults,
  } = useSettingsStore();

  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const setClusterAssignments = useDataStore((s) => s.setClusterAssignments);
  const [showThresholdLines, setShowThresholdLines] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);

  // Load presets on mount
  const loadPresetList = useCallback(async () => {
    try {
      const data = await getPresets();
      setPresets(data.presets || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadPresetList();
  }, [loadPresetList]);

  const handleApplyPreset = useCallback(() => {
    const preset = presets.find((p) => p.id === selectedPresetId);
    if (!preset) return;

    const s = preset.settings;
    if (s.use_rox !== undefined) setUseRox(s.use_rox);
    if (s.fix_axis !== undefined) setFixAxis(s.fix_axis);
    if (s.x_min !== undefined) setXMin(s.x_min);
    if (s.x_max !== undefined) setXMax(s.x_max);
    if (s.y_min !== undefined) setYMin(s.y_min);
    if (s.y_max !== undefined) setYMax(s.y_max);
    if (s.algorithm !== undefined) setClusterAlgorithm(s.algorithm);
    if (s.ntc_threshold !== undefined) setNtcThreshold(s.ntc_threshold);
    if (s.allele1_ratio_max !== undefined) setAllele1RatioMax(s.allele1_ratio_max);
    if (s.allele2_ratio_min !== undefined) setAllele2RatioMin(s.allele2_ratio_min);
    if (s.n_clusters !== undefined) setNClusters(s.n_clusters);
  }, [
    selectedPresetId, presets,
    setUseRox, setFixAxis, setXMin, setXMax, setYMin, setYMax,
    setClusterAlgorithm, setNtcThreshold, setAllele1RatioMax, setAllele2RatioMin, setNClusters,
  ]);

  const handleSavePreset = useCallback(async () => {
    const name = newPresetName.trim();
    if (!name) return;

    try {
      await createPreset(name, {
        algorithm: clusterAlgorithm,
        ntc_threshold: ntcThreshold,
        allele1_ratio_max: allele1RatioMax,
        allele2_ratio_min: allele2RatioMin,
        n_clusters: nClusters,
        use_rox: useRox,
        fix_axis: fixAxis,
        x_min: xMin,
        x_max: xMax,
        y_min: yMin,
        y_max: yMax,
      });
      setNewPresetName("");
      await loadPresetList();
    } catch {
      // ignore
    }
  }, [
    newPresetName, clusterAlgorithm, ntcThreshold, allele1RatioMax, allele2RatioMin,
    nClusters, useRox, fixAxis, xMin, xMax, yMin, yMax, loadPresetList,
  ]);

  const handleDeletePreset = useCallback(async () => {
    if (!selectedPresetId) return;
    try {
      await apiDeletePreset(selectedPresetId);
      setSelectedPresetId("");
      await loadPresetList();
    } catch {
      // ignore
    }
  }, [selectedPresetId, loadPresetList]);

  const handleRunClustering = useCallback(async () => {
    if (!sessionId) return;

    setClusterLoading(true);
    setClusterError(null);
    try {
      const result = await apiRunClustering(sessionId, {
        algorithm: clusterAlgorithm,
        cycle: currentCycle || 0,
        threshold_config:
          clusterAlgorithm === "threshold"
            ? {
                ntc_threshold: ntcThreshold,
                allele1_ratio_max: allele1RatioMax,
                allele2_ratio_min: allele2RatioMin,
              }
            : null,
        n_clusters: nClusters,
      });
      setClusterAssignments(result.assignments);
      window.dispatchEvent(new CustomEvent("asg-result-dirty"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Clustering failed";
      setClusterError(msg);
      console.error("Clustering failed:", err);
    } finally {
      setClusterLoading(false);
    }
  }, [sessionId, clusterAlgorithm, currentCycle, ntcThreshold, allele1RatioMax, allele2RatioMin, nClusters, setClusterAssignments]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 sm:px-6">
      {/* Panel 1: Assay Presets */}
      <Card title={t.assayPresets}>
        <div className="mb-4">
          <div className="flex gap-2 items-center">
            <select
              id="preset-select"
              className="flex-1 px-2 py-1.5 border border-border rounded text-sm bg-surface text-text"
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
            >
              <option value="">{t.selectPreset}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.builtin ? ` ${t.builtIn}` : ""}
                </option>
              ))}
            </select>
            <Button
              id="apply-preset-btn"
              size="sm"
              onClick={handleApplyPreset}
              disabled={!selectedPresetId}
            >
              {t.apply}
            </Button>
            <Button
              id="delete-preset-btn"
              variant="danger"
              size="sm"
              title={t.deleteSelectedPreset}
              onClick={handleDeletePreset}
              disabled={!selectedPresetId}
            >
              {t.del}
            </Button>
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <input
            id="preset-name-input"
            type="text"
            className="flex-1 px-2 py-1.5 border border-border rounded text-sm bg-surface text-text"
            placeholder={t.newPresetName}
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
          />
          <Button
            id="save-preset-btn"
            size="sm"
            onClick={handleSavePreset}
            disabled={!newPresetName.trim()}
          >
            {t.save}
          </Button>
        </div>
      </Card>

      {/* Panel 2: Normalization */}
      {sessionInfo?.has_rox === true && (
        <Card id="rox-normalize-group" title={t.normalization}>
          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                id="rox-normalize-checkbox"
                type="checkbox"
                className="accent-primary w-4 h-4"
                checked={useRox}
                onChange={(e) => setUseRox(e.target.checked)}
              />
              {t.roxNormalization}
            </label>
            <p className="text-xs text-text-muted mt-1 ml-6">
              {t.roxDescription}
            </p>
          </div>
        </Card>
      )}

      {/* Panel 3: Scatter Plot Axis */}
      <Card title={t.scatterPlotAxis}>
        <div className="mb-4">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              id="fix-axis-checkbox"
              type="checkbox"
              className="accent-primary w-4 h-4"
              checked={fixAxis}
              onChange={(e) => setFixAxis(e.target.checked)}
            />
            {t.fixAxisRange}
          </label>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted font-medium">{t.xAxisMin}</span>
            <input
              id="x-axis-min"
              type="number"
              step="0.5"
              className="w-20 px-2 py-1.5 border border-border rounded text-sm disabled:opacity-50 disabled:bg-bg"
              value={xMin}
              onChange={(e) => setXMin(parseFloat(e.target.value) || 0)}
              disabled={!fixAxis}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted font-medium">{t.xAxisMax}</span>
            <input
              id="x-axis-max"
              type="number"
              step="0.5"
              className="w-20 px-2 py-1.5 border border-border rounded text-sm disabled:opacity-50 disabled:bg-bg"
              value={xMax}
              onChange={(e) => setXMax(parseFloat(e.target.value) || 12)}
              disabled={!fixAxis}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted font-medium">{t.yAxisMin}</span>
            <input
              id="y-axis-min"
              type="number"
              step="0.5"
              className="w-20 px-2 py-1.5 border border-border rounded text-sm disabled:opacity-50 disabled:bg-bg"
              value={yMin}
              onChange={(e) => setYMin(parseFloat(e.target.value) || 0)}
              disabled={!fixAxis}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted font-medium">{t.yAxisMax}</span>
            <input
              id="y-axis-max"
              type="number"
              step="0.5"
              className="w-20 px-2 py-1.5 border border-border rounded text-sm disabled:opacity-50 disabled:bg-bg"
              value={yMax}
              onChange={(e) => setYMax(parseFloat(e.target.value) || 12)}
              disabled={!fixAxis}
            />
          </div>
        </div>
      </Card>

      {/* Panel 4: Auto Clustering */}
      <Card title={t.autoClustering}>

        <div className="mb-4">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="cluster-algo"
                value="threshold"
                checked={clusterAlgorithm === "threshold"}
                onChange={() => setClusterAlgorithm("threshold")}
              />
              {t.threshold}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="cluster-algo"
                value="kmeans"
                checked={clusterAlgorithm === "kmeans"}
                onChange={() => setClusterAlgorithm("kmeans")}
              />
              {t.kmeans}
            </label>
          </div>
        </div>

        {clusterAlgorithm === "threshold" && (
          <div id="threshold-config" className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted font-medium">{t.ntcThreshold}</span>
              <input
                id="ntc-threshold"
                type="number"
                min="0"
                step="0.05"
                className="w-20 px-2 py-1.5 border border-border rounded text-sm"
                value={ntcThreshold}
                onChange={(e) => setNtcThreshold(parseFloat(e.target.value) || 0.1)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted font-medium">{t.allele1MaxRatio}</span>
              <input
                id="allele1-ratio-max"
                type="number"
                min="0"
                max="1"
                step="0.05"
                className="w-20 px-2 py-1.5 border border-border rounded text-sm"
                value={allele1RatioMax}
                onChange={(e) => setAllele1RatioMax(parseFloat(e.target.value) || 0.4)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted font-medium">{t.allele2MinRatio}</span>
              <input
                id="allele2-ratio-min"
                type="number"
                min="0"
                max="1"
                step="0.05"
                className="w-20 px-2 py-1.5 border border-border rounded text-sm"
                value={allele2RatioMin}
                onChange={(e) => setAllele2RatioMin(parseFloat(e.target.value) || 0.6)}
              />
            </div>
          </div>
        )}

        {clusterAlgorithm === "kmeans" && (
          <div id="kmeans-config" className="mb-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted font-medium">{t.numberOfClusters}</span>
              <input
                id="n-clusters"
                type="number"
                min="2"
                max="6"
                step="1"
                className="w-20 px-2 py-1.5 border border-border rounded text-sm"
                value={nClusters}
                onChange={(e) => setNClusters(parseInt(e.target.value) || 4)}
              />
            </div>
          </div>
        )}

        {clusterError && (
          <div className="mb-3 px-3 py-2 bg-danger/10 text-danger border border-danger/30 rounded text-xs">
            {clusterError}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            id="run-clustering-btn"
            size="sm"
            onClick={handleRunClustering}
            disabled={!sessionId || clusterLoading}
          >
            {clusterLoading ? t.running : t.runAutoClustering}
          </Button>
          <Button
            id="toggle-threshold-lines-btn"
            variant={showThresholdLines ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              setShowThresholdLines((v) => !v);
              window.dispatchEvent(
                new CustomEvent("threshold-lines-toggle", {
                  detail: { visible: !showThresholdLines },
                })
              );
            }}
          >
            {showThresholdLines ? t.hideThresholdLines : t.showThresholdLines}
          </Button>
        </div>
      </Card>

      {/* Panel 5: Display Layers */}
      <Card title={t.displayLayers}>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              id="show-auto-cluster"
              type="checkbox"
              className="accent-primary w-4 h-4"
              checked={showAutoCluster}
              onChange={(e) => setShowAutoCluster(e.target.checked)}
            />
            {t.showAutoClusterLayer}
          </label>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              id="show-manual-types"
              type="checkbox"
              className="accent-primary w-4 h-4"
              checked={showManualTypes}
              onChange={(e) => setShowManualTypes(e.target.checked)}
            />
            {t.showManualTypesLayer}
          </label>
        </div>
      </Card>

      {/* Panel 6: Reset */}
      <Card className="flex items-center gap-3">
        <Button
          id="reset-defaults-btn"
          variant="secondary"
          size="sm"
          className="text-danger border-danger hover:bg-danger/10 hover:text-danger"
          onClick={resetToDefaults}
        >
          {t.resetToDefaults}
        </Button>
        <span className="text-xs text-text-muted">
          {t.resetDescription}
        </span>
      </Card>
    </div>
  );
}
