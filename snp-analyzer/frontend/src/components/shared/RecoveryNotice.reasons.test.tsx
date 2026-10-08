import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { RecoveryNotice } from './RecoveryNotice';
import { useLanguageStore } from '@/stores/language-store';

beforeEach(() => useLanguageStore.getState().setLanguage('ko'));

it('explains an unreadable file as not sent, never as "may already be saved"', () => {
  render(<RecoveryNotice reason="unreadable" />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('파일을 읽을 수 없어 전송하지 않았습니다');
  expect(alert).not.toHaveTextContent('이미 저장되었을 수 있으므로');
});

it('explains an .eds without measured reads', () => {
  render(<RecoveryNotice reason="no_measurement_data" />);
  expect(screen.getByRole('alert')).toHaveTextContent('측정된 형광 데이터가 없습니다');
});
