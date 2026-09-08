import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QualityNavigationNotice } from './QualityNavigationNotice';
import { useNavigationStore } from '@/stores/navigation-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';
import { returnFromQuality } from '@/lib/quality-navigation';
import { useAnalysisStore } from '@/stores/analysis-store';
vi.mock('@/lib/quality-navigation', () => ({ returnFromQuality: vi.fn().mockResolvedValue(true) }));
beforeEach(() => {
  vi.clearAllMocks();
  useNavigationStore.getState().clear();
  useLanguageStore.setState({ language: 'en' });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: null, role: 'user' }, generation: 1 });
  useSessionStore.setState({ sessionId: 's', entryGeneration: 1 });
  useSettingsStore.setState({ useRox: false, backgroundMode: 'none' });
});
it('announces a safe unavailable target and offers an explicit dismiss action', () => {
  useNavigationStore.setState({ qualityError: 'unavailable' });
  render(<QualityNavigationNotice />);
  expect(screen.getByRole('status')).toHaveTextContent('no longer available');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss navigation notice' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('labels the unversioned SID/normalization basis in both locales and exposes Return', () => {
  useNavigationStore.setState({ qualityTarget: { session: 's', well: 'A1', source: 'curve', basis: 'unversioned',
    cycle: 0, useRox: false, inputRevision: null, resultRevision: null, marker: null },
    qualityLease: { owner: 'u', auth: 1, entry: 1, token: 1 },
    qualityReturn: { view: { session: 's', tab: 'quality', surface: 'analysis', marker: null, cycle: 40 }, selection: [] } });
  render(<QualityNavigationNotice />);
  expect(screen.getByRole('status')).toHaveTextContent('unversioned; run s; reference normalization off');
  expect(screen.getByRole('status').querySelector('span > p')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear temporary reveal and return' }));
  expect(returnFromQuality).toHaveBeenCalledOnce();
  act(() => useLanguageStore.setState({ language: 'ko' }));
  expect(screen.getByRole('status')).toHaveTextContent('리비전 없음; 실행 s; 참조 정규화 꺼짐');
  act(() => useSettingsStore.setState({ useRox: true }));
  expect(screen.getByRole('status')).toHaveTextContent('더 이상 확인할 수 없습니다');
});
it.each([[false, 'none', 'off; background none', '꺼짐; 배경 보정 없음'],
  [true, 'pre_read', 'requested; background pre-read', '요청됨; 배경 보정 사전 읽기']] as const)(
  'labels the complete NTC basis without inventing a genotype revision: %s/%s', (useRox, background, english, korean) => {
  useAnalysisStore.setState({ currentInputRevision: 2, result: null });
  useSettingsStore.setState({ useRox, backgroundMode: background });
  useNavigationStore.setState({ qualityTarget: { session: 's', well: 'A1', source: 'ntc', basis: 'current-input',
    cycle: 0, useRox, inputRevision: 2, resultRevision: null, marker: null, background },
    qualityLease: { owner: 'u', auth: 1, entry: 1, token: 1 } });
  render(<QualityNavigationNotice />);
  expect(screen.getByRole('status')).toHaveTextContent('input revision 2; stored result unavailable');
  expect(screen.getByRole('status')).toHaveTextContent(`cycle 0; reference normalization ${english}`);
  act(() => useLanguageStore.setState({ language: 'ko' }));
  expect(screen.getByRole('status')).toHaveTextContent('입력 리비전 2; 저장 결과 확인 불가');
  expect(screen.getByRole('status')).toHaveTextContent(`사이클 0; 참조 정규화 ${korean}`);
});
