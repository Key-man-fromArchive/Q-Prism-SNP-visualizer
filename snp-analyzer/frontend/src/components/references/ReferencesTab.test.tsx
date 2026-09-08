import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ReferencesTab } from './ReferencesTab';
import { useLanguageStore } from '@/stores/language-store';

it.each([
  ['en', 'Scope and validation status', 'Basis in this tool:'],
  ['ko', '적용 범위와 검증 상태', '이 도구에서의 근거:'],
] as const)('renders every reference group and full DOI links in %s', (language, scope, basis) => {
  useLanguageStore.setState({ language });
  render(<ReferencesTab />);
  expect(screen.getByText(scope)).toBeInTheDocument();
  expect(screen.getAllByText(basis).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('link', { name: /doi:/i })).toHaveLength(6);
  expect(screen.getByRole('link', { name: /10\.1186\/1471-2105-12-172/i })).toHaveAttribute('href', 'https://doi.org/10.1186/1471-2105-12-172');
});
