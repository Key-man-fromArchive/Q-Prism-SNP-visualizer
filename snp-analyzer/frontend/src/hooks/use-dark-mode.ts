import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "snp-analyzer-dark-mode";

export function useDarkMode() {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === "true";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (isDark) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
    localStorage.setItem(STORAGE_KEY, String(isDark));
    // Notify Plotly charts to update their colors
    window.dispatchEvent(new CustomEvent("dark-mode-changed", { detail: { isDark } }));
  }, [isDark]);

  // Listen for system theme changes when no user preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(STORAGE_KEY) === null) {
        setIsDark(e.matches);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggle = useCallback(() => setIsDark((v) => !v), []);

  return { isDark, toggle };
}


/**
 * Read-only companion to useDarkMode: re-renders the caller whenever the theme
 * changes, without owning the setting.
 *
 * Needed because the dosage palette has its own dark steps now (see
 * lib/genotype.ts). Components that paint genotype marks read the theme at
 * render time, so without a subscription they keep the old colours until
 * something unrelated re-renders them.
 */
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.body.classList.contains("dark")
  );
  useEffect(() => {
    const handler = () => setIsDark(document.body.classList.contains("dark"));
    // useDarkMode dispatches this after it has already updated the body class,
    // so reading the class here is always in step with the event.
    window.addEventListener("dark-mode-changed", handler);
    return () => window.removeEventListener("dark-mode-changed", handler);
  }, []);
  return isDark;
}
