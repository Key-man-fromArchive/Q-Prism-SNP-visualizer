import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TabNavigation } from './TabNavigation';
import { navigateTabs } from '@/lib/tab-keyboard';
it('exposes linked tabs and moves focus without triggering background cycles', () => {
  const change = vi.fn();
  render(<TabNavigation activeTab="plate" onTabChange={change} />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  expect(tabs[0].getAttribute('aria-controls')).toBe('main-panel-plate');
  tabs[0].focus();
  fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
  expect(document.activeElement).toBe(tabs[1]);
  expect(change).toHaveBeenCalledWith('rawdata');
});
it('reaches Plate Setup as a one-click primary tab, ahead of Raw data and Results, with Settings demoted to overflow', () => {
  const change = vi.fn();
  render(<TabNavigation activeTab="plate" onTabChange={change} />);
  const primaryOrder = screen.getAllByRole('tab').map(tab => tab.getAttribute('data-tab'));
  expect(primaryOrder).toEqual(['plate', 'rawdata', 'results', 'quality', 'statistics', 'compare', 'library', 'project']);
  // Plate Setup has its own top-level button -- no Plate Setup/Analysis sub-tab hop.
  fireEvent.click(screen.getByRole('tab', { name: '플레이트 설정' }));
  expect(change).toHaveBeenCalledWith('plate');
  expect(screen.queryByRole('tab', { name: '설정' })).not.toBeInTheDocument();
});
it('surfaces Settings from the More overflow menu', () => {
  const change = vi.fn();
  render(<TabNavigation activeTab="plate" onTabChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '설정' }));
  expect(change).toHaveBeenCalledWith('settings');
});
it('roves focus through the new tab order with Home/End and wraps at both ends', () => {
  const change = vi.fn();
  render(<TabNavigation activeTab="plate" onTabChange={change} />);
  const tabs = screen.getAllByRole('tab');
  tabs[0].focus();
  fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(tabs[tabs.length - 1]);
  fireEvent.keyDown(tabs[tabs.length - 1], { key: 'Home' });
  expect(document.activeElement).toBe(tabs[0]);
  fireEvent.keyDown(tabs[0], { key: 'End' });
  expect(document.activeElement).toBe(tabs[tabs.length - 1]);
});
it('yields to prevented and composing tab events', () => {
  const change = vi.fn();
  render(<div onKeyDown={navigateTabs}><button role="tab" onClick={change}
    onKeyDown={event => event.preventDefault()}>First</button><button role="tab" onClick={change}>Second</button></div>);
  const first = screen.getByRole('tab', { name: 'First' }); first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const second = screen.getByRole('tab', { name: 'Second' });
  fireEvent.keyDown(second, { key: 'ArrowRight', isComposing: true });
  fireEvent.keyDown(second, { key: 'ArrowRight', keyCode: 229 });
  expect(document.activeElement).toBe(first);
  expect(change).not.toHaveBeenCalled();
});
