'use server';

import {getSession} from '@/auth';
import {t} from '@/locale/server';
import {manager} from '@/tenant';
import {updatePreferences} from '@/orm/notification';
import {revalidatePath} from 'next/cache';

const error = (message: string) => {
  return {
    error: true,
    message,
  };
};

export async function updatePreference({
  workspaceURL,
  workspaceURI,
  code,
  data,
  tenant: tenantId,
}: {
  code: string;
  data?: {
    activateNotification?: boolean;
    record?: {
      id: string;
      activateNotification?: boolean;
    };
  };
  workspaceURL: string;
  workspaceURI: string;
  tenant: string;
}) {
  if (!(code && data && workspaceURL && tenantId)) {
    return error(await t('Code, url, tenant and payload is required'));
  }
  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return error(await t('Unauthorized'));
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return error(await t('Tenant not found'));
  }
  const {client} = tenant;

  try {
    const result = await updatePreferences({
      url: workspaceURL,
      code,
      user,
      client,
      ...data,
    });

    if (!result) {
      throw new Error();
    }

    revalidatePath(`${workspaceURI}/account/notifications`);

    return {
      success: true,
      message: await t('Preference updated'),
    };
  } catch (err) {
    return error(await t('Cannot update preference. Try again.'));
  }
}
