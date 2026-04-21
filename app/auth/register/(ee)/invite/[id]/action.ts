'use server';

import {revalidatePath} from 'next/cache';

import {deleteInviteById} from '@/app/[tenant]/[workspace]/account/common/orm/invites';
import {getSession} from '@/auth';
import {registerByInvite, type RegisterInviteDTO} from '@/lib/core/auth/orm';
import {t} from '@/locale/server';
import {findPartnerByEmail, updatePartner} from '@/orm/partner';
import {Scope} from '@/otp/constants';
import {findOne, isValid, markUsed} from '@/otp/orm';
import {manager, Tenant} from '@/tenant';
import {PortalWorkspace} from '@/orm/workspace';

import {findInviteById} from '../../../common/orm/register';

function error(message: string) {
  return {
    error: true,
    message,
  };
}

export async function registerByEmail(
  data: Omit<RegisterInviteDTO, 'client' | 'config'>,
) {
  const {email, password, otp, tenantId} = data;

  if (!tenantId) {
    return error(await t('TenantId is required'));
  }

  if (!(email && password)) {
    return error(await t('Bad request'));
  }

  if (password.length < 8) {
    return error(await t('Password must be at least 8 characters'));
  }

  if (!otp) {
    return error(await t('OTP is required.'));
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return error(await t('Invalid tenant'));
  const {client, config} = tenant;

  const otpResult = await findOne({
    scope: Scope.Registration,
    entity: email,
    client,
  });

  if (!otpResult) {
    return error(await t('Invalid OTP'));
  }

  if (!(await isValid({id: otpResult.id, value: otp, client}))) {
    return error(await t('Invalid OTP'));
  }

  await markUsed({id: otpResult.id, client});

  return registerByInvite({...data, client, config});
}

export async function subscribe({
  workspaceURL,
  tenantId,
  inviteId,
}: {
  workspaceURL: PortalWorkspace['url'];
  tenantId?: Tenant['id'] | null;
  inviteId: string;
}) {
  if (!(workspaceURL && inviteId && tenantId)) {
    return error(await t('Bad request'));
  }

  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return error(await t('Unauthorized'));
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return error(await t('Invalid tenant'));
  const {client} = tenant;

  const invite = await findInviteById({id: inviteId, client});

  if (
    !(
      invite &&
      invite.partner &&
      invite.partner.id &&
      invite.emailAddress?.address === user.email &&
      invite.workspace &&
      invite.workspace.url === workspaceURL
    )
  ) {
    return error(await t('Bad request'));
  }

  const contactConfig = invite?.contactAppPermissionList?.[0];

  if (!contactConfig) {
    return error(await t('Bad request'));
  }

  const $user = await findPartnerByEmail(user.email, client, {
    where: {
      isContact: {
        eq: true,
      },
    },
  });

  if (!$user) {
    return error(await t('User not found'));
  }

  const data = {
    id: $user?.id,
    version: $user.version,
    contactWorkspaceConfigSet: {select: [{id: contactConfig.id}]},
  } as any;

  try {
    await updatePartner({
      data,
      client,
    });

    revalidatePath('/', 'layout');
  } catch (err) {
    return error(await t('Error subscribing, try again'));
  }

  deleteInviteById({
    id: invite.id,
    client,
  }).catch(err => {
    console.error(err);
  });

  return {
    success: true,
    message: await t('Subscribed successfully.'),
  };
}
