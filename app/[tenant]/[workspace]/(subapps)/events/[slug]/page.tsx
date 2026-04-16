import {notFound} from 'next/navigation';

// ---- CORE IMPORTS ---- //
import {manager} from '@/lib/core/tenant/manager';
import {findEvent} from '@/subapps/events/common/orm/event';
import {clone} from '@/utils';
import {workspacePathname} from '@/utils/workspace';
import {findWorkspace} from '@/orm/workspace';
import {getSession} from '@/auth';

// ---- LOCAL IMPORTS ---- //
import {EventDetails} from '@/subapps/events/common/ui/components';

export default async function Page(props: {
  params: Promise<{slug: string; tenant: string; workspace: string}>;
}) {
  const params = await props.params;
  const {slug, tenant: tenantId} = params;

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) notFound();
  const {client, config} = tenant;

  const session = await getSession();
  const user = session?.user;

  const {workspaceURL} = workspacePathname(params);

  const workspace: any = await findWorkspace({
    user: session?.user,
    url: workspaceURL,
    client,
  }).then(clone);

  if (!workspace) {
    return notFound();
  }

  const eventDetails: any = await findEvent({
    slug,
    workspace,
    client,
    config,
    user,
  }).then(clone);

  if (!eventDetails) {
    return notFound();
  }

  return <EventDetails eventDetails={eventDetails} workspace={workspace} />;
}
