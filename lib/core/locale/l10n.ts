import {DEFAULT_DATE_FORMAT, DEFAULT_LOCALE} from '@/locale/contants';
import {dayjs, findDateFormat, findDayjsLocale} from '@/locale/dayjs';
import {
  inverseTransformLocale,
  limitScale,
  transformLocale,
} from '@/locale/utils';

async function initDayjs(locale: string) {
  const data = await findDayjsLocale(locale);
  dayjs.locale(data);
  return data;
}

export const l10n = (() => {
  let locale = '';
  let dateFormat = DEFAULT_DATE_FORMAT;

  async function init(l?: string | null) {
    locale = l || inverseTransformLocale(navigator.language) || DEFAULT_LOCALE;
    const dayjsLocale = await initDayjs(locale);
    dateFormat = findDateFormat(locale, dateFormat, dayjsLocale);
  }

  function getLocale() {
    return locale;
  }

  function getDateFormat() {
    return dateFormat;
  }

  function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
    let {minimumFractionDigits, maximumFractionDigits} = options ?? {};
    minimumFractionDigits = limitScale(minimumFractionDigits);
    maximumFractionDigits = limitScale(maximumFractionDigits);
    return new Intl.NumberFormat(transformLocale(locale), {
      ...options,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
  }

  return {
    init,
    getLocale,
    getDateFormat,
    formatNumber,
  };
})();

export {default as dayjs, type Dayjs} from 'dayjs';
