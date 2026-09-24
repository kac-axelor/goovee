import 'server-only';

import {z} from 'zod';

import {currentWorkspace} from '@/url/current';
import {t} from '@/locale/server';
import {SUBAPP_CODES} from '@/constants';
import {toMinorUnits, resolveCurrency} from '@/payment/domain/money';
import {GATEWAY, PAYMENT_SOURCE} from '@/payment/domain/types';
import type {PaymentSourceHandler} from '@/payment/sources/types';
import {
  resolveInvoicePaymentAccess,
  validatePaymentData,
} from '@/subapps/invoices/common/utils/validations';

const InvoiceIntentSchema = z.object({
  invoiceId: z.string().min(1),
  /** The amount the payer chose, as a decimal string; checked against the invoice and the workspace's policy. */
  amount: z.string().min(1),
  token: z.string().optional(),
});

type InvoiceIntent = z.infer<typeof InvoiceIntentSchema>;

type InvoiceSnapshot = {
  invoiceId: string;
  token: string | null;
};

/**
 * Paying an invoice that already exists in the ERP. The subject is known from
 * the start and nothing goovee-local happens on capture; the ERP records the
 * invoice payment when it projects.
 */
export const invoicesPaymentSource: PaymentSourceHandler<InvoiceIntent> = {
  source: PAYMENT_SOURCE.invoices,

  intentSchema: InvoiceIntentSchema,

  /* Every gateway, the asynchronous ones included: an invoice payer can always
   * come back to the invoice — signed in, or through the invoice's own link —
   * and see a transfer that settled days later applied to it. */
  gateways: [
    GATEWAY.stripeCard,
    GATEWAY.stripeBankTransfer,
    GATEWAY.hubpisp,
    GATEWAY.paypal,
    GATEWAY.paybox,
    GATEWAY.up2pay,
  ],

  async prepare({intent, tenant}) {
    const scope = await currentWorkspace();
    if (!scope) {
      return {error: true, message: await t('Invalid workspace')};
    }

    const access = await resolveInvoicePaymentAccess({
      workspaceURL: scope.key(),
      tenantId: tenant.id,
      token: intent.token,
    });
    if (access.error) {
      return access;
    }
    const {config, user, invoiceFilter, workspaceURL} = access.data;

    const validated = await validatePaymentData({
      config,
      client: tenant.client,
      invoice: {id: intent.invoiceId},
      amount: intent.amount,
      invoiceFilter,
      workspaceURL,
      tenantId: tenant.id,
    });
    if (validated.error) {
      return validated;
    }
    const {$amount, $invoice, isPartialPayment} = validated.data;

    const payer = intent.token
      ? $invoice.partner?.emailAddress?.address
      : user?.email;
    if (!payer) {
      return {error: true, message: await t('Email is required for payment')};
    }

    const workspace = await tenant.client.aOSPortalWorkspace.findOne({
      where: {url: workspaceURL},
      select: {id: true, url: true},
    });
    if (!workspace?.url) {
      return {error: true, message: await t('Invalid workspace')};
    }

    const currency = await resolveCurrency(
      tenant.client,
      $invoice.currency?.code,
    );

    const snapshot: InvoiceSnapshot = {
      invoiceId: $invoice.id,
      token: intent.token ?? null,
    };

    return {
      success: true,
      data: {
        money: {
          amount: toMinorUnits($amount, currency.scale),
          currencyCode: currency.code,
          currencyScale: currency.scale,
        },
        payer,
        /* Says a part is paid when it is, so a completed payment of part of
         * the invoice never reads as the invoice paid. */
        subjectLabel: isPartialPayment
          ? await t(
              'Part payment of invoice {0}',
              String($invoice.invoiceId ?? $invoice.id),
            )
          : await t('Invoice {0}', String($invoice.invoiceId ?? $invoice.id)),
        paymentOptions: config.paymentOptionSet,
        billing: {
          firstName: $invoice.partner?.firstName ?? undefined,
          lastName: $invoice.partner?.name ?? undefined,
          addressLine1: $invoice.address?.addressl4 ?? undefined,
          zipCode: $invoice.address?.zip ?? undefined,
          city: $invoice.address?.city?.name ?? undefined,
          countryCode: $invoice.address?.country?.numericCode ?? undefined,
        },
        workspace: {id: workspace.id, url: workspace.url, configId: config.id},
        subject: {invoice: $invoice.id},
        snapshot,
      },
    };
  },

  async deliver() {
    return {delivered: true, subject: {}};
  },

  onwardLink({subject, snapshot}) {
    const invoiceId =
      subject.invoice ?? (snapshot as Partial<InvoiceSnapshot>).invoiceId;
    if (!invoiceId) {
      return null;
    }
    const token = (snapshot as Partial<InvoiceSnapshot>).token;
    return `/${SUBAPP_CODES.invoices}/${invoiceId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },
};
