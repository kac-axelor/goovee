import {SUBAPP_CODES} from '@/constants';
import type {Client} from '@/goovee/.generated/client';
import type {ID} from '@/types';
import type {Maybe} from '@/types/util';

export async function getMailRecipients({
  contacts,
  workspaceURL,
  client,
}: {
  contacts: Array<{id: Maybe<ID>}>;
  workspaceURL: string;
  client: Client;
}): Promise<NotificationPartner[]> {
  const reciepients = await Promise.all(
    contacts.map(
      contact =>
        contact.id &&
        findPartnerNotificationEmail({id: contact.id, workspaceURL, client}),
    ),
  );

  return reciepients.filter(Boolean) as NotificationPartner[];
}

export type NotificationPartner = NonNullable<
  Awaited<ReturnType<typeof findPartnerNotificationEmail>>
>;

export async function findPartnerNotificationEmail({
  id,
  workspaceURL,
  client,
}: {
  id: ID;
  workspaceURL: string;
  client: Client;
}) {
  const partner = await client.aOSPartner.findOne({
    where: {
      id,
      portalUserPreferenceList: {
        app: {code: SUBAPP_CODES.ticketing},
        workspace: {url: workspaceURL},
        activateNotification: true,
      },
      emailAddress: {address: {ne: null}},
    },
    select: {emailAddress: {address: true}, localization: {code: true}},
  });

  return partner;
}
