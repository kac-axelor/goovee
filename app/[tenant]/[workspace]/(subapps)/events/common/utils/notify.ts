import 'server-only';

// ---- CORE IMPORTS ---- //
import {SUBAPP_CODES} from '@/constants';
import {DEFAULT_LOCALE} from '@/locale/contants';
import {getTranslation} from '@/locale/server';
import {notifyAll} from '@/pwa/utils';
import {NotificationTag} from '@/pwa/tags';
import type {Tenant} from '@/tenant';
import {tenantURLs} from '@/url/scope';

// ---- LOCAL IMPORTS ---- //
import {
  findRegistrationNotice,
  type RegistrationNotice,
} from '../orm/registration';
import {sendRegistrationMail} from './mail';

/** Whoever made the registration, told nothing by push for having just done it. Null for a guest. */
export type Registrant = {id?: string; email?: string} | null;

type NoticeContact = NonNullable<
  NonNullable<RegistrationNotice['participantList']>[number]['contact']
>;

function isRegistrant(contact: NoticeContact, registrant: Registrant) {
  if (!registrant) return false;
  if (registrant.id && contact.id === registrant.id) return true;
  return Boolean(
    registrant.email && contact.emailAddress?.address === registrant.email,
  );
}

/**
 * What a registration tells its participants: a push to each one with a
 * portal account, other than whoever registered, and the registration mail
 * with its invite to every one of them. The same for a free registration and
 * a paid one, and it leans on no request, so a paid registration's
 * confirmation job can send it from the job clock.
 *
 * The mail goes first. With `requireMail`, a registration none of whose mails
 * could be sent throws before anything is pushed, so the caller's retry sends
 * the push once, with the mail, rather than once per attempt.
 */
export async function announceRegistration({
  registrationId,
  registrant,
  tenant,
  workspaceURL,
  requireMail = false,
}: {
  registrationId: string;
  registrant: Registrant;
  tenant: Tenant;
  workspaceURL: string;
  /** Throw, and push nothing, when every participant's mail failed. */
  requireMail?: boolean;
}): Promise<void> {
  const notice = await findRegistrationNotice({
    id: registrationId,
    client: tenant.client,
  });
  const event = notice?.event;
  if (!notice || !event) {
    console.error(
      `[MAIL] Registration ${registrationId} or its event was not found.`,
    );
    return;
  }
  const eventPath = `/${SUBAPP_CODES.events}/${event.slug}` as const;

  const {sent, failed} = await sendRegistrationMail({
    notice,
    eventLink: tenantURLs(tenant.id)
      .workspaceByKey(workspaceURL)
      .forExternal(eventPath),
    config: tenant.config,
  });
  if (requireMail && failed && !sent) {
    throw new Error(
      `None of the ${failed} registration mails for registration ${registrationId} could be sent`,
    );
  }

  const recipients = (notice.participantList ?? []).flatMap(participant =>
    participant.contact?.isActivatedOnPortal &&
    !isRegistrant(participant.contact, registrant)
      ? [participant.contact]
      : [],
  );

  await notifyAll(recipients, async contact => {
    const translate = getTranslation.bind(null, {
      locale: contact.localization?.code || DEFAULT_LOCALE,
      tenant: tenant.id,
    });

    return {
      userId: contact.id,
      tenantId: tenant.id,
      workspaceURL,
      client: tenant.client,
      payload: {
        title: await translate('You have been registered for an event!'),
        body: `${event.eventTitle}`,
        link: eventPath,
        tag: NotificationTag.event(event.id),
      },
    };
  });
}
