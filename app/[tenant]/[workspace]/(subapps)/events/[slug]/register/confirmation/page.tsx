import {notFound} from 'next/navigation';

// ---- CORE IMPORTS ---- //
import {getSession} from '@/auth';
import {findWorkspace} from '@/orm/workspace';
import {clone} from '@/utils';
import {workspacePathname} from '@/utils/workspace';
import {manager} from '@/tenant';

// ---- LOCAL IMPORTS ---- //
import Content from './content';
import {findEvent} from '@/subapps/events/common/orm/event';
import {isLoginNeededForRegistration} from '@/subapps/events/common/utils';

export default async function Page(props: {
  params: Promise<{slug: string; tenant: string; workspace: string}>;
}) {
  const params = await props.params;
  const {slug, tenant: tenantId} = params;

  const session = await getSession();
  const user: any = session?.user;

  const {workspaceURL} = workspacePathname(params);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return notFound();
  const {client, config} = tenant;

  const workspace: any = await findWorkspace({
    user: session?.user,
    url: workspaceURL,
    client,
  }).then(clone);

  if (!workspace) {
    return notFound();
  }

  const eventDetails = await findEvent({
    slug,
    workspace,
    client,
    config,
    user,
  }).then(clone);

  if (!eventDetails) {
    return notFound();
  }

  const allowGuestEventRegistration =
    workspace.config?.allowGuestEventRegistration;
  const eventAllowRegistration = eventDetails?.eventAllowRegistration;

  const allowGuests =
    allowGuestEventRegistration && !isLoginNeededForRegistration(eventDetails);

  const isRegistrationAllow = eventAllowRegistration && (user || allowGuests);
  if (!isRegistrationAllow) {
    return notFound();
  }

  return <Content event={eventDetails} />;
}
