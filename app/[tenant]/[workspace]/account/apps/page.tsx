import {notFound} from 'next/navigation';

// ---- CORE IMPORTS ---- //
import {getSession} from '@/auth';
import {findWorkspace, findSubapps} from '@/orm/workspace';
import {clone} from '@/utils';
import {workspacePathname} from '@/utils/workspace';
import {manager} from '@/lib/core/tenant';

// ---- LOCAL IMPORTS ---- //
import Content from './content';

export default async function Account(props: {
  params: Promise<{tenant: string; workspace: string}>;
}) {
  const params = await props.params;
  const {tenant: tenantId} = params;
  const tenant = await manager.getTenant(tenantId);

  if (!tenant) {
    return notFound();
  }

  const {client} = tenant;
  const session = await getSession();

  if (!session) return notFound();

  const {workspaceURL} = workspacePathname(params);

  const workspace = await findWorkspace({
    user: session?.user,
    url: workspaceURL,
    client,
  }).then(clone);

  if (!workspace) return notFound();

  const subapps = await findSubapps({
    url: workspace.url,
    user: session?.user,
    client,
  });

  return (
    <div className="bg-white p-2 lg:p-0 lg:bg-inherit">
      <Content subapps={subapps} />
    </div>
  );
}
