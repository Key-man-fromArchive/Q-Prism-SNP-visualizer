// @TASK Analysis UI - Well Type Assignment Popup
// @SPEC SNP Analyzer React Migration

import { useRef, useEffect } from 'react';
import { WELL_TYPE_INFO } from '@/lib/constants';
import { genotypeClasses } from '@/lib/genotype';
import { useSettingsStore } from '@/stores/settings-store';
import { useI18n } from '@/hooks/use-i18n';

type WellTypePopupProps = {
  wells: string[];
  position: { x: number; y: number };
  onAssign: (wellType: string) => void;
  onClose: () => void;
};

export function WellTypePopup({ wells, position, onAssign, onClose }: WellTypePopupProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const ploidy = useSettingsStore((s) => s.ploidy);

  const wellTypeLabels: Record<string, string> = {
    NTC: t.wellTypeNTC,
    Unknown: t.wellTypeUnknown,
    'Positive Control': t.wellTypePositiveControl,
    'Allele 1 Homo': t.wellTypeAllele1Homo,
    'Allele 2 Homo': t.wellTypeAllele2Homo,
    Heterozygous: t.wellTypeHeterozygous,
    Undetermined: t.wellTypeUndetermined,
    Empty: t.wellTypeEmpty,
    Omit: t.wellTypeOmit,
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Delay to avoid closing immediately on the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="welltype-popup"
      style={{
        position: 'fixed',
        left: Math.min(position.x, window.innerWidth - 220),
        top: Math.min(position.y, window.innerHeight - 300),
        zIndex: 100,
        background: 'var(--surface, #fff)',
        border: '1px solid var(--border, #e0e4e8)',
        borderRadius: '8px',
        padding: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        minWidth: '180px',
      }}
    >
      <div className="text-xs text-text-muted font-medium mb-2 px-1">
        {t.assignType(wells.length)}
      </div>

      {[
        // Dosage genotype classes for the current ploidy (highest dosage first)
        ...genotypeClasses(ploidy).map((c) => ({ type: c.key, label: c.label, color: c.color })),
        // Fixed control / non-genotype types
        ...['NTC', 'Unknown', 'Positive Control', 'Undetermined'].map((type) => ({
          type,
          label: wellTypeLabels[type] ?? type,
          color: (WELL_TYPE_INFO as Record<string, { color: string }>)[type].color,
        })),
      ].map(({ type, label, color }) => (
        <button
          key={type}
          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-bg cursor-pointer border-none bg-transparent flex items-center gap-2"
          style={{ borderLeft: `3px solid ${color}` }}
          onClick={() => onAssign(type)}
        >
          {wellTypeLabels[type] || label}
        </button>
      ))}

      <div className="border-t border-border my-1" />

      {WELL_TYPE_INFO['Omit'] && (
        <button
          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-bg cursor-pointer border-none bg-transparent flex items-center gap-2"
          style={{ borderLeft: `3px solid ${WELL_TYPE_INFO['Omit'].color}` }}
          onClick={() => onAssign('Omit')}
        >
          {wellTypeLabels['Omit'] || WELL_TYPE_INFO['Omit'].label}
        </button>
      )}

      {WELL_TYPE_INFO['Empty'] && (
        <button
          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-bg cursor-pointer border-none bg-transparent flex items-center gap-2"
          style={{ borderLeft: `3px solid ${WELL_TYPE_INFO['Empty'].color}` }}
          onClick={() => onAssign('Empty')}
        >
          {wellTypeLabels['Empty'] || WELL_TYPE_INFO['Empty'].label}
        </button>
      )}

      <button
        className="w-full text-left px-2 py-1.5 text-sm rounded text-text-muted hover:bg-bg cursor-pointer border-none bg-transparent mt-1"
        onClick={onClose}
      >
        {t.cancel}
      </button>
    </div>
  );
}
