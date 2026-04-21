import {useMemo} from 'react';

// ---- CORE IMPORTS ---- //
import {DEFAULT_LOCALE} from '@/locale';
import {toTitleCase} from '@/utils/names';

const RTL_LANGS = [
  'ar', // Arabic
  'fa', // Persian
  'he', // Hebrew
  'ur', // Urdu
];

// https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang
function toLangTag(lang: string) {
  const parts = lang.split(/-|_/g);
  if (parts.length > 0) parts[0] = parts[0].toLowerCase();
  if (parts.length === 2) parts[1] = parts[1].toUpperCase();
  if (parts.length === 3) {
    parts[1] = toTitleCase(parts[1]);
    parts[2] = parts[2].toUpperCase();
  }
  return parts.join('-');
}

const isRTL = (lang: string) =>
  RTL_LANGS.some(x => lang === x || lang.startsWith(`${x}-`));

export function useAppLang(opts: {locale?: string | null}) {
  const locale = opts?.locale ?? DEFAULT_LOCALE;

  const lang = useMemo(() => toLangTag(locale), [locale]);
  const dir = useMemo(() => (isRTL(lang) ? 'rtl' : 'ltr'), [lang]);

  return {
    dir,
    lang,
  };
}
