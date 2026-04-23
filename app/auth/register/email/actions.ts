'use server';

import {z} from 'zod';
import {generateOTP as coreGenerateOTP} from '@/otp/actions';
import {getTranslation} from '@/locale/server';
import {Scope} from '@/otp/constants';
import {manager} from '@/tenant';
import {findDefaultPartnerWorkspaceConfig} from '@/orm/workspace';
import {
  EmailRegisterOTPSchema,
  type EmailRegisterOTP,
} from '@/lib/core/auth/validation-utils';

function error(message: string) {
  return {
    error: true,
    message,
  };
}

export async function generateOTP(data: EmailRegisterOTP) {
  const validation = EmailRegisterOTPSchema.safeParse(data);

  if (!validation.success) {
    return error(z.prettifyError(validation.error));
  }

  const {email, workspaceURL, tenantId} = validation.data;

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return error(await getTranslation({tenant: tenantId}, 'Invalid tenant'));
  }

  const {client} = tenant;

  let defaultPartnerWorkspaceConfig;
  if (workspaceURL) {
    defaultPartnerWorkspaceConfig = await findDefaultPartnerWorkspaceConfig({
      url: workspaceURL,
      client,
    });
  }

  const template =
    defaultPartnerWorkspaceConfig?.portalAppConfig?.otpTemplateList?.[0]
      ?.template;

  return coreGenerateOTP({
    email,
    scope: Scope.Registration,
    tenantId,
    client,
    mailConfig: template?.content
      ? {
          template: {
            subject: template.subject ?? undefined,
            content: template.content,
          },
        }
      : undefined,
  });
}
