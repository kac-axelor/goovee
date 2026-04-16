import {getSession} from '@/auth';
import {notFound} from 'next/navigation';
import {workspacePathname} from '@/utils/workspace';
import Form from './form';
import {findGooveeUserByEmail, isAdminContact} from '@/orm/partner';
import {findWorkspace} from '@/orm/workspace';
import {t} from '@/lib/core/locale/server';
import {manager} from '@/lib/core/tenant';

export default async function Page(props: {
  params: Promise<{tenant: string; workspace: string}>;
}) {
  const params = await props.params;
  const {tenant: tenantId, workspaceURL} = workspacePathname(params);
  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return notFound();
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return notFound();
  const {client} = tenant;

  const workspace = await findWorkspace({
    user,
    url: workspaceURL,
    client,
  });

  if (!workspace) {
    return notFound();
  }

  const partner = await findGooveeUserByEmail(user.email, client);

  if (!partner) {
    return notFound();
  }

  const isPartnerUser = !user.isContact;
  const isAdminContactUser = Boolean(
    await isAdminContact({
      client,
      workspaceURL,
    }),
  );

  return (
    <div className="bg-white p-2 lg:p-0 lg:bg-inherit">
      <Form
        partner={partner}
        isPartner={isPartnerUser}
        isAdminContact={isAdminContactUser}
      />
    </div>
  );
}
