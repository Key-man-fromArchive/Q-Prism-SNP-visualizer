import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useQualityFocus } from './use-quality-focus';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';

it('focuses the exact revealed well after its grid appears and never guesses a fallback', async () => {
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: null, role: 'user' }, generation: 1 });
  useSessionStore.setState({ sessionId: 's', entryGeneration: 1 });
  useSettingsStore.setState({ useRox: false });
  useNavigationStore.setState({ tab: 'analysis', surface: 'plate', qualityTarget: { session: 's', well: 'P24',
    source: 'curve', basis: 'unversioned', cycle: 0, useRox: false, marker: null, inputRevision: null, resultRevision: null },
    qualityLease: { owner: 'u', entry: 1, auth: 1, token: 1 } });
  const selected = vi.fn();
  function Grid({ ready }: { ready: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useQualityFocus(ref, 'plate', selected);
    return <div ref={ref}><button data-well-id="A1">A1</button>{ready && <button data-well-id="P24">P24</button>}</div>;
  }
  const view = render(<Grid ready={false} />);
  expect(selected).not.toHaveBeenCalled();
  view.rerender(<Grid ready />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole('button', { name: 'P24' })).toHaveFocus();
  expect(selected).toHaveBeenCalledWith('P24');
});
