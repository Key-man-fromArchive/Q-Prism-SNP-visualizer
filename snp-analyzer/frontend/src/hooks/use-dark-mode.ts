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
