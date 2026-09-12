import { create } from 'zustand';

/** Where a `FileWorkspaceTrigger` renders. Exactly one is ever visible at a
 *  time — driven by `visibility.upload` in App.tsx — but both may briefly
 *  register during a re-render, so `focusVisibleTrigger` picks deterministically. */
export type FileWorkspacePlacement = 'header' | 'inline';

interface FileWorkspaceState {
  /** Owned by whichever trigger last called `setOpen(true)`; read by the
   *  always-mounted `FileWorkspaceDrawer` panel so a session created mid-upload
   *  (which swaps which trigger is visible) never closes or remounts it. */
  open: boolean;
  triggers: Partial<Record<FileWorkspacePlacement, HTMLButtonElement>>;
  setOpen: (open: boolean) => void;
  registerTrigger: (placement: FileWorkspacePlacement, el: HTMLButtonElement | null) => void;
  /** Returns focus to whichever trigger is currently on screen when the
   *  panel closes — never the one that opened it, since that one may since
   *  have unmounted. */
  focusVisibleTrigger: () => void;
}

export const useFileWorkspaceStore = create<FileWorkspaceState>((set, get) => ({
  open: false,
  triggers: {},
  setOpen: (open) => set({ open }),
  registerTrigger: (placement, el) => set((state) => {
    const triggers = { ...state.triggers };
    if (el) triggers[placement] = el;
    else delete triggers[placement];
    return { triggers };
  }),
  focusVisibleTrigger: () => {
    const { triggers } = get();
    (triggers.header ?? triggers.inline)?.focus();
  },
}));
