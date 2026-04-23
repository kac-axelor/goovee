'use server';

import {z} from 'zod';
import {generateOTP as coreGenerateOTP} from '@/otp/actions';
import {getTranslation} from '@/locale/server';
import {Scope} from '@/otp/constants';
import {findWorkspace} from '@/orm/workspace';
import {manager, type Tenant} from '@/tenant';
import {findInviteById} from '../../../../common/orm/register';
import {
  InviteEmailRegisterOTPSchema,
  type EmailInviteOTP,
} from '@/lib/core/auth/validation-utils';

function error(message: string) {
  return {
    error: true,
    message,
  };
}

export async function generateOTP(data: EmailInviteOTP) {
  const validation = InviteEmailRegisterOTPSchema.safeParse(data);

  if (!validation.success) {
    return error(z.prettifyError(validation.error));
  }

  const {inviteId, tenantId} = validation.data;

  const tenant = await manager.getTenant(tenantId);
  if (!tenant)
    return error(await getTranslation({tenant: tenantId}, 'Invalid tenant'));
  const {client} = tenant;

  const invite = await findInviteById({
    id: inviteId,
    client,
  });

  if (!(invite?.workspace && invite?.partner)) {
    return error(await getTranslation({tenant: tenantId}, 'Bad request'));
  }

  const workspace = await findWorkspace({
    url: invite.workspace.url,
    user: {
      id: invite.partner.id,
    } as any,
    client,
  });

  if (!workspace?.config) {
    return error(await getTranslation({tenant: tenantId}, 'Bad request'));
  }

  const emailAddress = invite?.emailAddress?.address;

  if (!emailAddress) {
    return error(await getTranslation({tenant: tenantId}, 'Email is required'));
  }

  if (!workspace.config.otpTemplateList?.length) {
    return coreGenerateOTP({
      email: emailAddress,
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
      email: emailAddress,
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
