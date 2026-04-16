import {notFound, redirect} from 'next/navigation';

// ---- CORE IMPORTS ---- //
import {getSession} from '@/auth';
import {findWorkspace, findSubappAccess} from '@/orm/workspace';
import {clone} from '@/utils';
import {workspacePathname} from '@/utils/workspace';
import {SUBAPP_CODES} from '@/constants';
import {manager} from '@/tenant';

// ---- LOCAL IMPORTS ---- //
import Content from './content';
import {shouldHidePricesAndPurchase} from '@/orm/product';

export default async function Page(props: {
  params: Promise<{tenant: string; workspace: string}>;
}) {
  const params = await props.params;
  const {tenant: tenantId} = params;
  const session = await getSession();

  const {workspaceURL, workspaceURI} = workspacePathname(params);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return notFound();
  const {client} = tenant;

  const workspace = await findWorkspace({
    user: session?.user,
    url: workspaceURL,
    client,
  }).then(clone);

  if (!workspace?.config?.requestQuotation) {
    redirect(`${workspaceURI}/shop/cart`);
  }

  const quotationSubapp = await findSubappAccess({
    code: SUBAPP_CODES.quotations,
    user: session?.user,
    url: workspaceURL,
    client,
  });

  const hidePriceAndPurchase = await shouldHidePricesAndPurchase({
    user: session?.user,
    workspace,
    client,
  });

  if (hidePriceAndPurchase) notFound();
  return (
    <Content workspace={workspace} quotationSubapp={Boolean(quotationSubapp)} />
  );
}
