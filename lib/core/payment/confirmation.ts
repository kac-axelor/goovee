import 'server-only';

import {DEFAULT_LOCALE} from '@/locale/contants';
import {getTranslation} from '@/locale/server';
import NotificationManager, {NotificationType} from '@/notification';
import {findGooveeUserByEmail} from '@/orm/partner';
import type {Tenant} from '@/tenant';
import {escapeHtml} from '@/utils/template-string';
import {fromMinorUnits} from './domain/money';
import type {NotifiedPayment} from './sources/types';

/*
 * What a payment's confirmation is made of. It is sent from the job clock as
 * often as from a request, so nothing here leans on the request: every text
 * is translated for a named locale and tenant, and every address is built
 * from the payment's own workspace.
 */

/** Translates for one reader, without a request to read their language from. */
export type Translator = (key: string, ...values: string[]) => Promise<string>;

export function translatorFor({
  tenant,
  locale,
}: {
  tenant: Tenant;
  locale: string | null | undefined;
}): Translator {
  return (key, ...values) =>
    getTranslation(
      {locale: locale || DEFAULT_LOCALE, tenant: tenant.id},
      key,
      ...values,
    );
}

/** The payer's own language where they have a portal account, the default otherwise. */
export async function payerLocale(
  tenant: Tenant,
  payer: string | null,
): Promise<string> {
  if (!payer) {
    return DEFAULT_LOCALE;
  }
  const user = await findGooveeUserByEmail(payer, tenant.client);
  return user?.localization?.code || DEFAULT_LOCALE;
}

/** "106.80 EUR": the amount as the ledger holds it, the same in every language. */
export function formatAmount(payment: NotifiedPayment): string {
  return `${fromMinorUnits(payment.money.amount, payment.money.currencyScale)} ${payment.money.currencyCode}`;
}

/**
 * The confirmation mail a source without one of its own sends: what was paid
 * for, how much, the payment's reference and where to see it. Self-contained,
 * because for a payer without an account it is the only way back.
 */
export async function sendPaymentConfirmation({
  tenant,
  payment,
  title,
  link,
  translate,
}: {
  tenant: Tenant;
  payment: NotifiedPayment;
  /** Already translated: the mail's subject and heading. */
  title: string;
  /** Absolute; where the payer sees what they paid for. Omitted when there is nowhere to send them. */
  link: string | null;
  translate: Translator;
}): Promise<void> {
  if (!payment.payer) {
    console.warn(
      `[PAYMENT][NOTIFY] payment ${payment.reference} names no payer; no confirmation sent`,
    );
    return;
  }
  const mailService = NotificationManager.getService(
    NotificationType.mail,
    tenant.config,
  );
  if (!mailService) {
    console.error(
      `[PAYMENT][NOTIFY] mail is not configured for tenant "${tenant.id}"; payment ${payment.reference} was not confirmed`,
    );
    return;
  }

  const rows: Array<[string, string]> = [
    [await translate('Amount'), formatAmount(payment)],
    [await translate('Payment reference'), payment.reference],
  ];
  const linkLabel = await translate('View details');

  const body = [
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>`,
    payment.subjectLabel
      ? `<p style="margin:0 0 16px">${escapeHtml(payment.subjectLabel)}</p>`
      : '',
    '<table style="border-collapse:collapse;margin:0 0 20px">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#555">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:bold">${escapeHtml(value)}</td></tr>`,
    ),
    '</table>',
    link
      ? `<p><a href="${escapeHtml(link)}" style="background:#5603ad;color:#fff;padding:12px 20px;border-radius:5px;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(linkLabel)}</a></p>`
      : '',
  ].join('');

  const text = [
    title,
    payment.subjectLabel ?? '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    link ? `${linkLabel}: ${link}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await mailService.notify({
    to: payment.payer,
    subject: title,
    text,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#333;background:#f9f9f9;padding:20px"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">${body}</div></body></html>`,
  });
}
