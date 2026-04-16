// ---- CORE IMPORTS ---- //
import {SUBAPP_CODES} from '@/constants';
import {getSession} from '@/lib/core/auth';
import {and} from '@/utils/orm';
import type {AOSPartner} from '@/goovee/.generated/models';
import {getPartnerId} from '@/utils';
import type {Client} from '@/goovee/.generated/client';

// ---- LOCAL IMPORTS ---- //
import {
  validate,
  withSubapp,
  withWorkspace,
} from '@/subapps/events/common/actions/validation';

export async function findContacts({
  search = '',
  workspaceURL,
  client,
}: {
  search?: string;
  workspaceURL: string;
  client: Client;
}) {
  const response = await validate([
    withWorkspace(workspaceURL, client, {checkAuth: false}),
    withSubapp(SUBAPP_CODES.events, workspaceURL, client),
  ]);

  if (response.error) {
    return response;
  }

  const session = await getSession();
  const user = session?.user;
  if (!user) {
    return null;
  }

  const partnerId = getPartnerId(user);

  const whereClause = and<AOSPartner>([
    {
      isContact: true,
      isActivatedOnPortal: true,
      mainPartner: {id: partnerId},
      contactWorkspaceConfigSet: {portalWorkspace: {url: workspaceURL}},
    },
    search && {simpleFullName: {like: `%${search.toLowerCase()}%`}},
    {OR: [{archived: false}, {archived: null}]},
  ]);

  const result = await client.aOSPartner.find({
    where: whereClause,
    select: {
      id: true,
      name: true,
      firstName: true,
      simpleFullName: true,
      emailAddress: {address: true},
      fixedPhone: true,
      mainPartner: {id: true, simpleFullName: true},
    },
  });

  return result;
}
