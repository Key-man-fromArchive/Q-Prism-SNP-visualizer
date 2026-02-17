import { useEffect, useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSelectionStore } from '@/stores/selection-store';
import { getQc } from '@/lib/api';
import type { QcResponse } from '@/types/api';

export function QcBadges() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const useRox = useSettingsStore((s) => s.useRox);
  const currentCycle = useSelectionStore((s) => s.currentCycle);

  const [qcData, setQcData] = useState<QcResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setQcData(null);
      return;
    }

    const fetchQc = async () => {
      setIsLoading(true);
      try {
        const data = await getQc(sessionId, currentCycle, useRox);
        setQcData(data);
      } catch (error) {
        console.error('Failed to fetch QC data:', error);
        setQcData(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchQc();
  }, [sessionId, currentCycle, useRox]);

  if (!sessionId || isLoading) {
    return null;
  }

  if (!qcData) {
    return null;
  }

  // Helper function to determine badge color
  const getCallRateColor = (rate: number): string => {
    if (rate >= 90) return '#10b981'; // green
    if (rate >= 70) return '#f59e0b'; // amber
    return '#ef4444'; // red
  };

  const getClusterSepColor = (sep: number): string => {
    if (sep >= 2.0) return '#10b981'; // green
    if (sep >= 1.0) return '#f59e0b'; // amber
    return '#ef4444'; // red
  };

  const getNtcColor = (status: string): string => {
    return status === 'ok' ? '#10b981' : '#ef4444';
  };

  const callRatePercent = Math.round(qcData.call_rate * 100);
  const callRateColor = getCallRateColor(qcData.call_rate * 100);
  const callRateTooltip = `${qcData.n_called} / ${qcData.n_total} wells called`;

  return (
    <>
      {/* Call Rate Badge */}
      <span
        className="badge qc-badge"
        style={{ borderColor: callRateColor, color: callRateColor, fontWeight: 600 }}
        title={callRateTooltip}
      >
        Call {callRatePercent}%
      </span>

      {/* NTC Check Badge - only show if ntc_check exists */}
      {qcData.ntc_check && (
        <span
          className="badge qc-badge"
          style={{
            borderColor: getNtcColor(qcData.ntc_check.status),
            color: getNtcColor(qcData.ntc_check.status),
            fontWeight: 600,
          }}
          title={qcData.ntc_check.details}
        >
          {qcData.ntc_check.status === 'ok' ? 'NTC OK' : 'NTC WARN'}
        </span>
      )}

      {/* Cluster Separation Badge - only show if not null */}
      {qcData.cluster_separation !== null && (
        <span
          className="badge qc-badge"
          style={{
            borderColor: getClusterSepColor(qcData.cluster_separation),
            color: getClusterSepColor(qcData.cluster_separation),
            fontWeight: 600,
          }}
          title={`Cluster separation: ${qcData.cluster_separation.toFixed(2)}`}
        >
          Sep {qcData.cluster_separation.toFixed(2)}
        </span>
      )}
    </>
  );
}
