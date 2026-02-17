import { useEffect, useState, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useSessionStore } from "@/stores/session-store";
import { useDataStore } from "@/stores/data-store";
import {
  getPresets,
  createPreset,
  deletePreset as apiDeletePreset,
  runClustering as apiRunClustering,
} from "@/lib/api";
import type { PresetResponse } from "@/types/api";

export function SettingsTab() {
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
  } = useSettingsStore();

  const setClusterAssignments = useDataStore((s) => s.setClusterAssignments);

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
    try {
      const result = await apiRunClustering(sessionId, {
        algorithm: clusterAlgorithm,
        cycle: 0,
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
    } catch (err) {
      console.error("Clustering failed:", err);
    } finally {
      setClusterLoading(false);
    }
  }, [sessionId, clusterAlgorithm, ntcThreshold, allele1RatioMax, allele2RatioMin, nClusters, setClusterAssignments]);

  return (
    <div
      className="settings-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
        gap: "16px",
        padding: "16px 24px",
      }}
    >
      {/* Panel 1: Assay Presets */}
      <div className="panel">
        <h3 className="text-sm font-semibold mb-3 text-text">Assay Presets</h3>

        <div className="mb-4">
          <div className="flex gap-2 items-center">
            <select
              id="preset-select"
              className="flex-1 px-2 py-1.5 border border-border rounded text-[13px] bg-surface text-text"
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
            >
              <option value="">-- Select Preset --</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.builtin ? " (built-in)" : ""}
                </option>
              ))}
            </select>
            <button
              id="apply-preset-btn"
              className="px-3 py-1.5 bg-primary text-white rounded text-[13px] cursor-pointer border-none hover:bg-primary-hover"
              onClick={handleApplyPreset}
              disabled={!selectedPresetId}
            >
              Apply
            </button>
            <button
              id="delete-preset-btn"
              className="badge cursor-pointer text-danger"
              title="Delete selected preset"
              onClick={handleDeletePreset}
              disabled={!selectedPresetId}
            >
              Del
            </button>
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <input
            id="preset-name-input"
            type="text"
            className="flex-1 px-2 py-1.5 border border-border rounded text-[13px] bg-surface text-text"
            placeholder="New preset name"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
          />
          <button
            id="save-preset-btn"
            className="px-3 py-1.5 bg-accent text-white rounded text-[13px] cursor-pointer border-none"
            onClick={handleSavePreset}
            disabled={!newPresetName.trim()}
          >
            Save
          </button>
        </div>
      </div>

      {/* Panel 2: Normalization */}
      {sessionInfo?.has_rox !== false && (
        <div id="rox-normalize-group" className="panel">
          <h3 className="text-sm font-semibold mb-3 text-text">Normalization</h3>
          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                id="rox-normalize-checkbox"
                type="checkbox"
                className="accent-primary w-4 h-4"
                checked={useRox}
                onChange={(e) => setUseRox(e.target.checked)}
              />
              ROX normalization (FAM/ROX, Allele2/ROX)
            </label>
            <p className="text-xs text-text-muted mt-1 ml-6">
              Recommended for ABI/QuantStudio. Not recommended for Bio-Rad CFX (ROX crosstalk).
            </p>
          </div>
        </div>
      )}

      {/* Panel 3: Scatter Plot Axis */}
      <div className="panel">
        <h3 className="text-sm font-semibold mb-3 text-text">Scatter Plot Axis</h3>
        <div className="mb-4">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              id="fix-axis-checkbox"
              type="checkbox"
              className="accent-primary w-4 h-4"
              checked={fixAxis}
              onChange={(e) => setFixAxis(e.target.checked)}
            />
            Fix axis range
          </label>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted font-medium">X axis min</span>
            <input
              id="x-axis-min"
              type="number"
              step="0.5"
              className="w-20 px-2 py-1.5 border border-border rounded text-[13px] disabled:opacity-50 disabled:bg-bg"
              value={xMin}
              onChange={(e) => setXMin(parseFloat(e.target.value) || 0)}
              disabled={!fixAxis}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted font-medium">X axis max</span>
            <input
              id="x-axis-max"
              type="number"
              step="0.5"
              className="w-20 px-2 py-1.5 border border-border rounded text-[13px] disabled:opacity-50 disabled:bg-bg"
              value={xMax}
              onChange={(e) => setXMax(parseFloat(e.target.value) || 12)}
              disabled={!fixAxis}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted font-medium">Y axis min</span>
            <input
              id="y-axis-min"
              type="number"
              step="0.5"
              className="w-20 px-2 py-1.5 border border-border rounded text-[13px] disabled:opacity-50 disabled:bg-bg"
              value={yMin}
              onChange={(e) => setYMin(parseFloat(e.target.value) || 0)}
              disabled={!fixAxis}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted font-medium">Y axis max</span>
            <input
              id="y-axis-max"
              type="number"
              step="0.5"
              className="w-20 px-2 py-1.5 border border-border rounded text-[13px] disabled:opacity-50 disabled:bg-bg"
              value={yMax}
              onChange={(e) => setYMax(parseFloat(e.target.value) || 12)}
              disabled={!fixAxis}
            />
          </div>
        </div>
      </div>

      {/* Panel 4: Auto Clustering */}
      <div className="panel">
        <h3 className="text-sm font-semibold mb-3 text-text">Auto Clustering</h3>

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
              Threshold
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="cluster-algo"
                value="kmeans"
                checked={clusterAlgorithm === "kmeans"}
                onChange={() => setClusterAlgorithm("kmeans")}
              />
              K-means
            </label>
          </div>
        </div>

        {clusterAlgorithm === "threshold" && (
          <div id="threshold-config" className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted font-medium">NTC threshold</span>
              <input
                id="ntc-threshold"
                type="number"
                min="0"
                step="0.05"
                className="w-20 px-2 py-1.5 border border-border rounded text-[13px]"
                value={ntcThreshold}
                onChange={(e) => setNtcThreshold(parseFloat(e.target.value) || 0.1)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted font-medium">Allele 2 max ratio</span>
              <input
                id="allele1-ratio-max"
                type="number"
                min="0"
                max="1"
                step="0.05"
                className="w-20 px-2 py-1.5 border border-border rounded text-[13px]"
                value={allele1RatioMax}
                onChange={(e) => setAllele1RatioMax(parseFloat(e.target.value) || 0.4)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted font-medium">Allele 1 min ratio</span>
              <input
                id="allele2-ratio-min"
                type="number"
                min="0"
                max="1"
                step="0.05"
                className="w-20 px-2 py-1.5 border border-border rounded text-[13px]"
                value={allele2RatioMin}
                onChange={(e) => setAllele2RatioMin(parseFloat(e.target.value) || 0.6)}
              />
            </div>
          </div>
        )}

        {clusterAlgorithm === "kmeans" && (
          <div id="kmeans-config" className="mb-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted font-medium">Number of clusters</span>
              <input
                id="n-clusters"
                type="number"
                min="2"
                max="6"
                step="1"
                className="w-20 px-2 py-1.5 border border-border rounded text-[13px]"
                value={nClusters}
                onChange={(e) => setNClusters(parseInt(e.target.value) || 4)}
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            id="run-clustering-btn"
            className="px-4 py-1.5 bg-primary text-white rounded text-[13px] cursor-pointer border-none hover:bg-primary-hover disabled:opacity-50"
            onClick={handleRunClustering}
            disabled={!sessionId || clusterLoading}
          >
            {clusterLoading ? "Running..." : "Run Auto Clustering"}
          </button>
          <button
            id="toggle-threshold-lines-btn"
            className="px-4 py-1.5 bg-surface text-primary border border-primary rounded text-[13px] cursor-pointer"
          >
            Show Threshold Lines
          </button>
        </div>
      </div>

      {/* Panel 5: Display Layers */}
      <div className="panel">
        <h3 className="text-sm font-semibold mb-3 text-text">Display Layers</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              id="show-auto-cluster"
              type="checkbox"
              className="accent-primary w-4 h-4"
              checked={showAutoCluster}
              onChange={(e) => setShowAutoCluster(e.target.checked)}
            />
            Show auto-clustering layer
          </label>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              id="show-manual-types"
              type="checkbox"
              className="accent-primary w-4 h-4"
              checked={showManualTypes}
              onChange={(e) => setShowManualTypes(e.target.checked)}
            />
            Show manual well types layer
          </label>
        </div>
      </div>
    </div>
  );
}
