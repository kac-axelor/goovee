'use server';

import {z} from 'zod';
import {revalidatePath} from 'next/cache';

// ---- CORE IMPORTS ---- //
import {getSession} from '@/auth';
import {register} from '@/lib/core/auth/orm';
import {getTranslation} from '@/locale/server';
import {
  findDefaultPartnerWorkspaceConfig,
  findWorkspaces,
} from '@/orm/workspace';
import {Scope} from '@/otp/constants';
import {findOne, isValid, markUsed} from '@/otp/orm';
import {manager} from '@/tenant';
import {
  EmailRegisterSchema,
  SubscribeSchema,
  type EmailRegister,
  type Subscribe,
} from '@/lib/core/auth/validation-utils';

function error(message: string) {
  return {
    error: true,
    message,
  };
}

export async function subscribe(data: Subscribe) {
  const validation = SubscribeSchema.safeParse(data);

  if (!validation.success) {
    return error(z.prettifyError(validation.error));
  }

  const {workspace, tenantId} = validation.data;

  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return error(await getTranslation({tenant: tenantId}, 'Unauthorized'));
  }

  const url = workspace?.url;
  if (!url)
    return error(await getTranslation({tenant: tenantId}, 'Bad request'));

  const tenant = await manager.getTenant(tenantId);
  if (!tenant)
    return error(await getTranslation({tenant: tenantId}, 'Invalid tenant'));
  const {client} = tenant;

  const userWorkspaces = await findWorkspaces({url, user, client});

  const existing = userWorkspaces?.find(w => w.id === workspace?.id);

  if (existing) {
    return error(
      await getTranslation({tenant: tenantId}, 'Already subscribed'),
    );
  }

  const defaultPartnerWorkspaceConfig = await findDefaultPartnerWorkspaceConfig(
    {url, client},
  );

  if (!defaultPartnerWorkspaceConfig) {
    return error(
      await getTranslation(
        {tenant: tenantId},
        'Cannot subscribe, no default permissions available for the workspace',
      ),
    );
  }

  const $user = await client.aOSPartner.findOne({
    where: {
      id: user.id,
    },
    select: {
      isContact: true,
      mainPartner: {
        id: true,
      },
    },
  });

  if (!$user) {
    return error(await getTranslation({tenant: tenantId}, 'Bad request'));
  }

  if (!$user.isContact) {
    try {
      await client.aOSPartner.update({
        data: {
          id: $user.id,
          version: $user.version,
          partnerWorkspaceSet: {
            select: [
              {
                id: defaultPartnerWorkspaceConfig.id,
              },
            ],
          },
        },
        select: {id: true},
      });

      revalidatePath('/', 'layout');

      return {
        success: true,
        message: await getTranslation(
          {tenant: tenantId},
          'Successfully subscribed',
        ),
      };
    } catch (err) {}
  } else {
    const {mainPartner} = $user;

    if (!mainPartner?.id) {
      return error(
        await getTranslation(
          {tenant: tenantId},
          'Partner not available for the contact',
        ),
      );
    }
    const partnerWorkspaces = await findWorkspaces({
      url,
      user: {
        id: mainPartner.id!,
        isContact: false,
      } as any,
      client,
    });

    const existsInPartner = partnerWorkspaces.find((w: any) => w.url === url);

    if (!existsInPartner) {
      return error(
        await getTranslation(
          {tenant: tenantId},
          `Partner didn't have access to workspace, cannot subscribe`,
        ),
      );
    } else {
      try {
        await client.aOSPartner.update({
          data: {
            id: $user.id,
            version: $user.version,
            contactWorkspaceConfigSet: {
              create: [
                {
                  name: `${user.name}-${url}`,
                  portalWorkspace: {
                    select: {
                      id: workspace.id,
                    },
                  },
                },
              ],
            },
          },
          select: {id: true},
        });

        revalidatePath('/', 'layout');

        return {
          success: true,
          message: await getTranslation(
            {tenant: tenantId},
            'Successfully subscribed',
          ),
        };
      } catch (err) {
        console.log(err);
      }
    }
  }

  return error(
    await getTranslation({tenant: tenantId}, 'Error subscribing, try again'),
  );
}

export async function registerByEmail(data: EmailRegister) {
  const validation = EmailRegisterSchema.safeParse(data);

  if (!validation.success) {
    return error(z.prettifyError(validation.error));
  }

  const {
    email,
    tenantId,
    otp,
    type,
    name,
    password,
    workspaceURL,
    firstName,
    companyName,
    identificationNumber,
    companyNumber,
    locale,
  } = validation.data;

  const tenant = await manager.getTenant(tenantId);
  if (!tenant)
    return error(await getTranslation({tenant: tenantId}, 'Invalid tenant'));
  const {client, config} = tenant;

  const otpResult = await findOne({
    scope: Scope.Registration,
    entity: email,
    client,
  });

  if (!otpResult) {
    return error(await getTranslation({tenant: tenantId}, 'Invalid OTP'));
  }

  if (!(await isValid({id: otpResult.id, value: otp, client}))) {
    return error(await getTranslation({tenant: tenantId}, 'Invalid OTP'));
  }

  await markUsed({id: otpResult.id, client});

  return register({
    email,
    tenantId,
    type,
    name,
    password,
    workspaceURL,
    firstName,
    companyName,
    identificationNumber,
    companyNumber,
    locale,
    client,
    config,
  });
}
