import {notFound} from 'next/navigation';
import type {ReactNode} from 'react';

// ---- CORE IMPORTS ---- //
import {getSession} from '@/auth';
import {SUBAPP_CODES} from '@/constants';
import {findSubappAccess} from '@/orm/workspace';
import {workspacePathname} from '@/utils/workspace';
import {manager} from '@/tenant';

export default async function Layout(props: {
  params: Promise<{
    tenant: string;
    workspace: string;
  }>;
  children: ReactNode;
}) {
  const params = await props.params;

  const {children} = props;

  const session = await getSession();
  const user = session?.user;

  const {tenant: tenantId} = params;
  const {workspaceURL} = workspacePathname(params);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return notFound();
  const {client} = tenant;

  const subapp = await findSubappAccess({
    code: SUBAPP_CODES.website,
    user,
    url: workspaceURL,
    client,
  });

  if (!subapp) return notFound();

  return <div className="h-full mb-[72px] lg:mb-0">{children}</div>;
}
