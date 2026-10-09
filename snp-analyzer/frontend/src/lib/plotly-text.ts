// Plotly reads a small HTML subset in chart text (names, hover text, titles,
// annotations) and treats `%{...}` in templates as a placeholder. Data-derived
// strings (sample names, wells, marker/allele/channel/call labels) must show
// exactly as written, so they pass through here before being placed in a
// chart string. Plotly decodes these entities back to the literal character.
// Template markup that the app writes itself (`<br>`, `<b>`, `<extra>`) is
// not passed through this function.

/** Escape a string so Plotly displays it literally. */
export function plotlyText(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/%/g, '&#37;');
}
