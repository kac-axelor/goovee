'use client';

import {useRef, useState} from 'react';
import {
  PayPalOneTimePaymentButton,
  PayPalProvider,
} from '@paypal/react-paypal-js/sdk-v6';

// ---- CORE IMPORTS ---- //
import {i18n, l10n} from '@/locale';
import {transformLocale} from '@/locale/utils';
import {Button, Portal, Spinner} from '@/ui/components';
import {useToast} from '@/ui/hooks';
import {useEnvironment} from '@/environment';
import {
  GATEWAY,
  type Gateway,
  type PaymentSource,
} from '@/payment/domain/types';
import {startPaymentAction} from '@/payment/actions';
import type {OfferedGateway} from '@/payment/offer';
import type {StartResult} from '@/payment/start';
import styles from './payment-methods.module.scss';

type GatewayPresentation = {
  /** Written as literal calls so the keys stay visible to the extractor. */
  label: (option?: string) => string;
  className: string;
};

const PRESENTATION: Record<Gateway, GatewayPresentation> = {
  [GATEWAY.stripeCard]: {
    label: () => i18n.t('Pay by card'),
    className: 'bg-[#635bff] hover:bg-[#5851e0]',
  },
  [GATEWAY.stripeBankTransfer]: {
    label: () => i18n.t('Pay by bank transfer'),
    className: 'bg-[#635bff]',
  },
  [GATEWAY.paypal]: {
    label: () => i18n.t('Pay with PayPal'),
    className: 'bg-[#ffc439] text-ink-900',
  },
  [GATEWAY.paybox]: {
    label: () => i18n.t('Pay with Paybox'),
    className: 'bg-[#e30613]',
  },
  [GATEWAY.up2pay]: {
    label: () => i18n.t('Pay with Up2Pay'),
    className: 'bg-[#00a651]',
  },
  [GATEWAY.hubpisp]: {
    label: option =>
      option === 'instant'
        ? i18n.t('Pay from your bank (instant transfer)')
        : i18n.t('Pay from your bank (standard transfer)'),
    className: 'bg-[#1d4ed8]',
  },
};

type Handoff = StartResult['handoff'];

/**
 * Performs the handoff the server answered with. A button starts a payment
 * and nothing else: everything after this belongs to a route or a page,
 * because the browser may never come back to where it left.
 */
function performHandoff(handoff: Handoff): boolean {
  switch (handoff.kind) {
    case 'redirect':
    case 'page':
      window.location.assign(handoff.url);
      return true;
    case 'form-post': {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = handoff.url;
      for (const [name, value] of Object.entries(handoff.fields)) {
        const field = document.createElement('input');
        field.type = 'hidden';
        field.name = name;
        field.value = value;
        form.appendChild(field);
      }
      document.body.appendChild(form);
      form.submit();
      return true;
    }
    default:
      return false;
  }
}

type StartArgs = {
  source: PaymentSource;
  intent: unknown;
  submitToken: string;
};

type Starter = (offered: OfferedGateway) => Promise<Handoff | null>;

/**
 * PayPal approves the order in its own window and never redirects the browser
 * itself, so its button is the SDK's: the order is created when the buyer
 * presses it and, once approved, the browser is sent to the same return route
 * every other gateway uses, which captures and settles.
 */
