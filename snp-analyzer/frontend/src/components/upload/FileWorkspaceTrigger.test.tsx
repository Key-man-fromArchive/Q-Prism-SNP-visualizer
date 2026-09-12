import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileWorkspaceTrigger } from './FileWorkspaceTrigger';
import { useFileWorkspaceStore } from '@/stores/file-workspace-store';
import { useSessionStore } from '@/stores/session-store';
import { useLanguageStore } from '@/stores/language-store';

beforeEach(() => {
  useLanguageStore.setState({ language: 'en' });
  useFileWorkspaceStore.setState({ open: false, triggers: {} });
  useSessionStore.setState({ openSessionIds: [] });
});

describe.each(['header', 'inline'] as const)('FileWorkspaceTrigger placement=%s', (placement) => {
  it('opens the shared panel state when clicked', () => {
    render(<FileWorkspaceTrigger placement={placement} />);
    fireEvent.click(screen.getByRole('button'));
    expect(useFileWorkspaceStore.getState().open).toBe(true);
  });

  it('reflects the shared open state via aria-expanded', () => {
    useFileWorkspaceStore.setState({ open: true });
    render(<FileWorkspaceTrigger placement={placement} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows an open-session count badge only once there is at least one open file', () => {
    const { rerender } = render(<FileWorkspaceTrigger placement={placement} />);
    expect(screen.queryByText('2')).not.toBeInTheDocument();
    useSessionStore.setState({ openSessionIds: ['a', 'b'] });
    rerender(<FileWorkspaceTrigger placement={placement} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('registers itself on mount and unregisters on unmount', () => {
    const { unmount } = render(<FileWorkspaceTrigger placement={placement} />);
    expect(useFileWorkspaceStore.getState().triggers[placement]).toBeInstanceOf(HTMLButtonElement);
    unmount();
    expect(useFileWorkspaceStore.getState().triggers[placement]).toBeUndefined();
  });
});

it('gives the header and inline triggers distinct test ids for placement-aware assertions', () => {
  const { unmount } = render(<FileWorkspaceTrigger placement="header" />);
  expect(screen.getByTestId('file-workspace-trigger-header')).toBeInTheDocument();
  unmount();
  render(<FileWorkspaceTrigger placement="inline" />);
  expect(screen.getByTestId('file-workspace-trigger-inline')).toBeInTheDocument();
});

it('uses a clearer label for the inline placement than the compact header label', () => {
  render(<FileWorkspaceTrigger placement="inline" />);
  expect(screen.getByRole('button')).toHaveTextContent('Manage multiple files');
});
