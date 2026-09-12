/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "plotly.js-dist-min" {
  const Plotly: {
    newPlot(
      root: HTMLElement,
      data: any[],
      layout?: any,
      config?: any
    ): Promise<void>;
    react(
      root: HTMLElement,
      data: any[],
      layout?: any,
      config?: any
    ): Promise<void>;
    restyle(root: HTMLElement, update: any, traceIndex?: number | number[]): Promise<void>;
    relayout(root: HTMLElement, update: any): Promise<void>;
    purge(root: HTMLElement): void;
    // Real, public Plotly API (used to force a redraw at a new container
    // size -- P4-S1-T1's aspect-ratio toggle). Declared here rather than
    // cast around at each call site.
    Plots: {
      resize(root: HTMLElement): void;
    };
    toImage(
      root: HTMLElement,
      options?: {
        format?: 'png' | 'jpeg' | 'webp' | 'svg';
        width?: number;
        height?: number;
        scale?: number;
      }
    ): Promise<string>;
  };
  export default Plotly;
}
