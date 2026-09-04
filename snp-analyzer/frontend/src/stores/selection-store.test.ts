import { beforeEach, describe, expect, it } from 'vitest';
import { useSelectionStore } from './selection-store';

/** The scatter plot can only box ONE rectangle at a time, and on a real plate
 *  the wells an operator has to act on are scattered across it — the 26 failed
 *  wells on 1-2_admin_2026-09-03 16-14-11_783BR20183.pcrd were spread over all
 *  eight rows. Without additive selection every new box erased the last one. */
describe('selection store', () => {
  beforeEach(() => {
    useSelectionStore.setState({
      selectedWell: null,
      selectedWells: [],
      focusSelectedWells: false,
    });
  });

  it('replaces on a plain multi-select', () => {
    const { selectWells } = useSelectionStore.getState();
    selectWells(['A1', 'A2']);
    selectWells(['B1']);
    expect(useSelectionStore.getState().selectedWells).toEqual(['B1']);
  });

  it('unions across boxes without duplicating', () => {
    const { selectWells, addWells } = useSelectionStore.getState();
    selectWells(['A1', 'A2']);
    addWells(['A2', 'B1']);
    expect(useSelectionStore.getState().selectedWells).toEqual(['A1', 'A2', 'B1']);
  });

  it('toggles a single well in and back out', () => {
    const { selectWells, toggleWell } = useSelectionStore.getState();
    selectWells(['A1', 'A2']);
    toggleWell('A2');
    expect(useSelectionStore.getState().selectedWells).toEqual(['A1']);
    toggleWell('B7');
    expect(useSelectionStore.getState().selectedWells).toEqual(['A1', 'B7']);
  });

  it('reports a lone well as the single selection, for the detail panel', () => {
    const { addWells, toggleWell } = useSelectionStore.getState();
    addWells(['A1']);
    expect(useSelectionStore.getState().selectedWell).toBe('A1');
    addWells(['A2']);
    expect(useSelectionStore.getState().selectedWell).toBeNull();
    toggleWell('A2');
    expect(useSelectionStore.getState().selectedWell).toBe('A1');
  });

  it('keeps the "selected only" view preference when the selection is cleared', () => {
    // Plotly fires deselect on any click on empty canvas. Resetting the focus
    // flag there meant one stray click threw away a view the operator had
    // deliberately switched on.
    const { selectWells, setFocusSelectedWells, clearSelection } = useSelectionStore.getState();
    selectWells(['A1']);
    setFocusSelectedWells(true);
    clearSelection();
    const state = useSelectionStore.getState();
    expect(state.selectedWells).toEqual([]);
    expect(state.focusSelectedWells).toBe(true);
  });
});
