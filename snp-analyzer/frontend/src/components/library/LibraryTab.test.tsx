import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LibraryTab } from './LibraryTab';
vi.mock('@/components/catalog/MarkerCatalogTab', () => ({ MarkerCatalogTab: () => <div>Catalog</div> }));
vi.mock('./LayoutsLibraryPanel', () => ({ LayoutsLibraryPanel: () => <div>Layouts</div> }));
it('links both panels and supports roving keyboard tab activation', () => {
  render(<LibraryTab />);
  const tabs = screen.getAllByRole('tab');
  for (const tab of tabs) expect(document.getElementById(tab.getAttribute('aria-controls')!)).toHaveAttribute('role', 'tabpanel');
  tabs[0].focus(); fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
  expect(tabs[1]).toHaveFocus(); expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  expect(tabs[0]).toHaveAttribute('tabindex', '-1');
});
it('mounts the layouts panel only after the layouts surface is selected', () => {
  render(<LibraryTab />);
  fireEvent.click(screen.getByTestId('library-subtab-layouts'));
  expect(screen.getByText('Layouts')).toBeVisible();
  expect(screen.getByTestId('library-panel-layouts')).toHaveAttribute('aria-labelledby', 'library-subtab-layouts');
});
