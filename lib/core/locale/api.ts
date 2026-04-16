import path from 'path';
import fs from 'fs/promises';
import {cache} from 'react';

import {manager} from '@/tenant';
import {DEFAULT_LOCALE} from '@/locale/contants';
import {findLocaleLanguage} from '@/locale/utils';

const tcache: Record<string, Record<string, string>> = {};
const localesDir = path.resolve(process.cwd(), 'public', 'locales');
const localesPromise = fs.readdir(localesDir).catch(() => [] as string[]);

const includeLanguage = () => {
  return process.env.INCLUDE_LANGUAGE === 'true';
};

const findGeneralTranslations = cache(async function findGeneralTranslations(
  locale: string,
  keys?: string[],
) {
  if (!locale) {
    return {};
  }

  const readFile = async (l: string) => {
    const fileName = `${l}.json`;
    const locales = await localesPromise;
    if (!locales.includes(fileName)) {
      return {};
    }
    try {
      const filepath = path.resolve(localesDir, fileName);
      return JSON.parse(await fs.readFile(filepath, 'utf8'));
    } catch (err) {
      console.error(err);
      return {};
    }
  };

  // locale language
  const lang = findLocaleLanguage(locale);

  const readwritecache = async (l: string) => {
    if (tcache[l]) {
      return tcache[l];
    } else {
      const result = await readFile(l);
      tcache[l] = result;
      return result;
    }
  };

  let data: Record<string, string | undefined | null> = {};

  await Promise.all([
    ...(lang !== locale && includeLanguage() ? [readwritecache(lang)] : []),
    readwritecache(locale),
  ]).then(([langTranslations, localeTranslations]) => {
    data = Object.assign(data, langTranslations, localeTranslations);
  });

  if (keys) {
    return keys.reduce(
      (a, k) => {
        a[k] = data[k];
        return a;
      },
      {} as Record<string, string | null | undefined>,
    );
  }

  return data;
});

const findTenantTranslations = cache(async function findTenantTranslations(
  locale: string,
  tenantId: string,
  keys?: string[],
) {
  if (!(locale && tenantId)) {
    return {};
  }

  let data: Record<string, string | undefined | null> = {};

  const find = async (locale: string) => {
    try {
      const tenant = await manager.getTenant(tenantId);
      if (!tenant) return {};
      return tenant.client.aOSMetaTranslation
        .find({
          where: {language: locale, ...(keys ? {key: {in: keys}} : {})},
          select: {key: true, value: true},
        })
        .then(t =>
          t.reduce(
            (acc, i) => {
              if (i.key) {
                acc[i.key] = i.value;
              }
              return acc;
            },
            {} as Record<string, string | null | undefined>,
          ),
        );
    } catch (err) {
      console.error(err);
      return {};
    }
  };

  // locale language
  const lang = findLocaleLanguage(locale);

  await Promise.all([
    ...(lang !== locale && includeLanguage() ? [find(lang)] : []),
    find(locale),
  ]).then(([langTranslations, translations]) => {
    data = {...data, ...langTranslations, ...translations};
  });

  return data;
});

export const findTranslations = cache(async function findTranslations(
  locale: string = DEFAULT_LOCALE,
  tenantId?: string,
  keys?: string[],
) {
  if (!locale) {
    return {};
  }

  let data: Record<string, string | undefined | null> = {};
  await Promise.all([
    findGeneralTranslations(locale, keys),
    ...(tenantId ? [findTenantTranslations(locale, tenantId, keys)] : []),
  ]).then(([generalTranslations, tenantTranslations]) => {
    data = Object.assign(data, generalTranslations, tenantTranslations);
  });

  return data;
});
