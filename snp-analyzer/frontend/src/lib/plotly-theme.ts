/** Plotly layout colors for light/dark mode */

export function isDarkMode(): boolean {
  return document.body.classList.contains("dark");
}

export function plotlyColors() {
  const dark = isDarkMode();
  return {
    paper_bgcolor: dark ? "#1a1d27" : "#ffffff",
    plot_bgcolor: dark ? "#1a1d27" : "#ffffff",
    fontColor: dark ? "#e4e4e7" : "#1a1a2e",
    gridColor: dark ? "#2d3040" : "#e5e7eb",
    lineColor: dark ? "#2d3040" : "#e5e7eb",
    legendBg: dark ? "rgba(26,29,39,0.8)" : "rgba(255,255,255,0.8)",
    markerLineColor: dark ? "#2d3040" : "#fff",
    selectedLineColor: dark ? "#fff" : "#000",
  };
}
