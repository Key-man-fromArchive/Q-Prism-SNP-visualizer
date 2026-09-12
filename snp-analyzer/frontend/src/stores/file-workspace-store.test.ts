import { beforeEach, expect, it } from 'vitest';
import { useFileWorkspaceStore } from './file-workspace-store';

beforeEach(() => {
  useFileWorkspaceStore.setState({ open: false, triggers: {} });
});

it('starts closed with no registered trigger', () => {
  expect(useFileWorkspaceStore.getState().open).toBe(false);
});

it('opens and closes independently of which trigger asked', () => {
  useFileWorkspaceStore.getState().setOpen(true);
  expect(useFileWorkspaceStore.getState().open).toBe(true);
  useFileWorkspaceStore.getState().setOpen(false);
  expect(useFileWorkspaceStore.getState().open).toBe(false);
});

it('focuses the currently registered trigger for its placement on close', () => {
  const inline = document.createElement('button');
  document.body.appendChild(inline);
  useFileWorkspaceStore.getState().registerTrigger('inline', inline);
  useFileWorkspaceStore.getState().focusVisibleTrigger();
  expect(document.activeElement).toBe(inline);
  inline.remove();
});

it('prefers the header trigger over a stale inline registration if both are somehow registered', () => {
  const inline = document.createElement('button');
  const header = document.createElement('button');
  document.body.append(inline, header);
  useFileWorkspaceStore.getState().registerTrigger('inline', inline);
  useFileWorkspaceStore.getState().registerTrigger('header', header);
  useFileWorkspaceStore.getState().focusVisibleTrigger();
  expect(document.activeElement).toBe(header);
  inline.remove();
  header.remove();
});

it('unregisters a trigger on unmount so a stale ref is never focused', () => {
  const header = document.createElement('button');
  document.body.appendChild(header);
  useFileWorkspaceStore.getState().registerTrigger('header', header);
  useFileWorkspaceStore.getState().registerTrigger('header', null);
  useFileWorkspaceStore.getState().focusVisibleTrigger();
  expect(document.activeElement).not.toBe(header);
  header.remove();
});
