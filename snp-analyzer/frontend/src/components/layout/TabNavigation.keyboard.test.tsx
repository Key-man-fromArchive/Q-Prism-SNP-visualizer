import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TabNavigation } from './TabNavigation';
import { navigateTabs } from '@/lib/tab-keyboard';
it('exposes linked tabs and moves focus without triggering background cycles', () => {
  const change = vi.fn();
  render(<TabNavigation activeTab="analysis" onTabChange={change} />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  expect(tabs[0].getAttribute('aria-controls')).toBe('main-panel-analysis');
  tabs[0].focus();
  fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
  expect(document.activeElement).toBe(tabs[1]);
  expect(change).toHaveBeenCalledWith('protocol');
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
