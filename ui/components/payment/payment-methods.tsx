'use client';

import {useState} from 'react';

// ---- CORE IMPORTS ---- //
import {i18n} from '@/locale';
import {Button} from '@/ui/components';
import {useToast} from '@/ui/hooks';
import {
  GATEWAY,
  type Gateway,
  type PaymentSource,
} from '@/payment/domain/types';
import {startPaymentAction} from '@/payment/actions';
import type {StartResult} from '@/payment/start';

type GatewayPresentation = {
  /** Written as literal calls so the keys stay visible to the extractor. */
  label: () => string;
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
    label: () => i18n.t('Pay from your bank'),
    className: 'bg-[#1d4ed8]',
  },
};

/**
 * Performs the handoff the server answered with. A button starts a payment
 * and nothing else: everything after this belongs to a route or a page,
 * because the browser may never come back to where it left.
 */
function performHandoff(handoff: StartResult['handoff']): boolean {
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
}: {
  gateways: Gateway[];
  source: PaymentSource;
  intent: unknown;
  submitToken: string;
  disabled?: boolean;
  /** The caller's pre-flight: an address chosen, an amount above zero. */
  onValidate?: (gateway: Gateway) => Promise<boolean> | boolean;
}) {
  const {toast} = useToast();
  const [busy, setBusy] = useState<Gateway | null>(null);

  if (gateways.length === 0) {
    return null;
  }

  const start = async (gateway: Gateway) => {
    if (busy) return;
    if (onValidate && !(await onValidate(gateway))) {
      return;
    }
    setBusy(gateway);
    try {
      const result = await startPaymentAction({
        gateway,
        source,
        intent,
        submitToken,
      });
      if (result.error) {
        toast({variant: 'destructive', title: result.message});
        return;
      }
      if (!performHandoff(result.data.handoff)) {
        toast({
          variant: 'destructive',
          title: i18n.t('This payment method is not available yet'),
        });
      }
    } catch {
      toast({
        variant: 'destructive',
        title: i18n.t('The payment could not be started. Please try again.'),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {gateways.map(gateway => {
        const presentation = PRESENTATION[gateway];
        return (
          <Button
            key={gateway}
            type="button"
            className={`h-[50px] w-full text-lg font-medium ${presentation.className}`}
            disabled={disabled || busy !== null}
            onClick={() => start(gateway)}>
            {busy === gateway ? i18n.t('Redirecting…') : presentation.label()}
          </Button>
        );
      })}
    </div>
  );
}

export default PaymentMethods;
