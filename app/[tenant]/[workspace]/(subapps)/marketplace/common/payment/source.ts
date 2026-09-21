import 'server-only';

import {z} from 'zod';

import {ensureAccess} from '@/access/ensure-access';
import {accessMessage} from '@/access/denial';
import {SUBAPP_CODES} from '@/constants';
import {t} from '@/locale/server';
import {findGooveeUserByEmail} from '@/orm/partner';
import {resolveCurrency, toMinorUnits} from '@/payment/domain/money';
import {PAYMENT_SOURCE} from '@/payment/domain/types';
import type {PaymentSourceHandler} from '@/payment/sources/types';
import {getPartnerId} from '@/utils';

import {findPartnerInvoicingAddresses, recordOrder} from '../orm';
import {getMarketplaceConfig} from '../orm/config';
import {
  CartProductIdsSchema,
  recheckCartAvailability,
  validateCart,
  type ValidatedCart,
} from '../utils/cart';

const MarketplaceIntentSchema = z.object({
  productIds: CartProductIdsSchema,
});

type MarketplaceIntent = z.infer<typeof MarketplaceIntentSchema>;

/* The cart as the server priced it at the button press. Delivery honours these
 * prices: pricing inputs may have moved since, and refusing money already
 * captured over server-side drift is worse than honouring what the buyer saw. */
type MarketplaceSnapshot = {
  cart: ValidatedCart;
  mainPartnerId: string;
  ordererId: string;
  companyId: string | null;
};

/**
 * Buying marketplace products. Nothing exists in the ERP before the capture:
 * delivery records the order and its lines, which is what grants the buyer
 * access, and the ERP builds the sale order and invoice from those rows when
 * it projects.
 */
export const marketplacePaymentSource: PaymentSourceHandler<MarketplaceIntent> =
  {
    source: PAYMENT_SOURCE.marketplace,

    intentSchema: MarketplaceIntentSchema,

    requiresPaymentMode: true,

    async prepare({intent}) {
      const access = await ensureAccess({code: SUBAPP_CODES.marketplace});
      if (!access.ok) {
        return {error: true, message: await accessMessage(access.reason)};
      }
      const {client} = access.tenant;

      const config = await getMarketplaceConfig(
        access.workspace.config.id,
        client,
      );
      if (!config) {
        return {error: true, message: await t('Invalid workspace')};
      }
      if (!config.allowOnlinePaymentForEcommerce) {
        return {
          error: true,
          message: await t('Online payment is not available.'),
        };
      }
      if (!config.paymentOptionSet?.length) {
        return {
          error: true,
          message: await t('Payment options are not configured.'),
        };
      }

      const mainPartnerId = getPartnerId(access.user);
      const cartResult = await validateCart({
        client,
        workspace: access.workspace,
        config,
        mainPartnerId,
        productIds: intent.productIds,
      });
      if (cartResult.error) {
        return cartResult;
      }
      const cart = cartResult.data;

      const buyer = await findGooveeUserByEmail(access.user.email, client);
      const payer = buyer?.emailAddress?.address;
      if (!payer) {
        return {
          error: true,
          message: await t('Buyer email could not be resolved.'),
        };
      }

      const currency = await resolveCurrency(client, cart.currencyCodeISO);
      const snapshot: MarketplaceSnapshot = {
        cart,
        mainPartnerId,
        ordererId: access.user.id,
        companyId: config.company?.id ?? null,
      };

      return {
        success: true,
        data: {
          money: {
            amount: toMinorUnits(cart.total, currency.scale),
            currencyCode: currency.code,
            currencyScale: currency.scale,
          },
          payer,
          subjectLabel: await t('Cart: {0} item(s)', String(cart.items.length)),
          paymentOptions: config.paymentOptionSet,
          workspace: {
            id: access.workspace.id,
            url: access.workspace.url,
            configId: access.workspace.config.id,
          },
          subject: {},
          snapshot,
        },
      };
    },

    async deliver({payment, snapshot, txClient}) {
      const {cart, mainPartnerId, ordererId, companyId} =
        snapshot as Partial<MarketplaceSnapshot>;
      if (!cart?.items?.length || !mainPartnerId || !ordererId) {
        return {
          delivered: false,
          reason: 'The purchase snapshot names no cart or no buyer',
        };
      }

      /* Between the button press and the capture the buyer may have bought the
       * same product in another tab, or the publisher may have withdrawn it.
       * Money captured for a cart that can no longer be granted is a human's
       * to decide. */
      const recheck = await recheckCartAvailability({
        client: txClient,
        workspace: {id: payment.workspaceId},
        mainPartnerId,
        productIds: cart.items.map(item => item.productId),
      });
      if (recheck.error) {
        return {delivered: false, reason: recheck.message};
      }

      const buyer = await findPartnerInvoicingAddresses({
        client: txClient,
        mainPartnerId,
      });
      const invoicingAddress =
        buyer?.partnerAddressList?.find(entry => entry.isDefaultAddr) ??
        buyer?.partnerAddressList?.[0];

      const orderId = await recordOrder({
        client: txClient,
        ordererId,
        ownerId: mainPartnerId,
        items: cart.items.map(item => ({
          productId: item.productId,
          priceWt: item.priceWt,
          priceAti: item.priceAti,
          taxRate: item.taxRate,
        })),
        currencyCodeISO: cart.currencyCodeISO,
        paidAmount: cart.total,
        companyId: companyId ?? null,
        paymentModeId: payment.paymentModeId,
        invoicingAddress: invoicingAddress?.address ?? null,
        paymentContextId: null,
      });

      return {delivered: true, subject: {marketplaceProductOrder: orderId}};
    },

    onwardLink({subject}) {
      const orderId = subject.marketplaceProductOrder;
      if (!orderId) {
        return `/${SUBAPP_CODES.marketplace}/cart`;
      }
      return `/${SUBAPP_CODES.marketplace}/cart/checkout/success?orderId=${encodeURIComponent(orderId)}`;
    },
  };
