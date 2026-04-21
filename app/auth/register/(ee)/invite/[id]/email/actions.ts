'use server';

import {generateOTP as coreGenerateOTP} from '@/otp/actions';
import {t} from '@/locale/server';
import {Scope} from '@/otp/constants';
import {findWorkspace} from '@/orm/workspace';
import {manager, type Tenant} from '@/tenant';
import {findInviteById} from '../../../../common/orm/register';

function error(message: string) {
  return {
    error: true,
    message,
  };
}

export async function generateOTP({
  inviteId,
  tenantId,
}: {
  inviteId: string;
  tenantId: Tenant['id'];
}) {
  if (!(inviteId && tenantId)) {
    return error(await t('Invitation and Tenant is required'));
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return error(await t('Invalid tenant'));
  const {client} = tenant;

  const invite = await findInviteById({
    id: inviteId,
    client,
  });

  if (!(invite?.workspace && invite?.partner)) {
    return error(await t('Bad request'));
  }

  const workspace = await findWorkspace({
    url: invite.workspace.url,
    user: {
      id: invite.partner.id,
    } as any,
    client,
  });

  if (!workspace?.config) {
    return error(await t('Bad request'));
  }

  const email = invite?.emailAddress?.address;

  if (!email) {
    return error(await t('Email is required'));
  }

  if (!workspace.config.otpTemplateList?.length) {
    return coreGenerateOTP({
      email,
      scope: Scope.Registration,
      tenantId,
      client,
    });
  } else {
    const {otpTemplateList} = workspace.config;
    const localization = invite.partner?.localization?.code;

    let template =
      localization &&
      otpTemplateList.find((t: any) => t?.localization?.code === localization);

    if (!template) {
      template = otpTemplateList?.[0];
    }

    return coreGenerateOTP({
      email,
      scope: Scope.Registration,
      tenantId,
      client,
      mailConfig: template?.template?.content
        ? {
            template: {
              subject: template.template.subject ?? undefined,
              content: template.template.content,
            },
          }
        : undefined,
    });
  }
}
