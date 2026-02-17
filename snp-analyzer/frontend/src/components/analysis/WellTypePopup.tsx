// @TASK Analysis UI - Well Type Assignment Popup
// @SPEC SNP Analyzer React Migration

import { useRef, useEffect } from 'react';
import { WELL_TYPE_INFO } from '@/lib/constants';

type WellTypePopupProps = {
  wells: string[];
  position: { x: number; y: number };
  onAssign: (wellType: string) => void;
  onClose: () => void;
};

export function WellTypePopup({ wells, position, onAssign, onClose }: WellTypePopupProps) {
  const ref = useRef<HTMLDivElement>(null);

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
        Assign type to {wells.length} well{wells.length > 1 ? 's' : ''}
      </div>

      {Object.entries(WELL_TYPE_INFO).map(([type, info]) => (
        <button
          key={type}
          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-bg cursor-pointer border-none bg-transparent flex items-center gap-2"
          style={{ borderLeft: `3px solid ${info.color}` }}
          onClick={() => onAssign(type)}
        >
          {info.label}
        </button>
      ))}

      <button
        className="w-full text-left px-2 py-1.5 text-sm rounded text-text-muted hover:bg-bg cursor-pointer border-none bg-transparent mt-1"
        onClick={onClose}
      >
        Cancel
      </button>
    </div>
  );
}