function PaypalButton({disabled, start}: {disabled?: boolean; start: Starter}) {
  const env = useEnvironment();
  const {toast} = useToast();
  const [completing, setCompleting] = useState(false);
  const handoff = useRef<Extract<Handoff, {kind: 'sdk'}> | null>(null);

  const createOrder = async (): Promise<{orderId: string}> => {
    const result = await start({gateway: GATEWAY.paypal});
    /* Already paid under this checkout: show the result rather than a second
     * PayPal window. The SDK is told to stop by the rejection that follows. */
    if (result?.kind === 'page') {
      setCompleting(true);
      window.location.assign(result.url);
    }
    if (!result || result.kind !== 'sdk') {
      throw new Error('PayPal order was not created');
    }
    handoff.current = result;
    return {orderId: result.orderId};
  };

  /* Both ways out of PayPal's window go through the return route, which asks
   * PayPal what became of the order: an approval is captured, an abandon is
   * recorded as cancelled, and the result page shows either. */
  const complete = (orderId: string, cancelled: boolean) => {
    const current = handoff.current;
    if (!current || current.orderId !== orderId) {
      toast({
        variant: 'destructive',
        title: i18n.t('The payment could not be completed. Please try again.'),
      });
      return;
    }
    setCompleting(true);
    const completeUrl = new URL(current.completeUrl);
    completeUrl.searchParams.set('token', orderId);
    if (cancelled) {
      completeUrl.searchParams.set('outcome', 'cancel');
    }
    window.location.assign(completeUrl.toString());
  };

  const onApprove = async ({orderId}: {orderId: string}): Promise<void> => {
    complete(orderId, false);
  };

  const onCancel = ({orderId}: {orderId?: string}): void => {
    const cancelled = orderId ?? handoff.current?.orderId;
    if (cancelled) {
      complete(cancelled, true);
    }
  };

  const onError = (): void => {
    toast({
      variant: 'destructive',
      title: i18n.t('The payment could not be completed. Please try again.'),
    });
  };

  return (
    <PayPalProvider
      clientId={env.paypal?.clientId ?? ''}
      components={['paypal-payments']}
      locale={transformLocale(l10n.getLocale()) || undefined}
      pageType="checkout">
      <div className={`w-full ${styles.paypal}`}>
        <PayPalOneTimePaymentButton
          disabled={disabled}
          presentationMode="auto"
          createOrder={createOrder}
          onApprove={onApprove}
          onCancel={onCancel}
          onError={onError}
        />
      </div>
      <Portal>
        <Spinner show={completing} fullscreen />
      </Portal>
    </PayPalProvider>
  );
}

function keyOf(offered: OfferedGateway): string {
  return offered.option
    ? `${offered.gateway}:${offered.option}`
    : offered.gateway;
}

/**
 * One button per gateway the server offers. The intent is opaque here: the
 * component sends `{source, intent, submitToken}` and the server prices it.
 */
export function PaymentMethods({
  gateways,
  source,
  intent,
  submitToken,
  disabled,
  onValidate,
}: StartArgs & {
  gateways: OfferedGateway[];
  disabled?: boolean;
  /** The caller's pre-flight: an address chosen, an amount above zero. */
  onValidate?: (gateway: Gateway) => Promise<boolean> | boolean;
}) {
  const {toast} = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (gateways.length === 0) {
    return null;
  }

  /* Validates, starts the payment on the server and returns the handoff, or
   * null after showing why not. Shared by the plain buttons and the SDK one. */
  const start: Starter = async offered => {
    if (onValidate && !(await onValidate(offered.gateway))) {
      return null;
    }
    try {
      const result = await startPaymentAction({
        gateway: offered.gateway,
        option: offered.option,
        source,
        intent,
        submitToken,
      });
      if (result.error) {
        toast({variant: 'destructive', title: result.message});
        return null;
      }
      return result.data.handoff;
    } catch {
      toast({
        variant: 'destructive',
        title: i18n.t('The payment could not be started. Please try again.'),
      });
      return null;
    }
  };

  const press = async (offered: OfferedGateway) => {
    if (busy) return;
    setBusy(keyOf(offered));
    try {
      const handoff = await start(offered);
      if (handoff && !performHandoff(handoff)) {
        toast({
          variant: 'destructive',
          title: i18n.t('This payment method is not available yet'),
        });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {gateways.map(offered => {
        const key = keyOf(offered);
        if (offered.gateway === GATEWAY.paypal) {
          return (
            <PaypalButton
              key={key}
              disabled={disabled || busy !== null}
              start={start}
            />
          );
        }
        const presentation = PRESENTATION[offered.gateway];
        return (
          <Button
            key={key}
            type="button"
            className={`h-[50px] w-full text-lg font-medium ${presentation.className}`}
            disabled={disabled || busy !== null}
            onClick={() => press(offered)}>
            {busy === key
              ? i18n.t('Redirecting…')
              : presentation.label(offered.option)}
          </Button>
        );
      })}
    </div>
  );
}

export default PaymentMethods;
