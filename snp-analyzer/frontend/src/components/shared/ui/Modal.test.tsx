import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(() => document.getElementById('root')?.remove());

it('portals the dialog outside an inert application root and restores it on close', () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  const { rerender } = render(
    <Modal open onClose={vi.fn()} title="Export decision"><button>Continue</button></Modal>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Export decision' });
  expect(root).toHaveAttribute('inert');
  expect(root.contains(dialog)).toBe(false);
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

  rerender(<Modal open={false} onClose={vi.fn()} title="Export decision" />);
  expect(root).not.toHaveAttribute('inert');
});
