'use server';

import {z} from 'zod';
import {hash} from '@/auth/utils';
import {getTranslation} from '@/locale/server';
import {create as createOTP, findOne, isValid} from '@/otp/orm';
import {Scope} from '@/otp/constants';
import {findGooveeUserByEmail} from '@/orm/partner';
import NotificationManager, {NotificationType} from '@/notification';
import {manager, type Tenant} from '@/tenant';
import {withMattermostSync} from '@/lib/core/mattermost';
import {RESET_PASSWORD} from '@/constants';
import {
  RequestResetPasswordSchema,
  ResetPasswordSchema,
  type RequestResetPassword,
  type ResetPassword,
} from '@/lib/core/auth/validation-utils';

function error(message: string) {
  return {
    error: true,
    message,
  };
}

const resetPasswordTemplate = ({
  email,
  otp,
  link,
}: {
  email: string;
  otp: string;
  link: string;
  subject?: string;
}) => ({
  subject: 'Goovee Password Reset',
  to: email,
  html: otpTemplateHTML({otp, email, link}),
});

const otpTemplateHTML = ({
  otp,
  email,
  link,
}: {
  otp: string;
  email: string;
  link: string;
}) => `
      <!DOCTYPE html>
      <html>
      <head>
          <title>Goovee Password Reset</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  line-height: 1.6;
                  background-color: #f9f9f9;
                  margin: 0;
                  padding: 20px;
              }
              .container {
                  text-align: center;
                  max-width: 600px;
                  margin: 0 auto;
                  background: #ffffff;
                  padding: 20px;
                  border-radius: 8px;
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
              }
              .header {
                  margin-bottom: 20px;
              }
              .button {
                  display: inline-block;
                  margin: 20px 0;
                  padding: 12px 20px;
                  background-color: #58d59d;
                  color: #ffffff !important;
                  text-decoration: none;
                  border-radius: 5px;
                  font-size: 16px;
              }
              .footer {
                  font-size: 14px;
                  color: #666666;
                  margin-top: 20px;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>Goovee Password Reset</h1>
              </div>
              <p>Dear User, We've received a request to reset the password for your account associated with ${email}. If you requested this change, please follow the instructions below:</p>
              <p>To reset your password, click the link : <a href='${link}' target='_blank'>${link}</a></p>
              <p>Your OTP for password reset is : <strong>${otp}</strong></p>
              <p>This link will expire in 10 minutes, so be sure to reset your password before then.</p>
              <p>If you did not request this change or believe this is a mistake, please ignore this email. Your account remains secure, and no changes will be made.</p>
              <div class="footer">
                  <p>Best regards,<br>The Goovee Team</p>
              </div>
          </div>
      </body>
      </html>
      `;

export async function requestResetPassword(data: RequestResetPassword) {
  const validation = RequestResetPasswordSchema.safeParse(data);

  if (!validation.success) {
    return error(z.prettifyError(validation.error));
  }

  const {email, tenantId, searchQuery} = validation.data;

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return error(await getTranslation({tenant: tenantId}, 'Invalid tenant'));
  }
  const {client} = tenant;

  const user = await findGooveeUserByEmail(email, client);

  const link = `${process.env.GOOVEE_PUBLIC_HOST}/auth/reset-password/${email}?${searchQuery}`;

  if (user) {
    const mailService = NotificationManager.getService(NotificationType.mail);
    createOTP({
      entity: email,
      scope: Scope.ResetPassword,
      client,
      force: true,
    }).then(result => {
      result?.otp &&
        mailService?.notify(
          resetPasswordTemplate({
            email,
            otp: result.otp,
            link,
          }),
        );
    });
  }

  return {
    success: true,
    data: {url: link},
  };
}

export async function resetPassword(data: ResetPassword) {
  /* Validate all input at entry point */
  const validation = ResetPasswordSchema.safeParse(data);

  if (!validation.success) {
    return error(z.prettifyError(validation.error));
  }

  const {email, otp, password, tenantId} = validation.data;

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return error(
      await getTranslation(
        {tenant: tenantId},
        'Error resetting password. Try again.',
      ),
    );
  }
  const {client, config} = tenant;

  const user = await findGooveeUserByEmail(email, client);

  if (!user) {
    return error(
      await getTranslation({tenant: tenantId}, 'You are not registered'),
    );
  }

  try {
    const result: any = await findOne({
      scope: Scope.ResetPassword,
      entity: email,
      client,
    });

    if (!result) {
      return error(await getTranslation({tenant: tenantId}, 'Bad request'));
    }

    const isValidOTP = await isValid({id: result.id, value: otp, client});

    if (!isValidOTP) {
      return error(await getTranslation({tenant: tenantId}, 'Invalid OTP'));
    }

    const hashedPassword = await hash(password);

    try {
      await withMattermostSync({
        config,
        email: user.emailAddress?.address || email,
        password,
        name: user.name || 'user',
        firstName: user.firstName || 'user',
        context: RESET_PASSWORD,
      });
    } catch (err: any) {
      return {
        message: await getTranslation(
          {tenant: tenantId},
          'Error resetting password. Try again.',
        ),
        success: false,
      };
    }

    await client.$transaction(async txClient => {
      const updatePartnerResult = await txClient.aOSPartner.update({
        data: {
          id: String(user.id),
          version: user.version,
          password: hashedPassword,
        },
        select: {id: true},
      });

      const markOtpResult = await txClient.otp.update({
        data: {
          id: result.id,
          version: result.version,
          used: true,
        },
        select: {id: true},
      });
    });

    return {
      success: true,
      message: await getTranslation(
        {tenant: tenantId},
        'Password reset successfully.',
      ),
    };
  } catch (err: any) {
    console.error('[RESET_PASSWORD] ERROR caught:', {
      message: err?.message,
      stack: err?.sstack,
      name: err?.name,
      cause: err?.cause,
    });
    return error(
      await getTranslation(
        {tenant: tenantId},
        'Error resetting password. Try again.',
      ),
    );
  }
}
