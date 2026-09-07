import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ManualEditStatus } from './ManualEditStatus';
import { useLanguageStore } from '@/stores/language-store';
it.each(['en', 'ko'] as const)('announces manual pending/errors in a dedicated full-width %s row', language => {
  useLanguageStore.getState().setLanguage(language);
  const view = render(<ManualEditStatus pending error="conflict" />);
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  expect(screen.getByRole('status')).toHaveClass('w-full');
  expect(screen.getByRole('status')).toHaveTextContent(language === 'en' ? 'Saving' : '저장 중');
  for (const error of ['conflict', 'failed', 'unavailable'] as const) {
    view.rerender(<ManualEditStatus pending={false} error={error} />);
    expect(screen.getByRole('status').textContent!.length).toBeGreaterThan(20);
  }
  view.rerender(<ManualEditStatus pending={false} error={null} />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});
