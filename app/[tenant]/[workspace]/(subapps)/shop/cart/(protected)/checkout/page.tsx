import {Suspense} from 'react';
import {notFound, redirect} from 'next/navigation';

// ---- CORE IMPORTS ---- //
import {getSession} from '@/auth';
import {findSubappAccess, findWorkspace} from '@/orm/workspace';
import {clone} from '@/utils';
import {SUBAPP_CODES} from '@/constants';
import {workspacePathname} from '@/utils/workspace';
import {manager} from '@/tenant';

// ---- LOCAL IMPORTS ---- //
import Content from './content';
import {CheckoutSkeleton} from '@/subapps/shop/common/ui/components';
import {shouldHidePricesAndPurchase} from '@/orm/product';

async function Checkout({
  params,
}: {
  params: {tenant: string; workspace: string};
}) {
  const {tenant: tenantId} = params;

  const session = await getSession();
  const user = session?.user;

  const {workspaceURL, workspaceURI} = workspacePathname(params);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return notFound();
  const {client} = tenant;

  const workspace = await findWorkspace({
    user,
    url: workspaceURL,
    client,
  }).then(clone);

  if (!workspace?.config?.confirmOrder) {
    redirect(`${workspaceURI}/shop/cart`);
  }

  const orderSubapp = await findSubappAccess({
    code: SUBAPP_CODES.orders,
    user,
    url: workspaceURL,
    client,
  });

  const hidePriceAndPurchase = await shouldHidePricesAndPurchase({
    user,
    workspace,
    client,
  });

  if (hidePriceAndPurchase) notFound();

  return (
    <Content
      workspace={workspace}
      orderSubapp={orderSubapp}
      tenant={tenantId}
    />
  );
}

export default async function Page(props: {
  params: Promise<{tenant: string; workspace: string}>;
}) {
  const params = await props.params;
  return (
    <Suspense fallback={<CheckoutSkeleton />}>
      <Checkout params={params} />
    </Suspense>
  );
}
