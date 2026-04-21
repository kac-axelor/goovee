'use server';

import {generateOTP as coreGenerateOTP} from '@/otp/actions';
import {t} from '@/locale/server';
import {Scope} from '@/otp/constants';
import {manager, type Tenant} from '@/tenant';
import {findDefaultPartnerWorkspaceConfig} from '@/orm/workspace';

function error(message: string) {
  return {
    error: true,
    message,
  };
}

export async function generateOTP({
  email,
  workspaceURL,
  tenantId,
}: {
  email: string;
  workspaceURL?: string;
  tenantId: Tenant['id'];
}) {
  if (!(email && tenantId)) {
    return error(await t('Email, Scope and Tenant is required'));
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return error(await t('Invalid tenant'));
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
