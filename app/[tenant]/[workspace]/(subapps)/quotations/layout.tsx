import React from 'react';
import {notFound} from 'next/navigation';

// ---- CORE IMPORTS ---- //
import {findSubappAccess, findWorkspace} from '@/orm/workspace';
import {getSession} from '@/auth';
import {workspacePathname} from '@/utils/workspace';
import {SUBAPP_CODES} from '@/constants';
import {manager} from '@/lib/core/tenant';

export default async function Layout(props: {
  params: Promise<{
    tenant: string;
    workspace: string;
  }>;
  children: React.ReactNode;
}) {
  const params = await props.params;

  const {children} = props;

  const {tenant: tenantId} = params;
  const tenant = await manager.getTenant(tenantId);

  if (!tenant) {
    return notFound();
  }

  const {client} = tenant;
  const session = await getSession();

  const user = session?.user;

  if (!user) {
    return notFound();
  }

  const {workspaceURL} = workspacePathname(params);

  const workspace = await findWorkspace({
    user: session?.user,
    url: workspaceURL,
    client,
  });

  if (!workspace) return notFound();

  const subapp = await findSubappAccess({
    code: SUBAPP_CODES.quotations,
    user: session?.user,
    url: workspaceURL,
    client,
  });

  if (!subapp) return notFound();

  return <div className="!mb-20 md:mb-0">{children}</div>;
}
