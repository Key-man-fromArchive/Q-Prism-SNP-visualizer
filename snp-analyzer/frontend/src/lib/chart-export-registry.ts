export type ActiveChart = {
  element: HTMLElement;
  caption: string;
  identity: string;
  sessionId: string;
  resultRevision: string;
  cycle: number;
  useRox: boolean;
  backgroundMode: 'none' | 'pre_read' | 'channel_min';
  entry: number;
  ownerId: string | undefined;
};

let active: ActiveChart | null = null;

/** The currently rendered analysis chart, not a global DOM id. */
export function setActiveChart(chart: ActiveChart): void {
  active = chart;
}

export function clearActiveChart(element: HTMLElement): void {
  if (active?.element === element) active = null;
}

export function getActiveChart(sessionId: string, resultRevision: string): ActiveChart | null {
  if (active?.sessionId !== sessionId || active.resultRevision !== resultRevision) return null;
  return active?.element.isConnected ? active : null;
}
