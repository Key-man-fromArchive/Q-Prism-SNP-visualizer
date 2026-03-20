import { useLanguageStore } from '@/stores/language-store';
import en from '@/locales/en';
import ko from '@/locales/ko';
import type { Translations } from '@/locales/en';

const translations: Record<string, Translations> = { en, ko };

export function useI18n() {
  const language = useLanguageStore((s) => s.language);
  const t = translations[language] || en;
  return { t, language };
}
