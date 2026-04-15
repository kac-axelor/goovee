import {findTranslations} from '@/locale/api';
import {NextResponse} from 'next/server';

/* NOTE: Caching handled by the service worker (CacheFirstWithSWR, locale-strategy.ts).
 * uses cache for 24hrs and updates in background. */
export async function GET(
  request: Request,
  props: {params: Promise<{tenant: string; code: string}>},
) {
  const params = await props.params;
  const {code, tenant} = params;
  // NOTE: No auth required since translations are needed for every visitor
  try {
    const translations = await findTranslations(code, tenant);

    return NextResponse.json(translations);
  } catch (err) {
    return NextResponse.json({});
  }
}
