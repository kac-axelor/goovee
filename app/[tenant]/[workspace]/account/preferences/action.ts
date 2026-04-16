'use server';

import {headers} from 'next/headers';

// ---- CORE IMPORTS ---- //
import {t} from '@/locale/server';
import {getSession} from '@/auth';
import {TENANT_HEADER} from '@/proxy';
import {manager} from '@/tenant';
import {findContactWorkspaces, findPartnerWorkspaces} from '@/orm/workspace';

// ---- CORE IMPORTS ---- //
import {findLocalizations} from '@/orm/localizations';
import {findGooveeUserByEmail, updatePartner} from '@/orm/partner';

function error(message: string) {
  return {
    error: true,
    message,
  };
}

export async function updatePreference({
  defaultWorkspace,
  localization,
}: {
  defaultWorkspace?: string;
  localization?: string;
}) {
  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!tenantId) {
    return error(await 'Bad request');
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return error(await t('Tenant not found'));
  }
  const {client} = tenant;

  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return error(await t('Unauthorized'));
  }

  try {
    const partner = await findGooveeUserByEmail(user.email, client);

    if (!partner) {
      return error(await t('Invalid partner'));
    }

    const availableLocalizations = await findLocalizations({
      client,
    });

    if (localization && availableLocalizations?.length) {
      const isValidLocalization = availableLocalizations.find(
        l => Number(l.id) === Number(localization),
      );

      if (!isValidLocalization) {
        return error(await t('Invalid localization'));
      }
    }

    let partnerWorkspace: any;

    if (defaultWorkspace) {
      partnerWorkspace = partner?.partnerWorkspaceSet?.find(
        (ws: any) =>
          ws?.workspace?.id &&
          Number(ws.workspace.id) === Number(defaultWorkspace),
      );

      if (!partnerWorkspace) {
        return error(await t('Invalid default workspace'));
      }
    }

    const updatedPartner = await updatePartner({
      data: {
        id: partner.id,
        version: partner.version,
        defaultWorkspace: defaultWorkspace
          ? {select: {id: partnerWorkspace?.id}}
          : null,
        localization: localization ? {select: {id: localization}} : null,
      },
      client,
    });

    if (!updatedPartner?.id) {
      return error(await t('Error updating preferences. Try again.'));
    }

    return {
      success: true,
      data: updatedPartner,
    };
  } catch (err) {
    return error(await t('Error updating preferences. Try again.'));
  }
}

export async function fetchPreference() {
  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!tenantId) {
    return error(await 'Bad request');
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return error(await t('Tenant not found'));
  }
  const {client} = tenant;

  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return error(await t('Unauthorized'));
  }

  try {
    const partner = await findGooveeUserByEmail(user.email, client);

    return {
      success: true,
      data: {
        defaultWorkspace: partner?.defaultWorkspace?.workspace?.id,
        localization: partner?.localization?.id,
      },
    };
  } catch (err) {
    return error(await t('Error getting workspaces. Try again.'));
  }
}

export async function fetchWorkspaces() {
  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!tenantId) {
    return error(await 'Bad request');
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return error(await t('Tenant not found'));
  }
  const {client} = tenant;

  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return error(await t('Unauthorized'));
  }

  try {
    const workspaces = user.isContact
      ? await findContactWorkspaces({
          contactId: user.id,
          partnerId: user.mainPartnerId!,
          client,
        })
      : await findPartnerWorkspaces({
          partnerId: user.id,
          client,
        });

    return {
      success: true,
      data: workspaces,
    };
  } catch (err) {
    return error(await t('Error getting workspaces. Try again.'));
  }
}

export async function fetchLocalizations() {
  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!tenantId) {
    return error(await 'Bad request');
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return error(await t('Tenant not found'));
  }
  const {client} = tenant;

  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return error(await t('Unauthorized'));
  }

  try {
    const localizations = await findLocalizations({
      client,
    });
    return {
      success: true,
      data: localizations,
    };
  } catch (err) {
    return error(await t('Error getting localizations. Try again.'));
  }
}
