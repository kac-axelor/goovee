import {NextRequest, NextResponse} from 'next/server';

// ---- CORE IMPORTS ---- //
import {SUBAPP_CODES, SUBAPP_PAGE} from '@/constants';
import {getSession} from '@/lib/core/auth';
import {findSubappAccess, findWorkspace} from '@/orm/workspace';
import {findFile, streamFile} from '@/utils/download';
import {workspacePathname} from '@/utils/workspace';

import {validateStripePayment} from '@/subapps/shop/cart/(protected)/checkout/action';
import {redirect} from 'next/navigation';
// ---- LOCAL IMPORTS ---- //
export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: {tenant: string; workspace: string};
  },
) {
  const {
    workspaceURL,
    tenant: tenantId,
    workspaceURI,
  } = workspacePathname(params);
  const {searchParams} = new URL(request.url);
  const stripeSessionId = searchParams.get('stripe_session_id');
  const stripeError = searchParams.get('stripe_error');

  const session = await getSession();
  const user = session?.user;

  const workspace = await findWorkspace({
    user,
    url: workspaceURL,
    tenantId,
  });

  if (!workspace) {
    return new NextResponse('Invalid workspace', {status: 401});
  }

  const subapp = await findSubappAccess({
    code: SUBAPP_CODES.shop,
    user,
    url: workspaceURL,
    tenantId,
  });

  if (!subapp?.installed) {
    return new NextResponse('Unauthorized', {status: 401});
  }
  if (stripeError || !stripeSessionId) {
    return new NextResponse('Payment failed', {status: 401});
  }

  const res = await validateStripePayment({
    stripeSessionId,
    workspaceURL,
  });
  if (res.error) {
    return new NextResponse(res.message || 'Order failed', {status: 401});
  }

  const orderSubapp = await findSubappAccess({
    code: SUBAPP_CODES.orders,
    user,
    url: workspaceURL,
    tenantId,
  });

  if (orderSubapp) {
    redirect(
      `${workspaceURI}/${SUBAPP_CODES.orders}/${SUBAPP_PAGE.orders}/${res.data}`,
    );
  } else {
    redirect(`${workspaceURI}/shop`);
  }
}
