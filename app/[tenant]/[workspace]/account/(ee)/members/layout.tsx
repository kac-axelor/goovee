import {notFound} from 'next/navigation';

// ---- CORE IMPORTS ---- //
import {getSession} from '@/auth';
import {isAdminContact, isPartner} from '@/orm/partner';
import {workspacePathname} from '@/utils/workspace';
import {manager} from '@/tenant';

export default async function Layout(props: {
  children: React.ReactNode;
  params: Promise<{
    tenant: string;
    workspace: string;
  }>;
}) {
  const params = await props.params;

  const {children} = props;

  const session = await getSession();
  if (!session) return notFound();

  const {tenant: tenantId, workspaceURL} = workspacePathname(params);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return notFound();
  const {client} = tenant;

  const isAdmin =
    (await isPartner()) ||
    (await isAdminContact({
      client,
      workspaceURL,
    }));

  if (!isAdmin) {
    return notFound();
  }

  return <>{children}</>;
}
