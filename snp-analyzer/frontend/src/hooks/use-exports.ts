import { useCallback } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { exportCsv, exportPdf } from '@/lib/api';
import Plotly from 'plotly.js-dist-min';

/**
 * Hook providing export functions for the current session
 */
export function useExports(): {
  downloadCSV: () => Promise<void>;
  exportPNG: () => Promise<void>;
  exportPDF: () => Promise<void>;
  printReport: () => void;
} {
  const sessionId = useSessionStore((state) => state.sessionId);
  const useRox = useSettingsStore((state) => state.useRox);

  const downloadCSV = useCallback(async () => {
    if (!sessionId) {
      throw new Error('No active session');
    }

    try {
      const blob = await exportCsv(sessionId, undefined, useRox);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snp-results-${sessionId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download CSV:', error);
      throw error;
    }
  }, [sessionId, useRox]);

  const exportPNG = useCallback(async () => {
    const el = document.getElementById('scatter-plot');
    if (!el) {
      throw new Error('Scatter plot element not found');
    }

    try {
      const dataUrl = await Plotly.toImage(el, {
        format: 'png',
        width: 1200,
        height: 900,
        scale: 2,
      });

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `scatter-plot-${sessionId || 'export'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to export PNG:', error);
      throw error;
    }
  }, [sessionId]);

  const exportPDF = useCallback(async () => {
    if (!sessionId) {
      throw new Error('No active session');
    }

    try {
      const blob = await exportPdf(sessionId, useRox);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snp-report-${sessionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      throw error;
    }
  }, [sessionId, useRox]);

  const printReport = useCallback(() => {
    window.print();
  }, []);

  return {
    downloadCSV,
    exportPNG,
    exportPDF,
    printReport,
  };
}
